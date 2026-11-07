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
  vinculada a Facebook.**
- Usa **"Instagram API with Instagram Login"** (`graph.instagram.com`, no
  `graph.facebook.com`). Permisos: `instagram_business_basic` e
  `instagram_business_content_publish`.
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
2. **Disco E:, no C:.** El repo vive donde esté (puede ser cualquier disco),
   pero los videos/imágenes y cualquier archivo pesado viven en el disco E:.
   Nunca escribir medios ni cachés grandes en C:. (El disco E: es externo — si
   alguna vez "desaparece" del sistema, probablemente se desconectó
   físicamente, no se borró nada.)
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
8. **Renovación automática de tokens que caducan.** Instagram Login dura 60
   días; LinkedIn también caduca (revisar su mecanismo de refresh token antes
   de implementar). Si una renovación falla, el workflow falla y le llega
   correo a Marcus.
9. **TypeScript estricto**, Node LTS y pocas dependencias.

---

## Arquitectura

```
[compu de Marcus]                                    [nube]
E:\publicador\{marca}\Listos\*
        │  npm run subir-lote -- --marca ftnd
        ├──► Cloudflare R2  (videos/{marca}/…)
        └──► contenido/{marca}/calendario.json ──git push──► GitHub repo
                                                                  │  cron cada hora
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
    subir-lote.ts            # local: sube medios y agenda --marca <id>
    publicar.ts              # nube: publica lo pendiente de todas las marcas
    check.ts                 # Fase 0: valida credenciales y R2 por marca
    marcas.ts                # leer y validar config/marcas.json
    calendario.ts            # leer, escribir y validar contenido/{marca}/calendario.json
    video.ts                 # validación con ffprobe, solo lectura
    meta/
      instagram-login.ts     # graph.instagram.com — Instagram API with Instagram Login (FTND, y Tezontle si aplica)
      facebook.ts            # graph.facebook.com — Page Reels/Feed y, si aplica, IG vía Facebook Login (Tezontle)
    linkedin/
      linkedin.ts            # Posts API + Videos API (Tezontle, perfil personal primero)
    storage/
      r2.ts
  scripts/
    obtener-token.ts         # ayuda interactiva para sacar tokens (parametrizado por marca/red)
  .github/workflows/publicar.yml
  .env.example
```

### Carpetas locales de medios (disco E:)

```
E:\publicador\ftnd\Listos\        # medios listos para subir de FTND
E:\publicador\ftnd\Programados\   # ya subidos
E:\publicador\tezontle\Listos\
E:\publicador\tezontle\Programados\
```

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
    "instagram": { "modo": "instagram_login", "secret_token": "FTND_IG_TOKEN" }
  },
  "tezontle": {
    "nombre": "Tezontle",
    "zona_horaria": "America/Mexico_City",
    "horarios": ["10:00", "17:00"],
    "dias": ["lun", "mar", "mie", "jue", "vie"],
    "redes_activas": ["instagram", "facebook", "linkedin"],
    "instagram": { "modo": "facebook_login", "secret_token": "TEZONTLE_IG_TOKEN" },
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
    "archivo_r2": "videos/ftnd/2026-11-10-lanzamiento-01.mp4",
    "publicar_en": "2026-11-10T19:30:00-06:00",
    "copy": "texto general, usado si no hay copy especifico por red",
    "redes": ["instagram"],
    "estado": {
      "instagram": { "status": "pendiente", "container_id": null, "media_id": null, "error": null }
    }
  }
]
```

- `status` puede ser `pendiente`, `procesando`, `publicado` o `error`.
- Las fechas siempre llevan zona horaria.

### Variables de entorno (`.env`, ver `.env.example`)

```
GRAPH_VERSION=v26.0

FTND_IG_TOKEN=
FTND_IG_USER_ID=

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
- Crear la app de Meta para **Instagram API with Instagram Login** (para
  FTND), con los permisos `instagram_business_basic` e
  `instagram_business_content_publish`.
- Adaptar `scripts/obtener-token.ts` y `src/check.ts` para trabajar por marca.
- R2: decidir si se reutiliza el bucket existente con prefijo `videos/{marca}/`
  o se crea uno nuevo.
- Secrets en GitHub con prefijo por marca.

### Fase 1: `subir-lote` multi-marca

- `npm run subir-lote -- --marca ftnd` (o `tezontle`).
- Lee `E:\publicador\{marca}\Listos\`, valida con ffprobe, busca copy general
  y copys específicos por red, sube a R2 bajo `videos/{marca}/`, agrega al
  `calendario.json` de esa marca, mueve a `Programados`.

### Fase 2: FTND → Instagram completo (punta a punta)

- `src/meta/instagram-login.ts`: crear contenedor, verificar estado, publicar.
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

- Marcus deja medios y sus `.txt` en `Listos\{marca}`, corre
  `npm run subir-lote -- --marca <marca>`, y el contenido sale solo en las
  redes activas de cada marca a la hora agendada, con la compu apagada.
- Ninguna publicación se duplica.
- Los tokens se renuevan solos antes de caducar.
- Cualquier fallo le llega por correo.
- Costo mensual: $0.
