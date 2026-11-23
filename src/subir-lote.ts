// Fase 1: agenda lo que Marcus subio a la carpeta de entrada de R2.
//
// Flujo (todo en la nube, sin tocar ningun disco local):
//   1. Lista R2 en entrada/{marca}/  (videos .mp4/.mov, imagenes .jpg/.jpeg/.png y sus .txt).
//   2. Valida cada medio con ffprobe leyendo directo de una URL prefirmada (solo lectura).
//   3. Lee el copy general (archivo.txt) y los especificos por red (archivo.instagram.txt, ...).
//   4. Le asigna el siguiente horario libre de config/marcas.json.
//   5. Mueve el medio a videos/{marca}/{id}.ext con copia del lado del servidor (bytes identicos).
//   6. Agrega la entrada a contenido/{marca}/calendario.json y borra el original y sus .txt de entrada/.
//
// Uso:
//   npm run subir-lote -- --marca ftnd          # una marca
//   npm run subir-lote                          # todas las marcas
//   npm run subir-lote -- --marca ftnd --simular   # solo muestra lo que haria, no cambia nada
//   npm run subir-lote -- --espera 10           # ignora lo subido hace menos de 10 min
//
// Lo que no pasa la validacion se mueve a entrada/{marca}/rechazados/ junto con
// un archivo .motivo.txt, para que no vuelva a fallar en cada corrida automatica.
//
// El git commit/push del calendario lo hace el workflow .github/workflows/subir-lote.yml.

import "dotenv/config";
import { parseArgs } from "node:util";
import { leerMarcas, REDES, type Marca, type Red } from "./marcas.js";
import { leerCalendario, guardarCalendario, estadoInicial, type Publicacion } from "./calendario.js";
import {
  listarPrefijo,
  leerTexto,
  urlPrefirmada,
  copiar,
  borrar,
  existe,
  escribirTexto,
  type ObjetoR2,
} from "./storage/r2.js";
import { validarMedio } from "./video.js";
import { siguienteHorario, isoConZona } from "./fechas.js";

const EXT_VIDEO = [".mp4", ".mov"];
const EXT_IMAGEN = [".jpg", ".jpeg", ".png"];

// ---------- utilidades de archivos ----------

function partir(key: string): { base: string; ext: string } {
  const nombre = key.slice(key.lastIndexOf("/") + 1);
  const punto = nombre.lastIndexOf(".");
  return punto <= 0 ? { base: nombre, ext: "" } : { base: nombre.slice(0, punto), ext: nombre.slice(punto).toLowerCase() };
}

function slug(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "medio"
  );
}

interface Lote {
  medio: ObjetoR2;
  /** El mas reciente entre el medio y sus .txt (epoch ms). */
  modificado: number;
  tipo: "video" | "imagen";
  ext: string;
  base: string;
  txtGeneral: string | null;
  txtPorRed: Partial<Record<Red, string>>;
}

function armarLotes(objetos: ObjetoR2[], prefijo: string): { lotes: Lote[]; ignorados: string[] } {
  // Solo archivos directamente dentro de entrada/{marca}/ (no subcarpetas).
  const directos = objetos.filter((o) => !o.key.endsWith("/") && !o.key.slice(prefijo.length).includes("/"));
  const textos = new Map(directos.filter((o) => partir(o.key).ext === ".txt").map((o) => [partir(o.key).base, o.key]));
  const fechaDe = new Map(directos.map((o) => [o.key, o.modificado]));
  const usados = new Set<string>();
  const lotes: Lote[] = [];
  const ignorados: string[] = [];

  for (const o of directos) {
    const { base, ext } = partir(o.key);
    if (ext === ".txt") continue;
    const tipo = EXT_VIDEO.includes(ext) ? "video" : EXT_IMAGEN.includes(ext) ? "imagen" : null;
    if (!tipo) {
      ignorados.push(`${o.key} (extension no soportada)`);
      continue;
    }
    const txtPorRed: Partial<Record<Red, string>> = {};
    for (const red of REDES) {
      const k = textos.get(`${base}.${red}`);
      if (k) {
        txtPorRed[red] = k;
        usados.add(k);
      }
    }
    const txtGeneral = textos.get(base) ?? null;
    if (txtGeneral) usados.add(txtGeneral);
    const modificado = Math.max(
      o.modificado,
      ...[txtGeneral, ...Object.values(txtPorRed)].map((k) => (k ? fechaDe.get(k) ?? 0 : 0)),
    );
    lotes.push({ medio: o, modificado, tipo, ext, base, txtGeneral, txtPorRed });
  }
  for (const k of textos.values()) if (!usados.has(k)) ignorados.push(`${k} (.txt sin medio con el mismo nombre)`);
  lotes.sort((a, b) => a.medio.key.localeCompare(b.medio.key));
  return { lotes, ignorados };
}

// ---------- proceso por marca ----------

/** Mueve el medio y sus .txt a entrada/{marca}/rechazados/ y deja una nota con el motivo. */
async function rechazar(prefijo: string, claves: string[], nombre: string, motivos: string[]): Promise<void> {
  const destino = `${prefijo}rechazados/`;
  for (const k of claves) {
    await copiar(k, destino + k.slice(prefijo.length));
    await borrar(k);
  }
  const nota = [
    `No se agendo ${nombre} (${new Date().toISOString()}):`,
    ...motivos.map((m) => `- ${m}`),
    "",
    `Para reintentar, sube una version que cumpla a ${prefijo} (y borra esta de rechazados/).`,
  ].join("\n");
  await escribirTexto(`${destino}${nombre}.motivo.txt`, `${nota}\n`);
}

async function procesarMarca(
  marca: Marca,
  simular: boolean,
  esperaMin: number,
): Promise<{ agendados: number; fallidos: number }> {
  const prefijo = `entrada/${marca.id}/`;
  console.log(`\n=== ${marca.nombre} (${prefijo}) ===`);

  // Marcador para que la carpeta se vea en el panel de Cloudflare aunque este vacia.
  if (!simular && !(await existe(prefijo))) await escribirTexto(prefijo, "");

  const { lotes, ignorados } = armarLotes(await listarPrefijo(prefijo), prefijo);
  for (const i of ignorados) console.log(`⚠️  Ignorado: ${i}`);
  if (lotes.length === 0) {
    console.log("Nada nuevo en la carpeta de entrada.");
    return { agendados: 0, fallidos: 0 };
  }

  const calendario = await leerCalendario(marca.id);
  const ocupados = new Set(calendario.map((p) => Date.parse(p.publicar_en)));
  const ids = new Set(calendario.map((p) => p.id));
  const tabla: Array<{ archivo: string; id: string; publicar_en: string }> = [];
  let fallidos = 0;

  for (const lote of lotes) {
    const nombre = lote.medio.key.slice(prefijo.length);
    const textos = [lote.txtGeneral, ...Object.values(lote.txtPorRed)].filter((k): k is string => !!k);

    // Si se acaba de subir, puede que el .txt todavia no llegue: se agenda en la siguiente corrida.
    if (Date.now() - lote.modificado < esperaMin * 60_000) {
      console.log(`⏳ ${nombre}: subido hace menos de ${esperaMin} min; se agenda en la siguiente corrida.`);
      continue;
    }

    try {
      // ¿Ya se agendo en una corrida anterior que no alcanzo a limpiar entrada/?
      const previo = calendario.find((p) => p.origen?.key === lote.medio.key && p.origen.etag === lote.medio.etag);
      if (previo) {
        if (await existe(previo.archivo_r2)) {
          console.log(`↩️  ${nombre}: ya estaba agendado como ${previo.id}; limpio la entrada.`);
          if (!simular) for (const k of [lote.medio.key, ...textos]) await borrar(k);
        } else {
          console.log(`⚠️  ${nombre}: esta en el calendario (${previo.id}) pero falta ${previo.archivo_r2}; lo copio de nuevo.`);
          if (!simular) {
            await copiar(lote.medio.key, previo.archivo_r2);
            for (const k of [lote.medio.key, ...textos]) await borrar(k);
          }
        }
        continue;
      }

      const v = await validarMedio(await urlPrefirmada(lote.medio.key, 15 * 60), lote.tipo, lote.medio.bytes);
      for (const a of v.avisos) console.log(`⚠️  ${nombre}: ${a}`);
      if (!v.ok) {
        for (const e of v.errores) console.log(`❌ ${nombre}: ${e}`);
        if (simular) {
          console.log(`   Se moveria a ${prefijo}rechazados/ (simulacion).`);
        } else {
          await rechazar(prefijo, [lote.medio.key, ...textos], nombre, v.errores);
          console.log(`   Movido a ${prefijo}rechazados/ con el motivo en ${nombre}.motivo.txt`);
        }
        fallidos++;
        continue;
      }

      const copy = lote.txtGeneral ? (await leerTexto(lote.txtGeneral)).trim() : "";
      const copys: Partial<Record<Red, string>> = {};
      for (const [red, k] of Object.entries(lote.txtPorRed) as Array<[Red, string]>) {
        copys[red] = (await leerTexto(k)).trim();
      }
      for (const red of marca.redes_activas) {
        if (!(copys[red] ?? copy)) console.log(`⚠️  ${nombre}: sin copy para ${red} (se publicara sin texto)`);
      }

      const utc = siguienteHorario(marca, ocupados);
      const publicar_en = isoConZona(marca.zona_horaria, utc);
      let id = `${publicar_en.slice(0, 10)}-${slug(lote.base)}`;
      for (let n = 2; ids.has(id); n++) id = `${publicar_en.slice(0, 10)}-${slug(lote.base)}-${n}`;
      const archivo_r2 = `videos/${marca.id}/${id}${lote.ext}`;

      const pub: Publicacion = {
        id,
        marca: marca.id,
        tipo: lote.tipo,
        archivo_r2,
        publicar_en,
        copy,
        ...(Object.keys(copys).length ? { copys } : {}),
        redes: [...marca.redes_activas],
        estado: Object.fromEntries(marca.redes_activas.map((r) => [r, estadoInicial()])),
        origen: { key: lote.medio.key, etag: lote.medio.etag },
      };

      if (!simular) {
        await copiar(lote.medio.key, archivo_r2); // 1) copia identica en videos/
        calendario.push(pub);
        await guardarCalendario(marca.id, calendario); // 2) queda agendado
        for (const k of [lote.medio.key, ...textos]) await borrar(k); // 3) limpia entrada/
      }
      ocupados.add(utc);
      ids.add(id);
      tabla.push({ archivo: nombre, id, publicar_en });
    } catch (e) {
      console.log(`❌ ${nombre}: ${e instanceof Error ? e.message : String(e)}`);
      fallidos++;
    }
  }

  if (tabla.length) {
    console.log(simular ? "\nSe agendaria (simulacion, no se cambio nada):" : "\nAgendado:");
    console.table(tabla);
  }
  return { agendados: tabla.length, fallidos };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      marca: { type: "string" },
      simular: { type: "boolean", default: false },
      espera: { type: "string", default: "0" },
    },
  });
  const esperaMin = Number(values.espera);
  if (!Number.isFinite(esperaMin) || esperaMin < 0) throw new Error(`--espera invalido: ${values.espera}`);
  const todas = await leerMarcas();
  const marcas = values.marca ? todas.filter((m) => m.id === values.marca) : todas;
  if (marcas.length === 0) {
    throw new Error(`Marca desconocida: "${values.marca}". Disponibles: ${todas.map((m) => m.id).join(", ")}`);
  }

  let fallidos = 0;
  let agendados = 0;
  // Cada marca por separado: si una falla, las demas siguen.
  for (const marca of marcas) {
    try {
      const r = await procesarMarca(marca, values.simular, esperaMin);
      fallidos += r.fallidos;
      agendados += r.agendados;
    } catch (e) {
      console.log(`❌ ${marca.nombre}: ${e instanceof Error ? e.message : String(e)}`);
      fallidos++;
    }
  }
  console.log(`\nTotal: ${agendados} agendado(s), ${fallidos} con problema.`);
  if (fallidos > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nError inesperado:", error instanceof Error ? error.message : error);
  process.exit(1);
});
