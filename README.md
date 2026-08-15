# eDAY Argentina 2026 — eCommerce StartUp Competition

Dashboard del jurado + copiloto de evaluación en vivo para la eCommerce StartUp
Competition Argentina 2026 (eCommerce Institute).

## Las tres pantallas

| Ruta | Quién la usa | Qué hace |
|---|---|---|
| `/` | Jurado y público | Dashboard: radar, podio, barras y tabla de los **6 indicadores**, leídos del Google Sheet. Abajo, las fichas de evaluación. |
| `/copiloto` | El operador (protegida) | Elige el equipo, graba el micrófono, transcribe con Deepgram y analiza el pitch con Gemini. |
| `/publico` | Pantalla de sala | Subtítulos en vivo, los 6 indicadores moviéndose y el historial de fichas. |

`/copiloto` y `/publico` se comunican por Pusher Channels en tiempo real.

Al tocar **Finalizar ficha**, el copiloto le pasa la transcripción completa a
`/api/ficha-final`, que genera la ficha de evaluación con el mismo formato y
nivel de detalle que las fichas de referencia (RESUMEN / FORTALEZAS por
indicador / ÁREAS DE MEJORA / VEREDICTO). Esa ficha viaja a la pantalla
pública y al dashboard. Si la generación falla, se guarda igual el pitch con
el análisis en vivo que hubiera.

## Los 6 indicadores

Definidos una sola vez en [`lib/criteria.ts`](lib/criteria.ts), en el mismo orden
que las columnas **C a H** de la hoja `Análisis`:

1. 🌍 Potencial de Mercado
2. 🧲 Producto y Adopción
3. 🧱 Innovación y Tecnología
4. 🏃 Ejecución y Avance
5. 👥 Perfil del Equipo y Visión
6. 👁️ Percepción Personal

El jurado puntúa de **1 a 5** en el Sheet (columna I = Media Total). El análisis
en vivo de la IA usa **0 a 100** (50 = neutro) porque es un medidor que se mueve
durante el pitch.

> El dashboard es HTML plano sin bundler, así que replica esta lista en su propia
> constante `CRITERIA` dentro de `public/index.html`. Si cambiás una, cambiá la otra.

## Fuente de datos del jurado

Google Sheet `1Ust7i7HhsPrJdQxJ3v-GvhulQjfC_eCJxXCHuFxDvbc`, hoja **`Análisis`**,
leída como CSV vía `gviz/tq`. Layout esperado:

```
A: Equipo N°  |  B: Nombre  |  C–H: los 6 indicadores  |  I: Media Total
```

El Sheet tiene que estar compartido como "cualquiera con el enlace puede ver".

## Variables de entorno

Copiá `.env.example` a `.env.local` (y cargá lo mismo en Vercel → Settings →
Environment Variables).

| Variable | Para qué | Si falta |
|---|---|---|
| `DEEPGRAM_API_KEY` | Tokens efímeros de transcripción | No se puede grabar |
| `GEMINI_API_KEY` | Análisis del pitch e indicadores | Falla el análisis |
| `GEMINI_MODEL`, `GEMINI_MODEL_CALIDAD` | Forzar el modelo | Se descubre solo contra la API |
| `PUSHER_APP_ID`, `PUSHER_SECRET`, `NEXT_PUBLIC_PUSHER_KEY` | Tiempo real | La pantalla pública no recibe nada (el copiloto lo avisa en rojo) |
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

### Persistencia

En Vercel el filesystem es de solo lectura fuera de `/tmp` y cada request puede
caer en otra instancia. Sin las variables de KV las fichas se transmiten por
Pusher pero **no quedan guardadas de forma durable**: quien abra `/publico`
después de un pitch puede no ver el historial. Con Vercel KV o Upstash Redis
configurado, sí.

Sirven los dos pares indistintamente — `KV_REST_API_URL` + `KV_REST_API_TOKEN`
(Vercel KV) o `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (Upstash
directo). Lo que no sirve es cargar el token sin la URL: `isDurable()` pide las
dos y con una sola sigue en modo no durable, en silencio.

Para verificarlo, `GET /api/fichas` devuelve `durable: true|false`. Ojo que
Vercel no aplica variables nuevas a un deploy ya hecho: hay que redeployar.

## Desarrollo

```bash
npm install
npm run dev            # http://localhost:3000
```

Para el dashboard solo, sin Next (sirve `public/`):

```bash
python3 servidor.py    # http://localhost:8080
```

## Deploy

Vercel, framework Next.js. `/` se sirve mediante un rewrite `beforeFiles` hacia
`public/index.html`; **no agregues un `app/page.tsx`**, porque el routing por
filesystem le gana al rewrite y la home vuelve a quedar en blanco.
