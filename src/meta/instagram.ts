// Publicacion en Instagram via graph.facebook.com.
// Sirve igual para Unified Login (FTND, token SUAT) y Facebook Login (Tezontle).
//
// Flujo (docs: developers.facebook.com/docs/instagram-platform/content-publishing):
//   1. POST /{ig-id}/media          media_type=REELS + video_url (o image_url JPEG) + caption
//   2. GET  /{container}?fields=status_code,status   hasta FINISHED (Meta recomienda 1 vez/min, max 5 min)
//   3. POST /{ig-id}/media_publish  creation_id={container}
//   4. GET  /{media-id}?fields=permalink
//
// Sin duplicados: el container_id se guarda en cuanto se crea. Si una corrida
// se interrumpe, la siguiente reanuda ese mismo contenedor en vez de crear otro,
// y si Meta dice que ya esta PUBLISHED no se vuelve a publicar.

import { graph, ErrorGraph } from "./graph.js";
import type { EstadoRed } from "../calendario.js";

export interface MedioInstagram {
  tipo: "video" | "imagen";
  url: string; // URL prefirmada de R2 (Meta la descarga)
  caption: string;
}

export interface OpcionesEspera {
  /** Cuantas veces revisar el estado del contenedor antes de dejarlo para la siguiente corrida. */
  revisiones: number;
  /** Pausa entre revisiones (ms). */
  pausaMs: number;
}

/** Callback para guardar el estado en el calendario despues de cada paso. */
export type Guardar = (estado: EstadoRed) => Promise<void>;

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Busca el ID de la cuenta de IG asignada al token (Unified Login). */
export async function descubrirCuenta(token: string): Promise<string> {
  const data = await graph("GET", "/me/assigned_instagram_accounts", token, { fields: "id,username" });
  const cuentas: Array<{ id: string; username: string }> = data.data ?? [];
  if (cuentas.length !== 1) {
    throw new Error(
      cuentas.length === 0
        ? "el token no tiene ninguna cuenta de Instagram asignada"
        : `el token tiene varias cuentas (${cuentas.map((c) => `@${c.username}`).join(", ")}); define el secret del ID`,
    );
  }
  return cuentas[0]!.id;
}

async function crearContenedor(igId: string, token: string, medio: MedioInstagram): Promise<string> {
  const params: Record<string, string> =
    medio.tipo === "video"
      ? { media_type: "REELS", video_url: medio.url, share_to_feed: "true" }
      : { image_url: medio.url };
  if (medio.caption) params.caption = medio.caption;
  const data = await graph("POST", `/${igId}/media`, token, params);
  if (!data.id) throw new Error("Meta no devolvio el ID del contenedor");
  return String(data.id);
}

async function estadoContenedor(containerId: string, token: string): Promise<{ codigo: string; detalle: string }> {
  const data = await graph("GET", `/${containerId}`, token, { fields: "status_code,status" });
  return { codigo: String(data.status_code ?? "DESCONOCIDO"), detalle: String(data.status ?? "") };
}

/**
 * Publica (o reanuda) una publicacion. Devuelve el estado final para esta corrida:
 * publicado, procesando (Meta sigue procesando; se reanuda en la siguiente) o error.
 */
export async function publicarEnInstagram(
  igId: string,
  token: string,
  estado: EstadoRed,
  obtenerMedio: () => Promise<MedioInstagram>,
  guardar: Guardar,
  opciones: OpcionesEspera,
): Promise<EstadoRed> {
  let e: EstadoRed = { ...estado, error: null };

  if (e.media_id) return { ...e, status: "publicado" };

  try {
    // 1) Contenedor: reusar el guardado si sigue vivo, si no crear uno.
    if (e.container_id) {
      const { codigo } = await estadoContenedor(e.container_id, token);
      if (codigo === "PUBLISHED") {
        // Una corrida anterior publico pero no alcanzo a guardar el media_id: no se publica otra vez.
        e = { ...e, status: "publicado", media_id: `desconocido (contenedor ${e.container_id})`, publicado_en: new Date().toISOString() };
        await guardar(e);
        return e;
      }
      if (codigo === "EXPIRED" || codigo === "ERROR") {
        console.log(`   contenedor anterior ${e.container_id} en ${codigo}; creo uno nuevo`);
        e = { ...e, container_id: null };
      }
    }
    if (!e.container_id) {
      const medio = await obtenerMedio();
      const containerId = await crearContenedor(igId, token, medio);
      e = { ...e, status: "procesando", container_id: containerId };
      await guardar(e);
      console.log(`   contenedor creado: ${containerId}`);
    }

    // 2) Esperar a que Meta termine de procesar.
    let listo = false;
    for (let i = 0; i < opciones.revisiones; i++) {
      const { codigo, detalle } = await estadoContenedor(e.container_id!, token);
      console.log(`   estado del contenedor: ${codigo}${detalle && detalle !== codigo ? ` (${detalle})` : ""}`);
      if (codigo === "FINISHED") {
        listo = true;
        break;
      }
      if (codigo === "PUBLISHED") {
        e = { ...e, status: "publicado", media_id: `desconocido (contenedor ${e.container_id})`, publicado_en: new Date().toISOString() };
        await guardar(e);
        return e;
      }
      if (codigo === "ERROR" || codigo === "EXPIRED") {
        // Se conserva el container_id para diagnostico; "reintentar" lo limpia.
        e = { ...e, status: "error", error: `Meta rechazo el medio: ${codigo}${detalle ? ` — ${detalle}` : ""}` };
        await guardar(e);
        return e;
      }
      if (i < opciones.revisiones - 1) await espera(opciones.pausaMs);
    }
    if (!listo) {
      console.log("   Meta sigue procesando; se publica en la siguiente corrida.");
      return e; // queda en "procesando" con su container_id
    }

    // 3) Publicar.
    const pub = await graph("POST", `/${igId}/media_publish`, token, { creation_id: e.container_id! });
    e = { ...e, status: "publicado", media_id: String(pub.id), publicado_en: new Date().toISOString() };
    await guardar(e);

    // 4) Enlace (informativo; si falla no pasa nada).
    try {
      const info = await graph("GET", `/${e.media_id}`, token, { fields: "permalink" });
      if (info.permalink) {
        e = { ...e, permalink: String(info.permalink) };
        await guardar(e);
      }
    } catch {
      /* sin enlace */
    }
    return e;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ErrorGraph && err.temporal) {
      // Temporal aun despues de reintentar: se queda como estaba y se reintenta en la siguiente corrida.
      console.log(`   error temporal, se reintenta en la siguiente corrida: ${msg}`);
      e = { ...e, error: msg };
      await guardar(e);
      return e;
    }
    e = { ...e, status: "error", error: msg };
    await guardar(e);
    return e;
  }
}
