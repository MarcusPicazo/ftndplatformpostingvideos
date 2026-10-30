// Ayuda unica para sacar el Page access token (de larga duracion) y el IG_USER_ID.
// Ver Fase 0 de CLAUDE.md para el paso a paso completo (clic por clic).
//
// Uso: npm run obtener-token
//
// Requisitos antes de correrlo:
//   1. META_APP_ID y META_APP_SECRET ya puestos en tu .env (vienen de
//      developers.facebook.com/apps -> tu app -> Configuracion -> Basica).
//   2. Un "User Access Token" de corta duracion sacado a mano en
//      https://developers.facebook.com/tools/explorer :
//        - Arriba a la derecha, selecciona tu app (Publicador Fraternidad).
//        - Boton "Generar token de acceso" (Generate Access Token).
//        - En permisos, agrega: instagram_basic, instagram_content_publish,
//          pages_show_list, pages_read_engagement, pages_manage_posts.
//        - Copia el token que aparece en el cuadro de texto.
//
// El script hace, en orden:
//   1. Cambia el token corto por uno de usuario de larga duracion.
//   2. Pide /me/accounts para listar tus paginas y sus Page Access Tokens.
//      Si el token de usuario es de larga duracion, el Page token tambien
//      queda sin fecha de caducidad.
//   3. Pide a la pagina elegida su instagram_business_account (IG_USER_ID).
//   4. Valida el Page token con debug_token y muestra si caduca o no.
//   5. Imprime el bloque final para pegar en tu .env (y en los Secrets
//      de GitHub cuando llegues al paso 5).

import "dotenv/config";
import { createInterface } from "node:readline/promises";

const GRAPH_VERSION = process.env.GRAPH_VERSION ?? "v26.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta ${name} en tu .env. Revisa el paso 2 de la Fase 0.`);
    process.exit(1);
  }
  return value;
}

async function preguntar(texto: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const respuesta = await rl.question(texto);
    return respuesta.trim();
  } finally {
    rl.close();
  }
}

async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  for (const [clave, valor] of Object.entries(params)) {
    url.searchParams.set(clave, valor);
  }
  const resp = await fetch(url);
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Graph API error en ${path}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main(): Promise<void> {
  const appId = requireEnv("META_APP_ID");
  const appSecret = requireEnv("META_APP_SECRET");

  console.log("--- Publicador Fraternidad: obtener tokens ---\n");

  const tokenCorto = await preguntar(
    "Pega aqui tu User Access Token de corta duracion (de Graph API Explorer): ",
  );
  if (!tokenCorto) {
    console.error("No se recibio ningun token. Cancelando.");
    process.exit(1);
  }

  console.log("\n1) Cambiando el token por uno de usuario de larga duracion...");
  const intercambio = await graphGet("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: tokenCorto,
  });
  const tokenLargo: string = intercambio.access_token;
  console.log("   Listo. Token de usuario de larga duracion obtenido.");

  console.log("\n2) Buscando tus paginas de Facebook (GET /me/accounts)...");
  const cuentas = await graphGet("/me/accounts", { access_token: tokenLargo });
  const paginas: Array<{ id: string; name: string; access_token: string }> = cuentas.data ?? [];

  if (paginas.length === 0) {
    console.error(
      "   No se encontro ninguna pagina. Revisa que tu usuario sea admin de la pagina y que diste los permisos pages_show_list / pages_read_engagement.",
    );
    process.exit(1);
  }

  let pagina = paginas[0]!;
  if (paginas.length > 1) {
    console.log("   Se encontraron varias paginas:");
    paginas.forEach((p, i) => console.log(`     [${i}] ${p.name} (id: ${p.id})`));
    const indice = await preguntar(`   Elige el numero de la pagina de Fraternidad [0]: `);
    const i = indice === "" ? 0 : Number.parseInt(indice, 10);
    pagina = paginas[i] ?? paginas[0]!;
  }
  console.log(`   Usando la pagina: ${pagina.name} (id: ${pagina.id})`);

  const pageToken = pagina.access_token;
  const pageId = pagina.id;

  console.log("\n3) Buscando la cuenta de Instagram vinculada a esa pagina...");
  const infoPagina = await graphGet(`/${pageId}`, {
    fields: "instagram_business_account",
    access_token: pageToken,
  });
  const igUserId: string | undefined = infoPagina.instagram_business_account?.id;
  if (!igUserId) {
    console.error(
      "   No se encontro instagram_business_account. Revisa el paso 1: Instagram debe estar en modo Creador y vinculado a esta pagina.",
    );
    process.exit(1);
  }
  console.log(`   IG_USER_ID: ${igUserId}`);

  console.log("\n4) Validando el Page token (debug_token)...");
  const debug = await graphGet("/debug_token", {
    input_token: pageToken,
    access_token: `${appId}|${appSecret}`,
  });
  const expiraEn: number = debug.data?.expires_at ?? 0;
  if (expiraEn === 0) {
    console.log("   El token no caduca. Correcto.");
  } else {
    console.log(
      `   Atencion: este token SI caduca (expires_at=${expiraEn}). Revisa que el token de usuario original fuera de larga duracion.`,
    );
  }

  console.log("\n--- Listo. Pega esto en tu .env (y luego en los Secrets de GitHub) ---\n");
  console.log(`META_PAGE_TOKEN=${pageToken}`);
  console.log(`META_PAGE_ID=${pageId}`);
  console.log(`IG_USER_ID=${igUserId}`);
  console.log(`GRAPH_VERSION=${GRAPH_VERSION}`);
}

main().catch((error) => {
  console.error("\nError:", error instanceof Error ? error.message : error);
  process.exit(1);
});
