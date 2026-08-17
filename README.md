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
| `rapido` | `eval-metrics`, `highlights` | Corren cada 12-24s mientras la persona habla: importa la latencia |
| `calidad` | `ficha-final` | Una llamada por equipo, y es el documento que lee el jurado |

Si Google devuelve 404 sobre el modelo elegido, se descarta el cacheado y la
próxima llamada vuelve a resolver. `GET /api/gemini-check` (con la contraseña
del operador) dice cuáles quedaron elegidos, qué tiene habilitado la key y qué
contestó Google.

#### Cambiar de modelo cambia la forma de la respuesta

El modelo del perfil `calidad` **razona antes de contestar**, y eso trae dos
cosas que el del perfil `rapido` no tiene:

1. El razonamiento viene como una **parte aparte** dentro de `content.parts`,
   marcada con `thought: true`, antes de la respuesta. Leer `parts[0].text`
   —que era lo que hacían las cuatro rutas— devuelve el razonamiento, no la
   ficha. Para eso está `textoGemini()`, que junta todas las partes salteando
   las de razonamiento. Usalo siempre; no leas `parts[0]` a mano.
2. El razonamiento **comparte `maxOutputTokens`** con la respuesta. Con el tope
   en 2400 la ficha salía cortada justo antes del VEREDICTO, que es la última
   sección. Por eso ahora son 8000 con un techo de razonamiento de 1024.

Las dos juntas hacían que la ficha se descartara entera con un "El modelo no
devolvió la ficha en el formato esperado", con todo lo demás del sistema
andando bien. Para no tener que ensayar un pitch entero para detectarlo:

```
GET /api/gemini-check?ficha=1
```

genera una ficha real sobre un transcript de juguete y devuelve si llegó el
veredicto, en cuántas partes vino la respuesta, cuántas eran de razonamiento y
por qué cortó el modelo.

### `GET /api/fichas` viene en dos tamaños

Es la ruta que consulta cada celular de la sala desde el AI Judge, cada 5 a 15
segundos. Con diez equipos cerrados, la respuesta completa pesaba 201 KB —los
transcripts iban dos veces, dentro de `finishedSessions` y otra vez dentro de
`allSessions`— para dibujar fichas que se arman con `analysis`, no con el
transcript.

| Pedido | Qué trae | Quién lo usa |
|---|---|---|
| `GET /api/fichas` | Sin `allSessions`; cada ficha cerrada con `transcriptAsomo` (600 caracteres) y `transcriptLargo` en vez del transcript entero. ~26 KB. | El AI Judge del home: toda la sala |
| `GET /api/fichas?full=1` | Todo, transcripts incluidos. | `/publico` (arma el respaldo descargable) y `/copiloto` (lista lo guardado para borrarlo): una máquina cada uno |

El pitch **en curso** (`activeSession`) viaja completo siempre: es uno solo y es
el texto que se está leyendo en pantalla.

Dos campos que se parecen y no son lo mismo: `durable` dice si hay una base
configurada; `leidoDeLaBase` dice si *esta* respuesta salió de ella. Cuando
Redis falla, el servidor cae al disco de la instancia y contesta con
`durable: true` y `leidoDeLaBase: false`. Sólo con `leidoDeLaBase` en `true` un
cliente puede leer la ausencia de una ficha como "la borraron" — que es lo que
hace `/publico` para soltar del historial local lo que se borró desde el
copiloto.

### El ciclo de una sesión

`POST /api/fichas` con `action: "start"` **reinicia** la sesión de ese equipo.
El copiloto lo manda al tocar "Iniciar evaluación", y es lo que permite volver
a arrancar un equipo —tras un ensayo, un pitch cortado o una ficha que salió
mal— sin que el texto nuevo quede pegado abajo del viejo.

Los POST sin `action` (los chunks de audio y el sync de cada 12s) suman texto
pero **no reabren** un pitch ya cerrado: un chunk que llega tarde, después del
"Finalizar", antes lo sacaba de las fichas cerradas y lo dejaba colgado como
"presentando ahora" para siempre.

**"Finalizar" son dos operaciones, no una.** El pitch se cierra al instante
(`action: "finish"`, ~150 ms) y la ficha se escribe después en segundo plano;
cuando el modelo termina, entra por `action: "ficha"`. Antes era todo una sola
espera y los tres botones quedaban deshabilitados mientras el modelo escribía:
el operador no podía ni preparar el equipo siguiente ni volver a grabar.

Por eso `action: "ficha"` existe y es distinto de un POST común. Cuando la
ficha llega, **el equipo siguiente ya puede estar presentando**, y un POST
común haría dos cosas fatales ahí: cerrar automáticamente al que está en el
escenario y declarar activo al que ya terminó. Esta acción sólo escribe la
ficha; no toca quién está presentando.

#### Ninguna ficha depende del navegador ni de que alguien se acuerde

La generación corre en el navegador del operador, sí, pero lo que la alimenta
—transcript, medición, lecturas— ya está en la base **desde antes** de que el
modelo empiece a escribir. Con eso, cualquier ficha que falte se rehace.

Antes había un solo intento en toda la vida del sistema: el de tocar
"Finalizar". Si fallaba, el pitch quedaba cerrado y sin evaluación para
siempre. Ahora hay tres redes, de más automática a más manual:

| | Qué hace | Tope |
|---|---|---|
| **Reintentos** | Ante 429, 5xx o error de red, reintenta con espera creciente (4s, 8s). No reintenta lo que no cambia por esperar: transcript corto, key inválida. | 3 por intento |
| **Barrido automático** | Cada vez que el copiloto vuelve al paso 1 —o sea, después de **cada** pitch, y también al abrir la página— busca sesiones cerradas sin ficha y las manda a generar, de a una. | 2 por equipo y por pestaña |
| **Botón "Generar ficha"** | En la lista de guardadas, junto a cada sesión sin ficha. La fila dice por qué falló. | sin tope |

Los tres escenarios están cubiertos por `infalible.js` y `recuperar.js`: Gemini
caído que después vuelve, la pestaña cerrada a mitad de la generación, y una
falla permanente que **no** puede convertirse en un bucle que queme cuota.

Borrar sigue siendo sólo desde `/copiloto`: el `DELETE` está detrás de la
contraseña del operador y no hay UI de borrado en ninguna otra pantalla.

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
