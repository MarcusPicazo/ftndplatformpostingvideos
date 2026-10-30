// Fase 0: prueba de configuracion.
// Llama a /{page-id}, /{ig-user-id}, content_publishing_limit y lista el bucket de R2.
// Uso: npm run check

import "dotenv/config";
import { listarBucket } from "./storage/r2.js";

const GRAPH_VERSION = process.env.GRAPH_VERSION ?? "v26.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en tu .env`);
  }
  return value;
}

async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [clave, valor] of Object.entries(params)) {
    url.searchParams.set(clave, valor);
  }
  const resp = await fetch(url);
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

async function paso(nombre: string, accion: () => Promise<string>): Promise<boolean> {
  try {
    const detalle = await accion();
    console.log(`✅ ${nombre}: ${detalle}`);
    return true;
  } catch (error) {
    console.log(`❌ ${nombre}: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function main(): Promise<void> {
  const pageToken = requireEnv("META_PAGE_TOKEN");
  const pageId = requireEnv("META_PAGE_ID");
  const igUserId = requireEnv("IG_USER_ID");

  console.log("--- Publicador Fraternidad: check ---\n");

  const resultados = await Promise.all([
    paso("Pagina de Facebook", async () => {
      const data = await graphGet(`/${pageId}`, { fields: "name", access_token: pageToken });
      return `"${data.name}" (id: ${pageId})`;
    }),
    paso("Cuenta de Instagram", async () => {
      const data = await graphGet(`/${igUserId}`, {
        fields: "username",
        access_token: pageToken,
      });
      return `@${data.username} (id: ${igUserId})`;
    }),
    paso("Limite de publicacion de Instagram", async () => {
      const data = await graphGet(`/${igUserId}/content_publishing_limit`, {
        access_token: pageToken,
      });
      const uso = data.data?.[0];
      return uso
        ? `${uso.quota_usage}/${uso.config?.quota_total ?? "?"} publicaciones usadas en las ultimas 24h`
        : "sin datos";
    }),
    paso("Bucket de R2", async () => {
      const { total, muestra } = await listarBucket();
      return `${total} archivo(s). Ejemplo: ${muestra.join(", ") || "(bucket vacio)"}`;
    }),
  ]);

  console.log();
  if (resultados.every(Boolean)) {
    console.log("Todo listo. Puedes seguir con la Fase 1.");
  } else {
    console.log("Hay pasos con error. Revisa los mensajes de arriba antes de continuar.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("\nError inesperado:", error instanceof Error ? error.message : error);
  process.exit(1);
});
