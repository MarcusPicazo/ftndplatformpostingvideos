// Validacion de medios con ffprobe. Solo LEE: nunca modifica, recorta ni recodifica.
// Acepta una URL (p. ej. URL prefirmada de R2): ffprobe lee directo por HTTPS,
// sin descargar el archivo a disco.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface InfoMedio {
  duracion_s: number | null;
  ancho: number | null;
  alto: number | null;
  codec_video: string | null;
  codec_audio: string | null;
  formato: string | null;
}

export interface ResultadoValidacion {
  ok: boolean;
  errores: string[];
  avisos: string[];
  info: InfoMedio | null;
}

interface FfprobeSalida {
  format?: { duration?: string; format_name?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
}

export async function ffprobe(urlOArchivo: string): Promise<InfoMedio> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", urlOArchivo],
    { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 },
  );
  const data = JSON.parse(stdout) as FfprobeSalida;
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  const dur = Number(data.format?.duration);
  return {
    duracion_s: Number.isFinite(dur) ? dur : null,
    ancho: video?.width ?? null,
    alto: video?.height ?? null,
    codec_video: video?.codec_name ?? null,
    codec_audio: audio?.codec_name ?? null,
    formato: data.format?.format_name ?? null,
  };
}

const MB = 1024 * 1024;

// Limites de Instagram Reels / imagen (los mas estrictos de las redes que usamos).
// Referencia: developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
const VIDEO = { maxBytes: 300 * MB, minS: 3, maxS: 15 * 60 };
const IMAGEN = { maxBytes: 8 * MB };

export async function validarMedio(
  url: string,
  tipo: "video" | "imagen",
  bytes: number,
): Promise<ResultadoValidacion> {
  const errores: string[] = [];
  const avisos: string[] = [];
  let info: InfoMedio | null = null;

  try {
    info = await ffprobe(url);
  } catch (e) {
    // Nunca imprimir la URL prefirmada (lleva firma de acceso).
    const msg = (e instanceof Error ? e.message.split("\n").slice(-2).join(" ") : String(e))
      .replaceAll(url, "(archivo)")
      .replace(/https?:\/\/\S+/g, "(url)");
    return { ok: false, errores: [`ffprobe no pudo leer el archivo: ${msg}`], avisos, info };
  }

  if (tipo === "video") {
    if (bytes > VIDEO.maxBytes) errores.push(`pesa ${(bytes / MB).toFixed(0)} MB (maximo ${VIDEO.maxBytes / MB} MB)`);
    if (!info.codec_video) errores.push("no tiene pista de video");
    if (info.duracion_s === null) errores.push("no se pudo leer la duracion");
    else if (info.duracion_s < VIDEO.minS || info.duracion_s > VIDEO.maxS) {
      errores.push(`dura ${info.duracion_s.toFixed(1)} s (debe estar entre ${VIDEO.minS} s y ${VIDEO.maxS / 60} min)`);
    }
    if (info.codec_video && !["h264", "hevc"].includes(info.codec_video)) {
      avisos.push(`codec de video ${info.codec_video}; Instagram recomienda H.264 o HEVC`);
    }
    if (!info.codec_audio) avisos.push("no tiene audio");
    else if (info.codec_audio !== "aac") avisos.push(`codec de audio ${info.codec_audio}; Instagram recomienda AAC`);
  } else {
    if (bytes > IMAGEN.maxBytes) errores.push(`pesa ${(bytes / MB).toFixed(1)} MB (maximo ${IMAGEN.maxBytes / MB} MB)`);
    if (!info.ancho || !info.alto) errores.push("no se pudo leer la imagen");
    if (info.codec_video && info.codec_video !== "mjpeg") {
      avisos.push(`formato ${info.codec_video}; Instagram solo acepta JPEG para imagenes`);
    }
  }

  return { ok: errores.length === 0, errores, avisos, info };
}
