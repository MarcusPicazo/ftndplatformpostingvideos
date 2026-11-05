# Publicador Fraternidad

Publicador automático de los videos del proyecto musical de Marcus ("Fraternidad").
Publica Reels en **Instagram** y en una **página de Facebook** según un calendario,
sin que Marcus tenga que entrar a las redes. Corre en la nube con GitHub Actions.
**TikTok queda fuera de este repo**: se publica aparte, con el conector de TikTok
de Claude mediante una tarea programada.

> **Nota para cualquier instancia de Claude que retome este proyecto:** este
> README es el contexto completo. Marcus construye todo con Claude Code y **no
> programa de forma tradicional** — explícale cada paso manual (paneles de Meta,
> Cloudflare o GitHub) con instrucciones concretas, clic por clic, y separa
> siempre claramente "esto lo haces tú" vs "esto lo hago yo". Verifica tú mismo
> todo lo que se pueda verificar desde código antes de darlo por hecho.

---

## Reglas del proyecto

1. **Costo cero.** Solo capas gratuitas: GitHub Actions, Cloudflare R2 y la Graph
   API de Meta. Si algo requiere pagar, detente y avisa antes de hacerlo.
2. **Disco E:, no C:.** El repo, los videos y cualquier archivo pesado viven en el
   disco E:. La carpeta de trabajo de los videos es `E:\tiktoks rupturas\`. Nunca
   escribir videos ni cachés grandes en C:. (El disco E: es externo — si alguna
   vez parece "desaparecer" del sistema, probablemente se desconectó físicamente,
   no se borró nada.)
3. **No alterar los videos.** Se publican tal cual (horizontal 16:9 a propósito).
   No recortar, no reescalar, no recodificar, salvo que Marcus lo pida.
4. **Secretos fuera del repo.** Tokens y llaves van en GitHub Secrets (nube) y en
   `.env` (local, en `.gitignore`, nunca se sube). Nunca imprimir un token
   completo en logs.
5. **Sin publicaciones duplicadas.** Cada publicación guarda su estado y los IDs
   que devuelve cada red. Antes de publicar, revisar que no exista ya un ID para
   esa red.
6. **Verificar contra la documentación actual de Meta.** Los endpoints de este
   README son la referencia de diseño (Graph API v26.0). Antes de implementar
   cada llamada, confirmar parámetros y versión en developers.facebook.com.
7. **TypeScript estricto**, Node LTS y pocas dependencias.

---

## Arquitectura

```
[compu de Marcus]                         [nube]
E:\tiktoks rupturas\Listos\*.mp4
        │  npm run subir-lote
        ├──► Cloudflare R2  (videos/…mp4)
        └──► calendario.json  ──git push──►  GitHub repo
                                                │  cron cada hora
                                                ▼
                                   GitHub Actions: publicar.ts
                                     ├─► Instagram Reels (Graph API)
                                     ├─► Facebook Page Reels (video_reels)
                                     └─► commit de estados a calendario.json
```

### Estructura de carpetas

```
publicador-fraternidad/
  README.md               # este archivo
  calendario.json
  config.json              # horarios de publicación, zona horaria, redes activas
  src/
    subir-lote.ts          # local: sube videos y agenda (Fase 1, pendiente)
    publicar.ts            # nube: publica lo pendiente (Fase 4, pendiente)
    check.ts                # Fase 0: valida credenciales y R2 (implementado)
    meta/instagram.ts      # Fase 2, pendiente
    meta/facebook.ts       # Fase 3, pendiente
    storage/r2.ts           # cliente R2: listar bucket (implementado; subir/presign pendiente)
    calendario.ts           # leer, escribir y validar calendario.json (pendiente)
    video.ts                # validación con ffprobe, solo lectura (pendiente)
  scripts/
    obtener-token.ts        # ayuda interactiva para sacar el Page token (implementado)
  .github/workflows/publicar.yml   # workflow de GitHub Actions (stub, pendiente)
  .env.example
```

---

## Estado actual (ir actualizando esta sección en cada sesión)

- ✅ Estructura del proyecto creada (`package.json`, `tsconfig.json`, `.gitignore`,
  `.env.example`, carpetas).
- ✅ Repo en GitHub: `MarcusPicazo/ftndplatformpostingvideos` (push hecho).
- ✅ **Fase 0 (código):** `scripts/obtener-token.ts`, `src/check.ts` y
  `src/storage/r2.ts` (función `listarBucket`) implementados y compilando sin
  errores.
- ⏳ **Fase 0 (manual, pendiente que Marcus la haga):**
  - [ ] Paso 1: Instagram en modo Creador vinculado a la página de Facebook
    (requiere celular, o intentar vía Meta Business Suite / instagram.com desde
    compu — no confirmado si funciona en todas las cuentas).
  - [ ] Paso 2: crear app Business en developers.facebook.com, copiar
    `META_APP_ID` y `META_APP_SECRET` al `.env`.
  - [ ] Paso 3: correr `npm run obtener-token` para obtener `META_PAGE_TOKEN`,
    `META_PAGE_ID`, `IG_USER_ID`.
  - [ ] Paso 4: crear cuenta y bucket en Cloudflare R2, copiar
    `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
  - [ ] Paso 5: cargar los 8 valores del `.env` como Secrets en GitHub (excepto
    `META_APP_ID`/`META_APP_SECRET`, esos son solo locales).
  - [ ] Correr `npm run check` para confirmar que todo responde.
- ⏳ **Fase 1 (subir-lote):** no iniciada. Depende de que Fase 0 esté validada.
- ⏳ **Fases 2–5:** no iniciadas.

---

## Datos

### `calendario.json`

```json
[
  {
    "id": "2026-11-03-por-ti-01",
    "archivo_r2": "videos/2026-11-03-por-ti-01.mp4",
    "publicar_en": "2026-11-03T19:30:00-06:00",
    "copy": "texto del post, frases de la letra, hashtags",
    "redes": ["instagram", "facebook"],
    "estado": {
      "instagram": { "status": "pendiente", "container_id": null, "media_id": null, "error": null },
      "facebook":  { "status": "pendiente", "video_id": null, "error": null }
    }
  }
]
```

- `status` puede ser `pendiente`, `procesando`, `publicado` o `error`.
- Las fechas siempre llevan zona horaria. La de Marcus es `America/Mexico_City`
  (UTC-6, sin horario de verano).

### `config.json`

```json
{
  "zona_horaria": "America/Mexico_City",
  "horarios": ["13:00", "19:30"],
  "dias": ["lun", "mar", "mie", "jue", "vie", "sab", "dom"],
  "redes_por_defecto": ["instagram", "facebook"],
  "borrar_de_r2_tras_dias": 7
}
```

### Variables de entorno (`.env`, ver `.env.example`)

```
META_APP_ID=            # solo local, para obtener-token.ts
META_APP_SECRET=        # solo local, para obtener-token.ts

META_PAGE_TOKEN=
META_PAGE_ID=
IG_USER_ID=
GRAPH_VERSION=v26.0
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

---

## Fases

Trabajar una fase a la vez. Al terminar cada una, mostrar cómo probarla y
esperar el visto bueno de Marcus.

### Fase 0: Configuración (manual, guiada) — EN CURSO

Guiar a Marcus paso a paso (ver "Estado actual" arriba para lo que falta):

1. Instagram en modo **Creador** y vinculado a su **página de Facebook**.
2. Crear una app en developers.facebook.com (tipo Business) con Marcus como
   administrador. En modo desarrollo funciona para sus propias cuentas sin
   revisión de Meta. Permisos necesarios (confirmar vigencia en la
   documentación de Meta): `instagram_basic`, `instagram_content_publish`,
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` y
   `business_management` si aplica.
3. Sacar los tokens con `scripts/obtener-token.ts`:
   - Primero un token de usuario de corta duración, que se cambia por uno de
     larga duración.
   - Con ese token, `GET /me/accounts` devuelve el **Page access token**. Si
     sale de un token de usuario de larga duración, no caduca.
   - Luego `GET /{page-id}?fields=instagram_business_account` devuelve el
     `IG_USER_ID`.
   - Al final, valida el token con `debug_token` y confirma que no caduca.
4. Cloudflare R2: crear la cuenta, un bucket privado y un API token con
   permisos de lectura y escritura.
5. Crear el repo en GitHub y cargar los Secrets.

**Prueba:** `npm run check` llama a `/{page-id}`, a `/{ig-user-id}` y a
`content_publishing_limit`, y lista el bucket. Todo debe responder sin
errores.

### Fase 1: `subir-lote` (local) — PENDIENTE

`npm run subir-lote`:

1. Lee `E:\tiktoks rupturas\Listos\*.mp4|*.mov`.
2. Valida cada archivo con `ffprobe`, solo leyendo, sin modificar nada: que
   tenga video y audio, una duración válida para Reels y un tamaño razonable.
   Si uno no pasa, lo reporta y lo salta.
3. Busca el copy en un `.txt` con el mismo nombre del video. Si no existe, deja
   el copy vacío y lo marca como pendiente de revisión.
4. Asigna el siguiente horario libre según `config.json`.
5. Sube el video a R2 como `videos/{id}.mp4` con `@aws-sdk/client-s3` (R2 es
   compatible con S3).
6. Agrega la entrada a `calendario.json`.
7. Mueve el original a `E:\tiktoks rupturas\Programados\`.
8. Hace `git commit` y `git push`.
9. Imprime una tabla con cada video y su fecha.

Incluye una opción `--dry-run` que muestra lo que haría sin subir nada.

### Fase 2: Instagram (`src/meta/instagram.ts`) — PENDIENTE

Flujo con `graph.facebook.com/{GRAPH_VERSION}`:

1. Genera una **URL prefirmada de R2** de solo lectura que dure unas 2 horas.
   Meta descarga el video desde ahí.
2. `POST /{IG_USER_ID}/media` con `media_type=REELS`, `video_url`, `caption` y
   `share_to_feed=true`. Devuelve el `container_id`, que se guarda de inmediato
   en el calendario.
3. Consulta `GET /{container_id}?fields=status_code` cada 15–30 segundos, con
   un máximo de unos 10 minutos:
   - `FINISHED`: sigue al paso 4.
   - `ERROR` o `EXPIRED`: marca el error con el mensaje.
   - Sigue `IN_PROGRESS` al llegar al tiempo máximo: deja el estado en
     `procesando` y lo retoma en la siguiente corrida.
4. `POST /{IG_USER_ID}/media_publish` con `creation_id`. Guarda el `media_id`.

Notas:
- Los contenedores caducan a las 24 horas, por eso se crean justo antes de
  publicar, nunca por adelantado.
- El límite es de unas 100 publicaciones por cuenta cada 24 horas. Consultar
  `content_publishing_limit` antes de publicar.

### Fase 3: Facebook Page Reels (`src/meta/facebook.ts`) — PENDIENTE

1. `POST /{PAGE_ID}/video_reels` con `upload_phase=start`. Devuelve el
   `video_id`.
2. `POST https://rupload.facebook.com/video-upload/{GRAPH_VERSION}/{video_id}`
   con los headers `Authorization: OAuth {PAGE_TOKEN}` y
   `file_url: {URL prefirmada}`.
3. `POST /{PAGE_ID}/video_reels` con `upload_phase=finish`, `video_id`,
   `video_state=PUBLISHED` y `description`.
4. Consulta `GET /{video_id}?fields=status` hasta que quede publicado o falle.

### Fase 4: Workflow (`.github/workflows/publicar.yml` + `src/publicar.ts`) — PENDIENTE

- Se dispara con `schedule: cron "0 * * * *"` (UTC) y con `workflow_dispatch`
  para poder correrlo a mano.
- Usa `concurrency: publicar` para que dos corridas nunca se encimen.
- Necesita `permissions: contents: write` para hacer commit de los estados con
  `GITHUB_TOKEN`.
- `publicar.ts`:
  1. Carga el calendario.
  2. Toma las entradas con `publicar_en <= ahora`, y por cada red que no esté
     `publicado`, publica.
  3. Cada red se procesa por separado: si una falla, la otra sigue.
  4. Guarda el estado **después de cada paso** para no repetir publicaciones.
  5. Reintenta los errores temporales (5xx o rate limit) con backoff. Un error
     permanente deja `status: error` y no se reintenta solo.
  6. Borra de R2 los videos publicados en todas sus redes hace más de
     `borrar_de_r2_tras_dias` días.
  7. Hace commit con el mensaje `chore: estados de publicación [skip ci]`.
- Si alguna publicación termina en `error`, el job sale con código ≠ 0 para
  que GitHub mande el correo de fallo.

### Fase 5: Comodidades (opcional) — PENDIENTE

- `npm run estado`: muestra en tabla lo publicado, lo pendiente y los errores.
- `npm run reintentar <id>`: regresa una entrada en error a `pendiente`.
- `npm run mover <id> <fecha>`: reprograma un video.

---

## Fuera de alcance

- **TikTok.** La API de TikTok solo permite publicar en privado mientras la
  app no pase su auditoría. Se publica aparte con el conector de TikTok de
  Claude, mediante una tarea programada.
- Historias de Instagram, carruseles, música con licencia y analíticas.

## Definición de terminado

- Marcus deja videos y sus `.txt` en `Listos`, corre `npm run subir-lote`, y
  los Reels salen solos en Instagram y Facebook a la hora agendada, con la
  compu apagada.
- Ninguna publicación se duplica.
- Cualquier fallo le llega por correo.
- Costo mensual: $0.
