// Leer, escribir y validar contenido/{marca}/calendario.json.

import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { REDES, type Red } from "./marcas.js";

export type Status = "pendiente" | "procesando" | "publicado" | "error";
const STATUSES: readonly Status[] = ["pendiente", "procesando", "publicado", "error"];

export interface EstadoRed {
  status: Status;
  container_id: string | null;
  media_id: string | null;
  error: string | null;
  /** Enlace publico de la publicacion (cuando la red lo da). */
  permalink?: string;
  /** Fecha real de publicacion (ISO). */
  publicado_en?: string;
}

export interface Publicacion {
  id: string;
  marca: string;
  tipo: "video" | "imagen";
  archivo_r2: string;
  publicar_en: string;
  copy: string;
  /** Copys especificos por red (de archivo.instagram.txt, etc.). Si falta, se usa `copy`. */
  copys?: Partial<Record<Red, string>>;
  redes: Red[];
  estado: Partial<Record<Red, EstadoRed>>;
  /** De donde salio el archivo en R2 (carpeta de entrada). Evita agendar dos veces lo mismo. */
  origen?: { key: string; etag: string };
}

export function rutaCalendario(marca: string): string {
  return fileURLToPath(new URL(`../contenido/${marca}/calendario.json`, import.meta.url));
}

const FECHA_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;

function validar(marca: string, crudo: unknown): Publicacion[] {
  if (!Array.isArray(crudo)) throw new Error(`calendario de ${marca}: debe ser una lista`);
  const ids = new Set<string>();
  return crudo.map((p: Record<string, unknown>, i) => {
    const err = (msg: string): never => {
      throw new Error(`calendario de ${marca}, entrada ${i} (${String(p?.id)}): ${msg}`);
    };
    if (typeof p !== "object" || p === null) err("debe ser un objeto");
    if (typeof p.id !== "string" || !p.id) err("falta 'id'");
    if (ids.has(p.id as string)) err("id duplicado");
    ids.add(p.id as string);
    if (p.marca !== marca) err(`'marca' debe ser "${marca}"`);
    if (typeof p.archivo_r2 !== "string") err("falta 'archivo_r2'");
    if (typeof p.publicar_en !== "string" || !FECHA_CON_ZONA.test(p.publicar_en)) {
      err("'publicar_en' debe ser fecha ISO con zona horaria");
    }
    if (!Array.isArray(p.redes)) err("'redes' debe ser una lista");
    for (const r of p.redes as unknown[]) {
      if (!REDES.includes(r as Red)) err(`red invalida: ${String(r)}`);
      const est = (p.estado as Record<string, EstadoRed> | undefined)?.[r as string];
      if (!est || !STATUSES.includes(est.status)) err(`falta estado valido para ${String(r)}`);
    }
    return { tipo: "video", copy: "", ...p } as unknown as Publicacion;
  });
}

export async function leerCalendario(marca: string): Promise<Publicacion[]> {
  let texto: string;
  try {
    texto = await readFile(rutaCalendario(marca), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return validar(marca, JSON.parse(texto));
}

/** Escribe de forma atomica (archivo temporal + rename) para no dejar JSON a medias. */
export async function guardarCalendario(marca: string, publicaciones: Publicacion[]): Promise<void> {
  validar(marca, publicaciones);
  const ruta = rutaCalendario(marca);
  const tmp = `${ruta}.tmp`;
  await writeFile(tmp, `${JSON.stringify(publicaciones, null, 2)}\n`, "utf8");
  await rename(tmp, ruta);
}

export function estadoInicial(): EstadoRed {
  return { status: "pendiente", container_id: null, media_id: null, error: null };
}
