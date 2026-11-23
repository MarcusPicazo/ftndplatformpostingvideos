// Nube (GitHub Actions): publica lo que ya toca en el calendario de cada marca.
//
// Uso:
//   npm run publicar                          # todas las marcas, lo que ya toca
//   npm run publicar -- --marca ftnd
//   npm run publicar -- --id 2026-11-24-mi-video   # publica esa entrada YA (ignora la hora)
//   npm run publicar -- --simular             # solo muestra lo que publicaria
//
// Reglas:
// - Cada red de cada marca por separado: si una falla, las demas siguen.
// - El estado se guarda en el calendario despues de cada paso (sin duplicados).
// - Si algo termina en "error", sale con codigo 1 para que llegue el correo.
// El commit del calendario lo hace .github/workflows/publicar.yml.

import "dotenv/config";
import { parseArgs } from "node:util";
import { leerMarcas, type Marca, type Red } from "./marcas.js";
import { leerCalendario, guardarCalendario, type Publicacion, type EstadoRed } from "./calendario.js";
import { urlPrefirmada } from "./storage/r2.js";
import { publicarEnInstagram, descubrirCuenta } from "./meta/instagram.js";

/** Redes con publicacion implementada. Las demas se saltan (siguen pendientes) hasta su fase. */
const IMPLEMENTADAS: readonly Red[] = ["instagram"];

interface Resumen {
  publicados: number;
  procesando: number;
  errores: number;
}

function copyPara(pub: Publicacion, red: Red): string {
  return (pub.copys?.[red] ?? pub.copy ?? "").trim();
}

function env(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`falta el secret ${nombre}`);
  return v;
}

async function publicarRed(
  marca: Marca,
  red: Red,
  pub: Publicacion,
  calendario: Publicacion[],
  ctx: { igId?: string },
): Promise<EstadoRed> {
  const estado = pub.estado[red]!;
  const guardar = async (nuevo: EstadoRed) => {
    pub.estado[red] = nuevo;
    await guardarCalendario(marca.id, calendario);
  };

  if (red === "instagram") {
    const cfg = marca.instagram!;
    const token = env(cfg.secret_token);
    if (!ctx.igId) {
      ctx.igId = process.env[cfg.secret_user_id] || (cfg.modo === "unified_login" ? await descubrirCuenta(token) : env(cfg.secret_user_id));
    }
    return await publicarEnInstagram(
      ctx.igId,
      token,
      estado,
      async () => ({
        tipo: pub.tipo,
        // Meta descarga el archivo desde esta URL; 6 h es de sobra (el contenedor caduca en 24 h).
        url: await urlPrefirmada(pub.archivo_r2, 6 * 60 * 60),
        caption: copyPara(pub, red),
      }),
      guardar,
      { revisiones: 6, pausaMs: 60_000 },
    );
  }
  throw new Error(`publicar en ${red} todavia no esta implementado`);
}

async function procesarMarca(marca: Marca, opciones: { id?: string; simular: boolean }): Promise<Resumen> {
  const r: Resumen = { publicados: 0, procesando: 0, errores: 0 };
  const calendario = await leerCalendario(marca.id);
  const ahora = Date.now();

  const toca = calendario
    .filter((p) => (opciones.id ? p.id === opciones.id : Date.parse(p.publicar_en) <= ahora))
    .sort((a, b) => Date.parse(a.publicar_en) - Date.parse(b.publicar_en));

  const pendientes = toca.filter((p) =>
    p.redes.some((red) => ["pendiente", "procesando"].includes(p.estado[red]?.status ?? "")),
  );
  if (pendientes.length === 0) return r;

  console.log(`\n=== ${marca.nombre} ===`);
  const ctx: { igId?: string } = {};

  for (const pub of pendientes) {
    for (const red of pub.redes) {
      const estado = pub.estado[red];
      if (!estado || !["pendiente", "procesando"].includes(estado.status)) continue;
      const etiqueta = `${pub.id} → ${red}`;

      if (!IMPLEMENTADAS.includes(red)) {
        console.log(`⏭️  ${etiqueta}: publicar en ${red} aun no esta implementado; sigue pendiente.`);
        continue;
      }
      if (!marca.redes_activas.includes(red)) {
        console.log(`⏭️  ${etiqueta}: ${red} no esta activa para ${marca.nombre}; sigue pendiente.`);
        continue;
      }
      if (opciones.simular) {
        console.log(`🔎 ${etiqueta}: se publicaria ahora (${pub.tipo}, programado ${pub.publicar_en}).`);
        continue;
      }

      console.log(`▶️  ${etiqueta} (${pub.tipo}, programado ${pub.publicar_en})`);
      try {
        const final = await publicarRed(marca, red, pub, calendario, ctx);
        if (final.status === "publicado") {
          r.publicados++;
          console.log(`✅ ${etiqueta}: publicado${final.permalink ? ` — ${final.permalink}` : ""}`);
        } else if (final.status === "error") {
          r.errores++;
          console.log(`❌ ${etiqueta}: ${final.error}`);
        } else {
          r.procesando++;
          console.log(`⏳ ${etiqueta}: ${final.status}${final.error ? ` (${final.error})` : ""}`);
        }
      } catch (e) {
        // Error de configuracion (falta secret, cuenta no encontrada...): se marca y se sigue.
        const msg = e instanceof Error ? e.message : String(e);
        pub.estado[red] = { ...estado, status: "error", error: msg };
        await guardarCalendario(marca.id, calendario);
        r.errores++;
        console.log(`❌ ${etiqueta}: ${msg}`);
      }
    }
  }
  return r;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      marca: { type: "string" },
      id: { type: "string" },
      simular: { type: "boolean", default: false },
    },
  });
  const todas = await leerMarcas();
  const marcas = values.marca ? todas.filter((m) => m.id === values.marca) : todas;
  if (marcas.length === 0) {
    throw new Error(`Marca desconocida: "${values.marca}". Disponibles: ${todas.map((m) => m.id).join(", ")}`);
  }
  const id = values.id?.trim() || undefined;

  const total: Resumen = { publicados: 0, procesando: 0, errores: 0 };
  let encontrado = false;
  for (const marca of marcas) {
    try {
      if (id && !(await leerCalendario(marca.id)).some((p) => p.id === id)) continue;
      encontrado = true;
      const r = await procesarMarca(marca, { ...(id ? { id } : {}), simular: values.simular });
      total.publicados += r.publicados;
      total.procesando += r.procesando;
      total.errores += r.errores;
    } catch (e) {
      console.log(`❌ ${marca.nombre}: ${e instanceof Error ? e.message : String(e)}`);
      total.errores++;
    }
  }
  if (id && !encontrado) throw new Error(`No existe la publicacion "${id}" en ningun calendario`);

  console.log(
    `\nResumen: ${total.publicados} publicado(s), ${total.procesando} en proceso, ${total.errores} con error.`,
  );
  if (total.errores > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nError inesperado:", error instanceof Error ? error.message : error);
  process.exit(1);
});
