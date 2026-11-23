// Leer y validar config/marcas.json.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const REDES = ["instagram", "facebook", "linkedin"] as const;
export type Red = (typeof REDES)[number];

export const DIAS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"] as const;
export type Dia = (typeof DIAS)[number];

export interface Marca {
  id: string;
  nombre: string;
  zona_horaria: string;
  horarios: string[];
  dias: Dia[];
  redes_activas: Red[];
  borrar_de_r2_tras_dias: number;
  /**
   * unified_login: Instagram API with Unified Login (SUAT, graph.facebook.com, sin pagina de Facebook).
   * facebook_login: Instagram API with Facebook Login (cuenta vinculada a pagina, graph.facebook.com).
   * instagram_login: Instagram API with Instagram Login (graph.instagram.com; ya no disponible en apps nuevas).
   */
  instagram?: {
    modo: "unified_login" | "facebook_login" | "instagram_login";
    secret_token: string;
    secret_user_id: string;
  };
  facebook?: { secret_token: string; secret_page_id: string };
  linkedin?: { alcance: "perfil_personal" | "pagina_empresa"; secret_token: string; secret_person_urn: string };
}

const RUTA_MARCAS = fileURLToPath(new URL("../config/marcas.json", import.meta.url));

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function validarMarca(id: string, crudo: unknown): Marca {
  const err = (msg: string): never => {
    throw new Error(`config/marcas.json, marca "${id}": ${msg}`);
  };
  if (!esObjeto(crudo)) return err("debe ser un objeto");

  const { nombre, zona_horaria, horarios, dias, redes_activas, borrar_de_r2_tras_dias } = crudo;
  if (typeof nombre !== "string" || !nombre) err("falta 'nombre'");
  if (typeof zona_horaria !== "string") return err("falta 'zona_horaria'");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zona_horaria });
  } catch {
    err(`zona_horaria invalida: ${zona_horaria}`);
  }
  if (!Array.isArray(horarios) || horarios.length === 0) return err("'horarios' debe ser una lista");
  for (const h of horarios) {
    if (typeof h !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) err(`horario invalido: ${String(h)}`);
  }
  if (!Array.isArray(dias) || dias.length === 0) return err("'dias' debe ser una lista");
  for (const d of dias) {
    if (!DIAS.includes(d as Dia)) err(`dia invalido: ${String(d)} (usa ${DIAS.join(", ")})`);
  }
  if (!Array.isArray(redes_activas)) return err("'redes_activas' debe ser una lista");
  for (const r of redes_activas) {
    if (!REDES.includes(r as Red)) err(`red invalida: ${String(r)}`);
    if (!esObjeto(crudo[r as string])) err(`la red "${String(r)}" esta activa pero no tiene su bloque de configuracion`);
  }
  if (typeof borrar_de_r2_tras_dias !== "number" || borrar_de_r2_tras_dias < 0) {
    err("'borrar_de_r2_tras_dias' debe ser un numero >= 0");
  }

  return { ...(crudo as unknown as Omit<Marca, "id">), id };
}

export async function leerMarcas(): Promise<Marca[]> {
  const crudo: unknown = JSON.parse(await readFile(RUTA_MARCAS, "utf8"));
  if (!esObjeto(crudo)) throw new Error("config/marcas.json debe ser un objeto { idMarca: {...} }");
  return Object.entries(crudo).map(([id, valor]) => validarMarca(id, valor));
}

export async function leerMarca(id: string): Promise<Marca> {
  const marcas = await leerMarcas();
  const marca = marcas.find((m) => m.id === id);
  if (!marca) {
    throw new Error(`Marca desconocida: "${id}". Marcas disponibles: ${marcas.map((m) => m.id).join(", ")}`);
  }
  return marca;
}
