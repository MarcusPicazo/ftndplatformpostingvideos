# Publicador multi-marca

Plataforma que publica contenido automáticamente para **varias marcas**, cada
una con sus propias cuentas, credenciales, carpeta de videos/imágenes y
calendario. Corre en la nube con GitHub Actions, sin que Marcus tenga que
entrar a las redes.

Marcus construye todo con Claude Code y **no programa de forma tradicional**.
Explícale cada paso manual (paneles de Meta, LinkedIn, Cloudflare o GitHub)
con instrucciones concretas, clic por clic, y separa siempre claramente "esto
lo haces tú" vs "esto lo hago yo". Verifica tú mismo todo lo que se pueda
verificar desde código.

---

## Marcas

### FTND (proyecto musical)

- **Instagram** `@ftnd_music`, cuenta **Creador**. **No está ni va a estar
  vinculada a una página de Facebook.**
- Usa **"Instagram API with Unified Login"** (inicio de sesión unificado).
  Las apps de Meta nuevas (desde finales de oct 2026) ya no ofrecen
  "Instagram API with Instagram Login"; Meta recomienda Unified Login y **no
  requiere página de Facebook**.
  - App de Meta: "FTND Publicador", caso de uso "Administrar mensajes y
    contenido en Instagram", propiedad del portfolio comercial **"FTND"**
    (obligatorio para Unified Login). `@ftnd_music` se agrega al portfolio
    como activo "cuenta de Instagram" — eso **no** es vincularla a una página.
  - Host: **`graph.facebook.com`** (no `graph.instagram.com`).
  - Permisos: `instagram_basic` e `instagram_content_publish` (más
    `instagram_manage_messages` solo si Meta lo marca como obligatorio en la
    configuración; el código no lo usa).
  - Token: **Business Integration System User Access Token (SUAT)** con
    caducidad **"Nunca"** (se elige al crear la configuración). No hay que
    renovarlo; solo deja de funcionar si se quita la app del portfolio o se
    mueve la cuenta a otro portfolio.
  - El ID de la cuenta se obtiene con `GET /me/assigned_instagram_accounts`
    (con este token, `/me` es el usuario del sistema, no la cuenta de IG).
  - Docs: developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
- Sin Facebook, sin LinkedIn.
- **TikTok y YouTube quedan fuera de esta plataforma** (se publican por otra
  vía: TikTok con el conector de TikTok de Claude mediante tarea programada).
- Siempre que un paso implique iniciar sesión en el Instagram de FTND,
  recuérdale a Marcus hacerlo en **ventana de incógnito** con `@ftnd_music`
  (para no mezclar sesiones con su cuenta personal).

### Tezontle (selectores 3D para desarrolladoras inmobiliarias, B2B)

- **Instagram**: puede usar Instagram Login o Facebook Login — aquí **sí** se
  permite vincular a una página de Facebook.
- **Facebook**: página de Tezontle. Page token que no caduca. Endpoint
  `video_reels` para video, `/photos` o `/feed` para imagen y texto.
- **LinkedIn**: publicar texto, imagen y video.
  - Empezar por el **perfil personal** de Marcus: producto "Share on
    LinkedIn", permiso `w_member_social`, Posts API + Videos API.
  - Publicar en la **página de empresa** requiere aprobación del **Community
    Management API** — se deja como **fase posterior**; avisar a Marcus si
    hace falta solicitar acceso cuando se llegue a ese punto.
  - Verificar en la documentación actual de LinkedIn (developer.linkedin.com)
    qué operaciones son autoservicio antes de implementar, y cómo funciona la
    renovación de tokens (ver "Renovación de tokens" abajo).
- Sin TikTok por ahora.

---

## Reglas del proyecto

1. **Costo cero.** Solo capas gratuitas: GitHub Actions, Cloudflare R2, Graph
   API de Meta, API de LinkedIn. Si algo requiere pagar, detente y avisa antes
   de hacerlo.
2. **Todo en la nube, sin discos locales.** El proyecto vive y se trabaja en
   Claude Code en la nube (repo en GitHub). Los videos/imágenes **no viven en
   ningún disco local** (ya no se usa el disco E:): Marcus los sube directo a
   Cloudflare R2 desde el navegador, a `entrada/{marca}/`. Ningún script
   descarga medios a disco: se validan con ffprobe leyendo de una URL
   prefirmada y se mueven dentro de R2 con copia del lado del servidor.
3. **No alterar los videos.** Se publican tal cual. No recortar, no
   reescalar, no recodificar, salvo que Marcus lo pida.
4. **Secretos fuera del repo.** Tokens y llaves van en GitHub Secrets (nube) y
   en `.env` (local, en `.gitignore`, nunca se sube). Nunca imprimir un token
   completo en logs. Secrets con **prefijo por marca**:
   `FTND_IG_TOKEN`, `TEZONTLE_IG_TOKEN`, `TEZONTLE_FB_PAGE_TOKEN`,
   `TEZONTLE_LINKEDIN_TOKEN`, etc.
5. **Sin publicaciones duplicadas.** Cada publicación guarda su estado y los
   IDs que devuelve cada red. Antes de publicar, revisar que no exista ya un
   ID para esa red.
6. **Cada red de cada marca se procesa por separado.** Si una falla, las
   demás siguen (de la misma marca y de otras marcas).
7. **Verifica contra la documentación actual** de Meta y de LinkedIn antes de
   implementar cada llamada (endpoints, parámetros, versión, permisos).
8. **Renovación automática de tokens que caducan.** El SUAT de FTND (Unified
   Login, caducidad "Nunca") no se renueva, pero `check` lo valida y si deja
   de funcionar el workflow falla. Instagram Login (si alguna marca lo usara)
   dura 60 días; LinkedIn también caduca (revisar su mecanismo de refresh token antes
   de implementar). Si una renovación falla, el workflow falla y le llega
   correo a Marcus.
9. **TypeScript estricto**, Node LTS y pocas dependencias.

---

## Arquitectura

```
[navegador de Marcus]
  dashboard de Cloudflare ──► R2: entrada/{marca}/archivo.mp4 (+ archivo.txt)
                                        │  GitHub Actions "Subir lote" (subir-lote.ts, solo cada 30 min)
                                        ├──► R2: videos/{marca}/{id}.mp4 (copia idéntica)
                                        └──► contenido/{marca}/calendario.json ──commit──► GitHub repo
                                                                  │  cron cada 30 min (:02 y :32)
                                                                  ▼
                                                     GitHub Actions: publicar.ts
                                                       ├─► por cada marca activa:
                                                       │     ├─► Instagram (Login o vía FB)
                                                       │     ├─► Facebook Page Reels/Feed
                                                       │     └─► LinkedIn (perfil, luego página)
                                                       ├─► renovación de tokens por vencer
                                                       └─► commit de estados a cada calendario.json
```

### Estructura de carpetas

```
publicador-fraternidad/
  CLAUDE.md
  README.md
  config/
    marcas.json              # cada marca: redes activas, horarios, zona horaria, nombres de sus secrets
  contenido/
    ftnd/calendario.json
    tezontle/calendario.json
  src/
    subir-lote.ts            # nube: agenda lo que hay en R2 entrada/{marca}/ --marca <id>
    fechas.ts                # horarios libres y fechas con zona horaria
    publicar.ts              # nube: publica lo pendiente de todas las marcas
    check.ts                 # Fase 0: valida credenciales y R2 por marca
    marcas.ts                # leer y validar config/marcas.json
    calendario.ts            # leer, escribir y validar contenido/{marca}/calendario.json
    video.ts                 # validación con ffprobe, solo lectura
    meta/
      graph.ts               # cliente Graph API: token en header, reintentos con backoff
      instagram.ts           # graph.facebook.com — publicar en IG (Unified Login para FTND; Facebook Login para Tezontle; mismos endpoints)
      facebook.ts            # graph.facebook.com — Page Reels/Feed (Tezontle)
    linkedin/
      linkedin.ts            # Posts API + Videos API (Tezontle, perfil personal primero)
    storage/
      r2.ts
  scripts/
    obtener-token.ts         # ayuda interactiva para sacar tokens (parametrizado por marca/red)
  .github/workflows/publicar.yml     # cada 30 min y manual (Run workflow, opcion "id" para publicar ya)
  .github/workflows/subir-lote.yml   # cada 30 min y manual (Run workflow): agenda y hace commit
  .github/workflows/check.yml        # manual (Run workflow): valida credenciales y R2
  .env.example
```

### Carpetas de medios en R2

```
entrada/ftnd/        # Marcus sube aquí (desde el navegador) lo listo de FTND
entrada/tezontle/    # ídem Tezontle
videos/ftnd/         # ya agendado (lo mueve subir-lote; se publica desde aquí)
videos/tezontle/
```

Se procesan solo los archivos directamente dentro de `entrada/{marca}/`
(videos `.mp4`/`.mov`, imágenes `.jpg`/`.jpeg`/`.png`), en orden alfabético
(para controlar el orden, nombrarlos `01-…`, `02-…`). Lo que no pasa la
validación se mueve a `entrada/{marca}/rechazados/` con un
`archivo.motivo.txt`, y esa corrida del workflow falla (una sola vez) para
avisar por correo.

- El panel de Cloudflare solo deja subir archivos de **hasta 300 MB** desde el
  navegador (coincide con el máximo de Instagram para Reels por API).
- Marcus no puede mandar los videos por el chat de Claude para que se suban:
  las llaves de R2 solo viven en GitHub Secrets, y la firma de R2 (S3 SigV4)
  no se puede inyectar por el proxy del entorno de Claude. La vía es el panel
  de Cloudflare.

Cada video o imagen puede llevar un `.txt` con el mismo nombre para el copy
general. Opcionalmente, copys distintos por red:
`archivo.instagram.txt`, `archivo.linkedin.txt`, `archivo.facebook.txt`. Si no
existe uno específico para una red, se usa el `.txt` general.

---

## Datos

### `config/marcas.json`

```json
{
  "ftnd": {
    "nombre": "FTND",
    "zona_horaria": "America/Mexico_City",
    "horarios": ["13:00", "19:30"],
    "dias": ["lun", "mar", "mie", "jue", "vie", "sab", "dom"],
    "redes_activas": ["instagram"],
    "instagram": { "modo": "unified_login", "secret_token": "FTND_IG_TOKEN", "secret_user_id": "FTND_IG_USER_ID" }
  },
  "tezontle": {
    "nombre": "Tezontle",
    "zona_horaria": "America/Mexico_City",
    "horarios": ["10:00", "17:00"],
    "dias": ["lun", "mar", "mie", "jue", "vie"],
    "redes_activas": ["instagram", "facebook", "linkedin"],
    "instagram": { "modo": "facebook_login", "secret_token": "TEZONTLE_IG_TOKEN", "secret_user_id": "TEZONTLE_IG_USER_ID" },
    "facebook": { "secret_token": "TEZONTLE_FB_PAGE_TOKEN" },
    "linkedin": { "alcance": "perfil_personal", "secret_token": "TEZONTLE_LINKEDIN_TOKEN" }
  }
}
```

### `contenido/{marca}/calendario.json`

```json
[
  {
    "id": "2026-11-10-lanzamiento-01",
    "marca": "ftnd",
    "tipo": "video",
    "archivo_r2": "videos/ftnd/2026-11-10-lanzamiento-01.mp4",
    "publicar_en": "2026-11-10T19:30:00-06:00",
    "copy": "texto general, usado si no hay copy especifico por red",
    "copys": { "instagram": "opcional, de archivo.instagram.txt" },
    "redes": ["instagram"],
    "estado": {
      "instagram": { "status": "pendiente", "container_id": null, "media_id": null, "error": null }
    },
    "origen": { "key": "entrada/ftnd/lanzamiento-01.mp4", "etag": "…" }
  }
]
```

- `status` puede ser `pendiente`, `procesando`, `publicado` o `error`.
- Las fechas siempre llevan zona horaria.

### Variables de entorno (`.env`, ver `.env.example`)

```
GRAPH_VERSION=v27.0

META_APP_ID=            # app "FTND Publicador"; check lo usa para debug_token
META_APP_SECRET=        # (un SUAT no puede revisar su propia caducidad)

FTND_IG_TOKEN=          # SUAT de Unified Login (caducidad "Nunca")
FTND_IG_USER_ID=        # opcional: check lo descubre con /me/assigned_instagram_accounts

TEZONTLE_IG_TOKEN=
TEZONTLE_IG_USER_ID=
TEZONTLE_FB_PAGE_TOKEN=
TEZONTLE_FB_PAGE_ID=
TEZONTLE_LINKEDIN_TOKEN=
TEZONTLE_LINKEDIN_PERSON_URN=

R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

(Los nombres exactos se confirman al implementar cada integración; esto es
referencia inicial.)

---

## Fases

Trabajar **un paso a la vez** y esperar a que Marcus diga "listo" antes de
seguir. Explicarle cada paso manual clic por clic.

### Fase 0: Configuración base multi-marca

- Crear `config/marcas.json` y las carpetas `contenido/{marca}/`.
- Crear la app de Meta para **Instagram API with Unified Login** (para FTND):
  portfolio "FTND", configuración con SUAT caducidad "Nunca", activo cuenta de
  Instagram `@ftnd_music`, permisos `instagram_basic` e
  `instagram_content_publish`. El token se genera en el panel ("Generar
  token"), sin servidor propio.
- Adaptar `scripts/obtener-token.ts` y `src/check.ts` para trabajar por marca.
- R2: decidir si se reutiliza el bucket existente con prefijo `videos/{marca}/`
  o se crea uno nuevo.
- Secrets en GitHub con prefijo por marca.

### Fase 1: `subir-lote` multi-marca

- `npm run subir-lote -- --marca ftnd` (o `tezontle`; sin `--marca` procesa
  todas; `--simular` no cambia nada; `--espera 10` ignora lo subido hace
  menos de 10 min). El workflow "Subir lote" corre **solo cada 30 min**
  (con `--espera 10`, para que el `.txt` alcance a llegar) y también a mano
  (Run workflow, sin espera); en ambos casos hace commit del calendario.
- Si no existen, crea los marcadores `entrada/{marca}/` para que la carpeta se
  vea en el panel de Cloudflare.
- Lista R2 `entrada/{marca}/`, valida con ffprobe sobre URL prefirmada (sin
  descargar), lee copy general y copys por red, asigna el siguiente horario
  libre, copia a `videos/{marca}/{id}.ext` (copia del servidor, bytes
  idénticos), agrega al `calendario.json` y borra el original y sus `.txt` de
  `entrada/`. Guarda `origen` (key + etag) para que una re-ejecución no
  duplique.

### Fase 2: FTND → Instagram completo (punta a punta)

- `src/meta/instagram.ts` (graph.facebook.com): `POST /{ig-id}/media`
  (`media_type=REELS` + `video_url` prefirmada, o `image_url` JPEG), revisar
  `status_code` del contenedor, `POST /{ig-id}/media_publish`. Límite: 100
  publicaciones por API en 24 h (`content_publishing_limit`).
- Implementado: `src/meta/graph.ts` (token en header `Authorization`, nunca
  en la URL; reintenta errores temporales 5 s / 20 s / 60 s) y
  `src/meta/instagram.ts` (guarda `container_id` en cuanto se crea; si una
  corrida se corta, la siguiente reanuda ese contenedor y, si Meta dice
  `PUBLISHED`, no vuelve a publicar). Revisa el contenedor 1 vez por minuto
  hasta 6 min; si sigue `IN_PROGRESS` queda en `procesando` para la siguiente
  corrida. Guarda `media_id`, `permalink` y `publicado_en`.
- `publicar.ts` + workflow "Publicar" (cada 30 min, y manual con `id` para
  publicar una entrada de inmediato o `simular`).
- `subir-lote` rechaza imágenes que no sean JPEG si la marca publica en
  Instagram.
- Probar con un video real de FTND hasta verlo publicado en
  `@ftnd_music`.

### Fase 3: Tezontle → Instagram

- Mismo flujo, pero vía Facebook Login (según cómo quede vinculada la cuenta
  de Instagram de Tezontle).

### Fase 4: Tezontle → Facebook

- `src/meta/facebook.ts`: `video_reels` para video, `/photos` o `/feed` para
  imagen y texto.

### Fase 5: Tezontle → LinkedIn (perfil personal)

- `src/linkedin/linkedin.ts`: Posts API + Videos API, permiso
  `w_member_social`.
- Página de empresa queda para una fase posterior (requiere aprobación de
  Community Management API).

### Fase 6: Workflow multi-marca + renovación de tokens

- `.github/workflows/publicar.yml` corre `publicar.ts` cada hora
  (`workflow_dispatch` también), `concurrency: publicar`,
  `permissions: contents: write`.
- `publicar.ts` recorre todas las marcas activas, publica lo pendiente de cada
  red por separado, guarda estado después de cada paso, reintenta errores
  temporales con backoff, renueva tokens por vencer, borra de R2 lo publicado
  hace más de `borrar_de_r2_tras_dias` días, hace commit de estados.
- Si algo termina en `error`, el job sale con código ≠ 0 para que llegue el
  correo de fallo.

### Fase 7: Comodidades (opcional, por marca)

- `npm run estado -- --marca ftnd`
- `npm run reintentar <id>`
- `npm run mover <id> <fecha>`

### Fase posterior: LinkedIn página de empresa

- Solicitar acceso al Community Management API cuando se llegue aquí.

---

## Fuera de alcance

- **TikTok y YouTube** para FTND (se publican por otra vía).
- **TikTok** para Tezontle (por ahora).
- Historias de Instagram, carruseles, música con licencia y analíticas.
- LinkedIn página de empresa (hasta que se apruebe el Community Management
  API).

## Definición de terminado

- Marcus sube medios y sus `.txt` a R2 `entrada/{marca}/` desde el navegador,
  "Subir lote" los agenda solo (cada 30 min), y el contenido sale solo
  en las redes activas de cada marca a la hora agendada, sin ninguna compu
  prendida.
- Ninguna publicación se duplica.
- Los tokens se renuevan solos antes de caducar.
- Cualquier fallo le llega por correo.
- Costo mensual: $0.
