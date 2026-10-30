// Cliente de Cloudflare R2 (compatible con S3).
// Las funciones de subida y URLs prefirmadas se agregan en las Fases 1 y 2.
// Por ahora solo lo necesario para la Fase 0 (npm run check).

import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en tu .env`);
  }
  return value;
}

export function crearClienteR2(): S3Client {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

export async function listarBucket(maxArchivos = 5): Promise<{ total: number; muestra: string[] }> {
  const cliente = crearClienteR2();
  const bucket = requireEnv("R2_BUCKET");
  const respuesta = await cliente.send(
    new ListObjectsV2Command({ Bucket: bucket, MaxKeys: maxArchivos }),
  );
  const muestra = (respuesta.Contents ?? []).map((obj) => obj.Key ?? "(sin nombre)");
  return { total: respuesta.KeyCount ?? 0, muestra };
}
