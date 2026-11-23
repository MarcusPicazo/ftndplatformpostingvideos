// Cliente minimo de la Graph API de Meta (graph.facebook.com).
// - El token va en el header Authorization (nunca en la URL ni en los logs).
// - Reintenta errores temporales con backoff.

const GRAPH_VERSION = process.env.GRAPH_VERSION ?? "v27.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class ErrorGraph extends Error {
  constructor(
    message: string,
    readonly temporal: boolean,
    readonly codigo?: number,
  ) {
    super(message);
  }
}

/** Codigos que Meta documenta como temporales / limite de llamadas. */
const CODIGOS_TEMPORALES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

function ocultar(texto: string, token: string): string {
  return texto.replaceAll(token, "***").replace(/access_token=[^&\s"]+/g, "access_token=***");
}

async function llamar(
  metodo: "GET" | "POST",
  ruta: string,
  token: string,
  params: Record<string, string>,
): Promise<any> {
  const url = new URL(`${GRAPH_BASE}${ruta}`);
  const init: RequestInit = { method: metodo, headers: { Authorization: `Bearer ${token}` } };
  if (metodo === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else {
    init.body = new URLSearchParams(params);
  }

  let resp: Response;
  try {
    resp = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new ErrorGraph(`sin respuesta de Meta: ${e instanceof Error ? e.message : String(e)}`, true);
  }
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok || data?.error) {
    const err = data?.error ?? {};
    const codigo: number | undefined = err.code;
    const detalle = [err.error_user_title, err.error_user_msg].filter(Boolean).join(": ");
    const base = String(err.message ?? `HTTP ${resp.status}`);
    const msg = `${base.startsWith("(#") ? "" : `(#${codigo ?? resp.status}) `}${base}${detalle ? ` — ${detalle}` : ""}`;
    const temporal = resp.status >= 500 || err.is_transient === true || (codigo !== undefined && CODIGOS_TEMPORALES.has(codigo));
    throw new ErrorGraph(ocultar(msg, token), temporal, codigo);
  }
  return data;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Llama a la Graph API reintentando hasta 3 veces los errores temporales (5 s, 20 s, 60 s). */
export async function graph(
  metodo: "GET" | "POST",
  ruta: string,
  token: string,
  params: Record<string, string> = {},
): Promise<any> {
  const pausas = [5_000, 20_000, 60_000];
  for (let intento = 0; ; intento++) {
    try {
      return await llamar(metodo, ruta, token, params);
    } catch (e) {
      const pausa = pausas[intento];
      if (!(e instanceof ErrorGraph) || !e.temporal || pausa === undefined) throw e;
      console.log(`   ↻ error temporal de Meta (${e.message}); reintento en ${pausa / 1000} s`);
      await espera(pausa);
    }
  }
}
