# Demo Day · eCommerce DAY Argentina 2026

Dashboard del jurado + copiloto de evaluación en vivo para las competiciones
del eCommerce DAY Argentina 2026 (eCommerce Institute).

## Dos competiciones, un solo deploy

| | eCommerce StartUp Competition | AI Unified Commerce | AI Agentic MVP Competition |
|---|---|---|---|
| Dashboard | `/ecommerce-startup-competition` | `/ai-unified-commerce` | `/ai-agentic-mvp-competition` |
| AI Judge | `…/ai` | `…/ai` | `…/ai` |
| Copiloto | `…/copiloto` | `…/copiloto` | `…/copiloto` |
| Indicadores | 6 | 8 | 5 |
| Planilla | la suya | la suya | la suya |

Cada una con sus propios indicadores: no hay ninguna lista fija en el código.
La Media Total cae en la columna I, K y H respectivamente, y el dashboard la
calcula a partir de cuántos indicadores tenga cada una.

Una competición **sin `sheetId`** funciona igual: el dashboard lo dice en
pantalla y muestra datos demo, y el copiloto queda sin equipos en el
desplegable. Es el estado normal entre que se da de alta y llega el Sheet.

`/` es un botón por competición. **No es la puerta del evento**: en la sala se
entra siempre por el link directo, para que nadie tenga que elegir en una
pantalla proyectada.

Corren el mismo día, una después de la otra, operadas por la misma
persona. Están aisladas igual —canal en vivo, historial y planilla propios—
porque el error caro no es la concurrencia: es la pestaña de la primera que
nadie cerró y que empieza a mostrar los subtítulos de la segunda.

## Las dos pantallas y el panel


| Ruta | Quién la usa | Qué hace |
|---|---|---|
| `/{competencia}` | Jurado y público | Radar, podio, barras y tabla de los indicadores, leídos del Google Sheet. Abajo, las fichas. |
| `/{competencia}/ai` | Pantalla de sala | Subtítulos en vivo, los indicadores moviéndose, marcas del transcript y fichas. |
| `/{competencia}/copiloto` | El operador (protegida) | Elige el equipo, graba el micrófono, transcribe con Deepgram y analiza el pitch con Gemini. |

El copiloto y la vista AI Judge se comunican por Pusher Channels, cada
competición en **su propio canal**.

## Agregar una competición

Todo lo que cambia entre competiciones vive en
[`competencias.json`](competencias.json): slug, nombre, color, planilla e
indicadores. Se agrega una entrada y no se toca nada más — de ahí salen las
rutas (`next.config.mjs`), la config del dashboard (`/api/config`), los
prompts, el radar, el parseo de la planilla y la lista de equipos.

Reglas que importan:

- **`key`** viaja en los eventos de Pusher y es la clave de `metrics`. Único
  dentro de la competición, y no se cambia una vez que el evento arrancó.
- **`short`** es lo que va en los vértices del radar. Los `label` largos se
  pisan entre sí, sobre todo con ocho indicadores.
- **`description`** se inyecta en los prompts: es lo que le dice al modelo qué
  está midiendo. Cuanto más concreta, mejor puntúa.
- El **orden** tiene que ser el mismo que el de las columnas de la planilla.

### `layoutAI`: la disposición de la vista `/ai`

Sin valor, la vista va apilada a lo largo: pitch, indicadores, preguntas,
fichas. Con `"columnas"`, el pitch queda a la izquierda y el radar con los
indicadores a la derecha, y preguntas y fichas siguen a lo ancho abajo.

La diferencia importa en una pantalla de sala: apilado hay que scrollear para
ver si los medidores se movieron, justo mientras la persona habla. En dos
columnas se ven a la vez.

Es por competición a propósito, para poder probar una variante en una sola sin
tocar las que ya están andando. Abajo de 1100px vuelve a una columna.

## Aislamiento entre competiciones

| Qué | Cómo | Qué pasaría sin esto |
|---|---|---|
| Canal de Pusher | `eday-pitch-{slug}` | La pantalla de una proyecta los subtítulos de la otra |
| Historial y `activeTeam` | clave KV `eday:sessions:{slug}` | La segunda competición le pisa las fichas a la primera |
| Planilla | `sheetId` por competición | Los dos dashboards leen el mismo jurado |
| Lista de equipos | `GET /api/equipos?competencia=slug` | El copiloto ofrece los equipos de la otra |
| Borradores del copiloto | `localStorage` con el slug adentro | Un equipo homónimo recupera el borrador de la otra |

`DELETE /api/fichas?competencia=slug&all=1` limpia **sólo** esa competición.

### El historial de antes de la separación

Todo lo grabado cuando la clave era global (`eday:sessions`) sigue ahí. La
primera competición del registro lo hereda sola: si su clave está vacía,
`loadSessions` lee la vieja y la copia a la nueva, una sola vez. La vieja **no
se borra** — es el respaldo de un historial que no se puede volver a grabar.

Las competiciones que se agreguen después nunca miran esa clave. Si lo
hicieran, abrirían el día con las fichas de la StartUp Competition.

La contraseña es **una sola** para las dos: las opera la misma persona. Si
alguna vez las operan personas distintas, pasa a ser una por competición leída
del registro.

## Los indicadores

Los define cada competición en `competencias.json`: seis en la StartUp
Competition, ocho en AI Unified Commerce. No hay ninguna lista fija en el
código — ni en `public/index.html`, que los pide a `/api/config`.

El jurado puntúa de **1 a 5** en el Sheet. El análisis en vivo de la IA usa
**0 a 100** (50 = neutro) porque es un medidor que se mueve durante el pitch.

## Fuente de datos del jurado

**Una planilla por competición**, declarada en `competencias.json` (`sheetId` y
`sheetName`), leída como CSV vía `gviz/tq`. Las dos tienen la misma forma y
sólo cambia el ancho:

```
A: Equipo N°  |  B: Nombre  |  C…: un indicador por columna  |  última: Media Total
```

Con 6 indicadores la Media Total cae en la columna I; con 8, en la K. El
dashboard **calcula** ese layout a partir de la cantidad de indicadores, así
que una competición con nueve criterios ya funciona sin tocar código.

El Sheet tiene que estar compartido como "cualquiera con el enlace puede ver".

### Poné el `gid`, no confíes en el nombre de la hoja

`sheetGid` es el número que aparece en la URL de la pestaña (`#gid=…`). Si está,
se usa ese y se ignora el nombre.

Importa más de lo que parece: cuando el nombre de hoja no resuelve —la pestaña
se llama `Analisis` y se pide `Análisis`, por ejemplo— Google **no da error**.
Devuelve la primera hoja del libro, que en estas planillas es la de respuestas
del formulario. El dashboard mostraba ahí a los jurados como si fueran los
equipos que presentan, con sus puntajes y todo.

Como red de seguridad, ahora se verifica que la columna B del encabezado diga
`Nombre` antes de aceptar una hoja. Si no, se descarta y se avisa en pantalla
con el motivo real, en vez de un "error de conexión" que manda a revisar el
lugar equivocado.

**La columna B es también la lista de equipos del copiloto.** Estaba escrita a
mano en el código, y el día que el jurado corrigió un nombre en la planilla el
desplegable siguió mostrando el viejo. Eso no es cosmético: el dashboard cruza
las fichas con los puntajes del jurado **por nombre**, así que dos nombres
distintos para la misma persona son una ficha que nunca encuentra su fila.

Ahora `GET /api/equipos?competencia=slug` lee esa columna con el mismo `gviz/tq` que el
dashboard ([`lib/sheet.ts`](lib/sheet.ts)) y el copiloto la relee entre pitch y
pitch. Si la hoja no responde, el desplegable queda vacío y lo dice: no hay
lista de reemplazo escrita a mano, porque eso es justamente lo que se vino a
sacar. El operador escribe el nombre en el campo de al lado.

El campo **Proyecto / Solución** se escribe a mano en cada pitch. Tenerlo
precargado significaba mantener una segunda lista que también se iba a
desactualizar, y sin ninguna planilla contra la cual corregirse.

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
| `GET /api/fichas?full=1` | Todo, transcripts incluidos. | La vista AI Judge (arma el respaldo descargable) y el copiloto (lista lo guardado para borrarlo): una máquina cada uno |

El pitch **en curso** (`activeSession`) viaja completo siempre: es uno solo y es
el texto que se está leyendo en pantalla.

Dos campos que se parecen y no son lo mismo: `durable` dice si hay una base
configurada; `leidoDeLaBase` dice si *esta* respuesta salió de ella. Cuando
Redis falla, el servidor cae al disco de la instancia y contesta con
`durable: true` y `leidoDeLaBase: false`. Sólo con `leidoDeLaBase` en `true` un
cliente puede leer la ausencia de una ficha como "la borraron" — que es lo que
hace la vista AI Judge para soltar del historial local lo que se borró desde el
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

Borrar sigue siendo sólo desde el copiloto: el `DELETE` está detrás de la
contraseña del operador y no hay UI de borrado en ninguna otra pantalla.

### Persistencia

En Vercel el filesystem es de solo lectura fuera de `/tmp` y cada request puede
caer en otra instancia. Sin las variables de KV las fichas se transmiten por
Pusher pero **no quedan guardadas de forma durable**: quien abra la vista AI Judge
después de un pitch puede no ver el historial. Con Vercel KV o Upstash Redis
configurado, sí.

Sirven los dos pares indistintamente — `KV_REST_API_URL` + `KV_REST_API_TOKEN`
(Vercel KV) o `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (Upstash
directo). Lo que no sirve es cargar el token sin la URL: `isDurable()` pide las
dos y con una sola sigue en modo no durable, en silencio.

Para verificarlo, `GET /api/fichas?competencia=slug` devuelve `durable: true|false`. Ojo que
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
