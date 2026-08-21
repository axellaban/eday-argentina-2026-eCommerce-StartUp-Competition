# Demo Day · eCommerce DAY Argentina 2026

Dashboard del jurado + copiloto de evaluación en vivo para las competiciones
del eCommerce DAY Argentina 2026 (eCommerce Institute).

## Dos competiciones, un solo deploy

| | eCommerce StartUp Competition | AI Unified Commerce |
|---|---|---|
| Dashboard | `/ecommerce-startup-competition` | `/ai-unified-commerce` |
| AI Judge | `/ecommerce-startup-competition/ai` | `/ai-unified-commerce/ai` |
| Copiloto | `/ecommerce-startup-competition/copiloto` | `/ai-unified-commerce/copiloto` |
| Indicadores | 6 | 8 |
| Planilla | la suya | la suya |

`/` son dos botones para elegir. **No es la puerta del evento**: en la sala se
entra siempre por el link directo, para que nadie tenga que elegir en una
pantalla proyectada.

Las dos corren el mismo día, una después de la otra, operadas por la misma
persona. Están aisladas igual —canal en vivo, historial y planilla propios—
porque el error caro no es la concurrencia: es la pestaña de la primera que
nadie cerró y que empieza a mostrar los subtítulos de la segunda.

## Las tres pantallas

| Ruta | Quién la usa | Qué hace |
|---|---|---|
| `/{competencia}` | Jurado y público | Radar, podio, barras y tabla de los indicadores, leídos del Google Sheet. |
| `/{competencia}/ai` | Pantalla de sala | Subtítulos en vivo, los indicadores moviéndose, marcas del transcript y fichas. |
| `/{competencia}/copiloto` | El operador (protegida) | Elige el equipo, graba el micrófono, transcribe con Deepgram y analiza el pitch con Gemini. |

El copiloto y la vista AI Judge se comunican por Pusher Channels, cada
competición en **su propio canal**.

Al tocar **Finalizar ficha**, el copiloto le pasa la transcripción completa a
`/api/ficha-final`, que genera la ficha de evaluación (RESUMEN / FORTALEZAS por
indicador / ÁREAS DE MEJORA / VEREDICTO). Esa ficha viaja al dashboard. Si la
generación falla, se guarda igual el pitch con el análisis en vivo que hubiera.

## Agregar una competición

Todo lo que cambia entre competiciones vive en
[`competencias.json`](competencias.json): slug, nombre, color, planilla e
indicadores. Se agrega una entrada y no se toca nada más — de ahí salen las
rutas (`next.config.mjs`), la config del dashboard (`/api/config`), los
prompts, el radar y el parseo de la planilla.

```jsonc
{
  "slug": "mi-competencia",      // define la URL: /mi-competencia
  "nombre": "Mi Competencia",
  "acento": "#34d399",           // color propio, para distinguirla de un vistazo
  "sheetId": "…", "sheetName": "Análisis",
  "indicadores": [ { "key": "…", "icon": "…", "label": "…", "short": "…", "description": "…" } ],
  "equipos": [ { "name": "…", "project": "…" } ]
}
```

Reglas que importan:

- **`key`** viaja en los eventos de Pusher y es la clave de `metrics`. Único
  dentro de la competición, y no se cambia una vez que el evento arrancó.
- **`short`** es lo que va en los vértices del radar. Los `label` largos se
  pisan entre sí, sobre todo con ocho indicadores.
- **`description`** se inyecta en los prompts: es lo que le dice al modelo qué
  está midiendo. Cuanto más concreta, mejor puntúa.
- El **orden** tiene que ser el mismo que el de las columnas de la planilla.

## Los equipos salen de la planilla

El selector del copiloto lee la **columna B** de la planilla de su competición
(`GET /api/equipos`), no una lista en el código. Agregar un equipo el día del
evento es agregar una fila y tocar ↻: no hace falta deployar.

A diferencia del dashboard, un equipo aparece **aunque el jurado todavía no lo
haya puntuado** — existe antes de tener nota, y es justo antes de presentar
cuando el operador lo necesita en el selector.

`equipos` en el registro es **respaldo y enriquecimiento**, no la fuente:

- Si Google no responde, el copiloto usa esa lista y lo dice en pantalla, con
  el motivo. Nunca queda un selector vacío en silencio.
- La planilla no tiene columna de proyecto, así que la descripción sale de acá
  cruzando por nombre. Si no hay coincidencia queda vacía y el operador la
  escribe en el campo de al lado, que siempre fue editable.

Sin equipo elegido el botón de iniciar queda deshabilitado: arrancar un pitch
sin nombre deja al operador grabando mientras cada llamada rebota con 400.

## La planilla del jurado

Las dos tienen la misma forma y sólo cambia el ancho:

```
A: Equipo N°  |  B: Nombre  |  C…: un indicador por columna  |  última: Media Total
```

Con 6 indicadores la Media Total cae en la columna I; con 8, en la K. El
dashboard **calcula** ese layout a partir de la cantidad de indicadores, así
que una competición con nueve criterios ya funciona sin tocar código.

Una fila se toma con que tenga nombre **o** número de equipo, y todos los
indicadores cargados. La hoja tiene que estar compartida como "cualquiera con
el enlace puede ver".

El jurado puntúa **1 a 5** en el Sheet. El análisis en vivo de la IA usa
**0 a 100** (50 = neutro) porque es un medidor que se mueve durante el pitch.

## Aislamiento entre competiciones

Lo que está separado, y por qué:

| Qué | Cómo | Qué pasaría sin esto |
|---|---|---|
| Canal de Pusher | `eday-pitch-{slug}` | La pantalla de una proyecta los subtítulos de la otra |
| Historial y `activeTeam` | clave KV `eday:sessions:{slug}` | La segunda competición le pisa las fichas a la primera |
| Planilla | `sheetId` por competición | Los dos dashboards leen el mismo jurado |
| Borradores del copiloto | `localStorage` con el slug adentro | Un equipo homónimo recupera el borrador de la otra |
| Lista de equipos | `GET /api/equipos?competencia=slug` | El copiloto ofrece los equipos de la otra competición |

`DELETE /api/fichas?competencia=slug&all=1` limpia **sólo** esa competición.

La contraseña es **una sola** para las dos: las opera la misma persona. Si
alguna vez las operan personas distintas, pasa a ser una por competición leída
del registro.

## Variables de entorno

Copiá `.env.example` a `.env.local` (y cargá lo mismo en Vercel → Settings →
Environment Variables).

| Variable | Para qué | Si falta |
|---|---|---|
| `DEEPGRAM_API_KEY` | Tokens efímeros de transcripción | No se puede grabar |
| `GEMINI_API_KEY` | Análisis del pitch e indicadores | Falla el análisis |
| `GEMINI_MODEL`, `GEMINI_MODEL_CALIDAD` | Forzar el modelo | Se descubre solo contra la API |
| `PUSHER_APP_ID`, `PUSHER_SECRET`, `NEXT_PUBLIC_PUSHER_KEY` | Tiempo real | La vista AI Judge no recibe nada (el copiloto lo avisa en rojo) |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Cluster de Pusher | Default `sa1` |
| `ADMIN_PASSWORD` | Contraseña del operador | **El panel queda abierto** y muestra un aviso |
| `NEXT_PUBLIC_SITE_URL` | Dominio para las vistas previas al compartir | Se usa `VERCEL_URL`, y si no el dominio de producción |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN`<br>o `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Persistencia durable | El historial no sobrevive entre invocaciones en Vercel |

`DEEPGRAM_API_KEY` nunca llega al navegador: el servidor pide un token efímero a
`/v1/auth/grant` y sólo manda ese token.

### El modelo de Gemini no está hardcodeado

Estaba clavado en `gemini-2.5-flash` hasta que Google empezó a contestar *"no
longer available to new users"* a las API keys nuevas y se cayó todo el
análisis a la vez. Ahora [`lib/gemini.ts`](lib/gemini.ts) le pregunta a la API
qué modelos tiene habilitados la key y elige, con dos perfiles:

| Perfil | Lo usa | Por qué |
|---|---|---|
| `rapido` | `eval-metrics`, `highlights`, `answer` | Corren cada 12-24s mientras la persona habla: importa la latencia |
| `calidad` | `ficha-final` | Una llamada por equipo, y es el documento que lee el jurado |

Si Google devuelve 404 sobre el modelo elegido, se descarta el cacheado y la
próxima llamada vuelve a resolver. `GET /api/gemini-check` (con la contraseña
del operador) dice cuáles quedaron elegidos, qué tiene habilitado la key y qué
contestó Google.

> Las dos competiciones comparten la misma key de Gemini y de Deepgram. Como
> corren una después de la otra, no se suman en concurrencia. Si alguna vez se
> solaparan, hay que medir el rate limit antes.

### Persistencia

En Vercel el filesystem es de solo lectura fuera de `/tmp` y cada request puede
caer en otra instancia. Sin las variables de KV las fichas se transmiten por
Pusher pero **no quedan guardadas de forma durable**: quien abra la vista AI
Judge después de un pitch puede no ver el historial. Con Vercel KV o Upstash
Redis configurado, sí.

Sirven los dos pares indistintamente — `KV_REST_API_URL` + `KV_REST_API_TOKEN`
(Vercel KV) o `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (Upstash
directo). Lo que no sirve es cargar el token sin la URL: `isDurable()` pide las
dos y con una sola sigue en modo no durable, en silencio.

Para verificarlo, `GET /api/fichas?competencia=slug` devuelve `durable: true|false`.
Ojo que Vercel no aplica variables nuevas a un deploy ya hecho: hay que
redeployar.

## Desarrollo

```bash
npm install
npm run dev            # http://localhost:3000
```

## Deploy

Vercel, framework Next.js.

El dashboard es `public/index.html`: HTML plano sin bundler, servido mediante
rewrites `beforeFiles` en `/{competencia}` y `/{competencia}/ai`. Lee el slug de
su propio `location.pathname` y pide el resto a `/api/config`. **No agregues un
`app/{competencia}/page.tsx`**, porque el routing por filesystem le gana al
rewrite y el dashboard vuelve a quedar en blanco.

Las URLs viejas (`/ai`, `/copiloto`, `/publico`) redirigen a la primera
competición del registro.

### Limitación conocida: la vista previa al compartir

Como las dos competiciones son el mismo archivo HTML y los scrapers de WhatsApp
y LinkedIn no ejecutan JS, la vista previa muestra siempre los metadatos
genéricos del evento. Es a propósito: mejor un título del evento que el link de
una competición previsualizándose con el nombre de la otra.
