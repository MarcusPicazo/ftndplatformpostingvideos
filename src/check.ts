// Fase 0: valida credenciales y R2, por marca.
//
// Uso:
//   npm run check                  # todas las marcas
//   npm run check -- --marca ftnd
// En la nube: GitHub -> Actions -> "Check" -> Run workflow.
//
// Un secret vacio se reporta como "sin configurar" (no falla). Un secret que
// esta puesto pero no funciona si falla (exit code 1 -> llega correo).
// Nunca imprime tokens ni URLs con tokens.

import "dotenv/config";
import { parseArgs } from "node:util";
import { leerMarcas, type Marca } from "./marcas.js";
import { listarPrefijo } from "./storage/r2.js";

const GRAPH_VERSION = process.env.GRAPH_VERSION ?? "v27.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

type Resultado = "ok" | "sin_configurar" | "error";

class SinConfigurar extends Error {}

function env(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new SinConfigurar(`falta el secret ${nombre}`);
  return valor;
}

function ocultar(texto: string, ...secretos: string[]): string {
  let t = texto;
  for (const s of secretos) if (s) t = t.replaceAll(s, "***");
  return t.replace(/access_token=[^&\s"]+/g, "access_token=***");
}

async function graphGet(ruta: string, token: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${GRAPH_BASE}${ruta}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const resp = await fetch(url);
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) {
    const e = data.error;
    const codigo = `(#${e?.code}${e?.error_subcode ? `/${e.error_subcode}` : ""})`;
    const msg = e ? (String(e.message).startsWith("(#") ? e.message : `${codigo} ${e.message}`) : `HTTP ${resp.status}`;
    throw new Error(ocultar(msg, token));
  }
  return data;
}

async function paso(nombre: string, accion: () => Promise<string>): Promise<Resultado> {
  try {
    console.log(`  ✅ ${nombre}: ${await accion()}`);
    return "ok";
  } catch (e) {
    if (e instanceof SinConfigurar) {
      console.log(`  ⏭️  ${nombre}: sin configurar (${e.message})`);
      return "sin_configurar";
    }
    console.log(`  ❌ ${nombre}: ${e instanceof Error ? e.message : String(e)}`);
    return "error";
  }
}

function describirCaducidad(expiraEn: number | undefined): string {
  if (expiraEn === undefined) return "caducidad desconocida";
  if (expiraEn === 0) return "no caduca";
  const dias = Math.round((expiraEn * 1000 - Date.now()) / 86_400_000);
  return `caduca en ${dias} dia(s)`;
}

async function checkInstagram(marca: Marca): Promise<Resultado[]> {
  const cfg = marca.instagram!;
  const r: Resultado[] = [];

  if (cfg.modo === "instagram_login") {
    r.push(await paso("Instagram", async () => {
      throw new Error("modo instagram_login ya no se usa en este proyecto; usa unified_login");
    }));
    return r;
  }

  let igId = process.env[cfg.secret_user_id] ?? "";

  if (cfg.modo === "unified_login") {
    r.push(await paso("Instagram: cuentas asignadas al token", async () => {
      const token = env(cfg.secret_token);
      const data = await graphGet("/me/assigned_instagram_accounts", token, { fields: "id,username" });
      const cuentas: Array<{ id: string; username: string }> = data.data ?? [];
      if (cuentas.length === 0) throw new Error("el token no tiene ninguna cuenta de Instagram asignada");
      if (!igId) {
        if (cuentas.length > 1) {
          throw new Error(`hay varias cuentas (${cuentas.map((c) => `@${c.username}=${c.id}`).join(", ")}); pon ${cfg.secret_user_id}`);
        }
        igId = cuentas[0]!.id;
      } else if (!cuentas.some((c) => c.id === igId)) {
        throw new Error(`${cfg.secret_user_id} no coincide con las cuentas del token: ${cuentas.map((c) => `@${c.username}=${c.id}`).join(", ")}`);
      }
      return cuentas.map((c) => `@${c.username} (id ${c.id})`).join(", ");
    }));
  }

  r.push(await paso("Instagram: cuenta", async () => {
    const token = env(cfg.secret_token);
    if (!igId) igId = env(cfg.secret_user_id);
    const data = await graphGet(`/${igId}`, token, { fields: "username" });
    return `@${data.username} (id ${igId})`;
  }));

  r.push(await paso("Instagram: limite de publicacion", async () => {
    const token = env(cfg.secret_token);
    if (!igId) igId = env(cfg.secret_user_id);
    const data = await graphGet(`/${igId}/content_publishing_limit`, token, { fields: "quota_usage,config" });
    const uso = data.data?.[0];
    return uso ? `${uso.quota_usage}/${uso.config?.quota_total ?? "?"} en las ultimas 24 h` : "sin datos";
  }));

  // debug_token necesita un token de app (META_APP_ID|META_APP_SECRET); un SUAT no puede revisarse a si mismo.
  r.push(await paso("Instagram: caducidad y permisos del token", async () => {
    const token = env(cfg.secret_token);
    const appToken = `${env("META_APP_ID")}|${env("META_APP_SECRET")}`;
    const data = await graphGet("/debug_token", appToken, { input_token: token }).catch((e: Error) => {
      throw new Error(ocultar(e.message, token, appToken));
    });
    const d = data.data ?? {};
    if (d.is_valid === false) throw new Error("Meta dice que el token no es valido");
    const permisos: string[] = d.scopes ?? [];
    const faltan = ["instagram_basic", "instagram_content_publish"].filter((p) => !permisos.includes(p));
    if (faltan.length) throw new Error(`al token le faltan permisos: ${faltan.join(", ")}`);
    return `${describirCaducidad(d.expires_at)}; permisos: ${permisos.join(", ")}`;
  }));

  return r;
}

async function checkFacebook(marca: Marca): Promise<Resultado[]> {
  const cfg = marca.facebook!;
  return [
    await paso("Facebook: pagina", async () => {
      const token = env(cfg.secret_token);
      const pageId = env(cfg.secret_page_id);
      const data = await graphGet(`/${pageId}`, token, { fields: "name" });
      return `"${data.name}" (id ${pageId})`;
    }),
  ];
}

async function checkLinkedIn(marca: Marca): Promise<Resultado[]> {
  const cfg = marca.linkedin!;
  return [
    await paso("LinkedIn", async () => {
      env(cfg.secret_token);
      return "token presente (la validacion completa se agrega en la Fase 5)";
    }),
  ];
}

async function checkR2(marca: Marca): Promise<Resultado> {
  return await paso("R2", async () => {
    for (const v of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) env(v);
    const entrada = await listarPrefijo(`entrada/${marca.id}/`);
    const videos = await listarPrefijo(`videos/${marca.id}/`);
    const n = (l: typeof entrada) => l.filter((o) => !o.key.endsWith("/")).length;
    return `entrada/${marca.id}/: ${n(entrada)} archivo(s); videos/${marca.id}/: ${n(videos)} archivo(s)`;
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { marca: { type: "string" } } });
  const todas = await leerMarcas();
  const marcas = values.marca ? todas.filter((m) => m.id === values.marca) : todas;
  if (marcas.length === 0) {
    throw new Error(`Marca desconocida: "${values.marca}". Disponibles: ${todas.map((m) => m.id).join(", ")}`);
  }

  console.log(`--- Publicador: check (Graph ${GRAPH_VERSION}) ---`);
  const resultados: Resultado[] = [];
  for (const marca of marcas) {
    console.log(`\n=== ${marca.nombre} (redes: ${marca.redes_activas.join(", ") || "ninguna"}) ===`);
    // Cada red por separado: si una falla, las demas se revisan igual.
    for (const red of marca.redes_activas) {
      if (red === "instagram") resultados.push(...(await checkInstagram(marca)));
      if (red === "facebook") resultados.push(...(await checkFacebook(marca)));
      if (red === "linkedin") resultados.push(...(await checkLinkedIn(marca)));
    }
    resultados.push(await checkR2(marca));
  }

  const errores = resultados.filter((r) => r === "error").length;
  const pendientes = resultados.filter((r) => r === "sin_configurar").length;
  console.log(`\nResumen: ${resultados.length - errores - pendientes} ok, ${pendientes} sin configurar, ${errores} con error.`);
  if (errores > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nError inesperado:", error instanceof Error ? error.message : error);
  process.exit(1);
});
