// Fechas con zona horaria, sin dependencias (Intl de Node).

import { DIAS, type Marca } from "./marcas.js";

/** No agendar nada que salga antes de este margen (da tiempo a que corra el workflow). */
const MARGEN_MIN = 30;


export function offsetMinutos(zona: string, utcMs: number): number {
  const parte = new Intl.DateTimeFormat("en-US", { timeZone: zona, timeZoneName: "longOffset" })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(parte);
  if (!m) return 0;
  const signo = m[1] === "-" ? -1 : 1;
  return signo * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Hora local (en `zona`) -> epoch ms UTC, considerando horario de verano. */
export function localAUtc(zona: string, y: number, mes: number, d: number, h: number, min: number): number {
  const ingenuo = Date.UTC(y, mes - 1, d, h, min);
  let utc = ingenuo - offsetMinutos(zona, ingenuo) * 60_000;
  const off2 = offsetMinutos(zona, utc);
  utc = ingenuo - off2 * 60_000;
  return utc;
}

export function isoConZona(zona: string, utcMs: number): string {
  const off = offsetMinutos(zona, utcMs);
  const local = new Date(utcMs + off * 60_000).toISOString().slice(0, 19);
  const signo = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${local}${signo}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function hoyLocal(zona: string, ahora = Date.now()): { y: number; m: number; d: number } {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ahora))
    .split("-")
    .map(Number);
  return { y: y!, m: m!, d: d! };
}

/** Devuelve el siguiente horario libre de la marca, o lanza error si no hay en un año. */
export function siguienteHorario(marca: Marca, ocupados: Set<number>, ahora = Date.now()): number {
  const limite = ahora + MARGEN_MIN * 60_000;
  const { y, m, d } = hoyLocal(marca.zona_horaria, ahora);
  const horarios = [...marca.horarios].sort();
  for (let i = 0; i < 366; i++) {
    const dia = new Date(Date.UTC(y, m - 1, d + i));
    if (!marca.dias.includes(DIAS[dia.getUTCDay()]!)) continue;
    for (const hhmm of horarios) {
      const [h, min] = hhmm.split(":").map(Number);
      const utc = localAUtc(marca.zona_horaria, dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), h!, min!);
      if (utc > limite && !ocupados.has(utc)) return utc;
    }
  }
  throw new Error(`No hay horarios libres en el proximo año para ${marca.nombre}`);
}
