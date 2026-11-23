// Cliente de Cloudflare R2 (compatible con S3).
// Todo opera directo en R2: listar, leer texto, URLs prefirmadas y mover
// objetos con copia del lado del servidor (los bytes no pasan por ningun disco
// local y no se alteran).

import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} (en .env local o en GitHub Secrets)`);
  }
  return value;
}

let clienteCache: S3Client | null = null;

export function crearClienteR2(): S3Client {
  if (clienteCache) return clienteCache;
  const accountId = requireEnv("R2_ACCOUNT_ID");
  clienteCache = new S3Client({
    region: "auto",
    // R2_ENDPOINT solo se usa para pruebas locales con un S3 simulado.
    endpoint: process.env.R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: !!process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return clienteCache;
}

export function bucketR2(): string {
  return requireEnv("R2_BUCKET");
}

export interface ObjetoR2 {
  key: string;
  bytes: number;
  etag: string;
  /** Fecha de ultima modificacion (epoch ms). */
  modificado: number;
}

export async function listarBucket(maxArchivos = 5): Promise<{ total: number; muestra: string[] }> {
  const respuesta = await crearClienteR2().send(
    new ListObjectsV2Command({ Bucket: bucketR2(), MaxKeys: maxArchivos }),
  );
  const muestra = (respuesta.Contents ?? []).map((obj) => obj.Key ?? "(sin nombre)");
  return { total: respuesta.KeyCount ?? 0, muestra };
}

/** Lista todos los objetos bajo un prefijo (pagina automaticamente). */
export async function listarPrefijo(prefijo: string): Promise<ObjetoR2[]> {
  const objetos: ObjetoR2[] = [];
  let token: string | undefined;
  do {
    const resp = await crearClienteR2().send(
      new ListObjectsV2Command({ Bucket: bucketR2(), Prefix: prefijo, ContinuationToken: token }),
    );
    for (const o of resp.Contents ?? []) {
      if (o.Key) {
        objetos.push({
          key: o.Key,
          bytes: o.Size ?? 0,
          etag: (o.ETag ?? "").replaceAll('"', ""),
          modificado: o.LastModified?.getTime() ?? 0,
        });
      }
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return objetos;
}

export async function existe(key: string): Promise<boolean> {
  try {
    await crearClienteR2().send(new HeadObjectCommand({ Bucket: bucketR2(), Key: key }));
    return true;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw e;
  }
}

export async function leerTexto(key: string): Promise<string> {
  const resp = await crearClienteR2().send(new GetObjectCommand({ Bucket: bucketR2(), Key: key }));
  if (!resp.Body) return "";
  return await resp.Body.transformToString("utf-8");
}

/** URL prefirmada de solo lectura (para ffprobe y para que Meta/LinkedIn descarguen el medio). */
export async function urlPrefirmada(key: string, segundos = 2 * 60 * 60): Promise<string> {
  return await getSignedUrl(
    crearClienteR2(),
    new GetObjectCommand({ Bucket: bucketR2(), Key: key }),
    { expiresIn: segundos },
  );
}

/** Copia del lado del servidor dentro del bucket. Los bytes quedan identicos. */
export async function copiar(origen: string, destino: string): Promise<void> {
  const bucket = bucketR2();
  await crearClienteR2().send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: destino,
      CopySource: `${bucket}/${origen.split("/").map(encodeURIComponent).join("/")}`,
    }),
  );
}

/** Escribe un texto pequeño (notas de rechazo, marcadores de carpeta). Nunca se usa para medios. */
export async function escribirTexto(key: string, texto: string): Promise<void> {
  await crearClienteR2().send(
    new PutObjectCommand({
      Bucket: bucketR2(),
      Key: key,
      Body: Buffer.from(texto, "utf8"),
      ContentLength: Buffer.byteLength(texto, "utf8"),
      ContentType: "text/plain; charset=utf-8",
    }),
  );
}

export async function borrar(key: string): Promise<void> {
  await crearClienteR2().send(new DeleteObjectCommand({ Bucket: bucketR2(), Key: key }));
}
