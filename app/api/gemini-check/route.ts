import { NextResponse } from "next/server";
import { motivoGemini } from "@/lib/gemini-error";
import { candidatosGemini, modeloGemini, olvidarModelo, urlGemini, textoGemini, corteGemini } from "@/lib/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Diagnóstico de la conexión con Gemini.
 *
 * Cuando en pleno evento los seis indicadores se quedan quietos, hay que poder
 * distinguir en diez segundos entre: la key no está cargada, la key es
 * inválida, se acabó la cuota, o el modelo no existe para esa cuenta. Cada una
 * se arregla distinto y no hay tiempo para adivinar.
 *
 * Fue exactamente así que apareció el problema real: `gemini-2.5-flash` estaba
 * hardcodeado y Google contestó "no longer available to new users". Por eso
 * ahora esta ruta también devuelve qué modelos tiene habilitados la key y cuál
 * quedó elegido, que es lo único que permite decidir sin adivinar.
 *
 * Queda detrás de la contraseña del operador (el middleware protege todo
 * /api/* menos el GET de fichas). Nunca devuelve la API key: sólo si está y
 * cuánto mide, que alcanza para detectar el error más común, que es haberla
 * pegado con espacios o cortada.
 */
/**
 * Prueba de punta a punta de la ficha: `GET /api/gemini-check?ficha=1`.
 *
 * Existe por un error que se me pasó y que no tenía forma de aparecer en
 * ninguna prueba. Al separar el modelo por perfil, la ficha final pasó a un
 * modelo que RAZONA antes de contestar, y eso cambia la forma de la respuesta:
 * el razonamiento viene como una parte aparte y comparte el presupuesto de
 * tokens con el texto. El código leía sólo la primera parte y tenía el tope en
 * 2400, así que la ficha se descartaba entera. Todo el resto del sistema
 * andaba: la única forma de verlo era generar una ficha de verdad.
 *
 * Esto hace exactamente eso —una generación real, con un transcript de
 * juguete— y contesta si el texto llegó completo, en cuántas partes vino, si
 * alguna era de razonamiento y por qué cortó el modelo. Un pedido, dos
 * segundos, y no hay que ensayar un pitch entero para saber si funciona.
 */
async function probarFicha(apiKey: string) {
  const modelo = await modeloGemini(apiKey, "calidad");
  const transcript =
    "Buenas tardes. Construí un agente que concilia extractos bancarios en PDF. " +
    "Antes tardábamos 2.5 horas por día y ahora son 15 minutos. Lo dejé corriendo " +
    "mientras presentaba y ya procesó 340 movimientos con 92% de coincidencia exacta. " +
    "El costo de la API es de 9.000 pesos por mes contra los 24 millones que costaba " +
    "el proceso manual al año. Lo usamos en producción hace tres semanas.";

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(await urlGemini(apiKey, "calidad"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text:
          "Escribí una ficha de evaluación de este pitch. Respondé sólo con el texto, " +
          "con estos títulos exactos: **RESUMEN DEL PROYECTO**, **FORTALEZAS**, " +
          "**ÁREAS DE MEJORA** y **VEREDICTO**.\n\n" + transcript }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8000,
          thinkingConfig: { thinkingBudget: 1024 },
        },
      }),
    });
  } catch (e: any) {
    return { ok: false, modelo, motivo: `No se pudo contactar a Google: ${e?.message || "error de red"}` };
  }

  const ms = Date.now() - t0;
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    if (res.status === 404) olvidarModelo();
    return { ok: false, modelo, ms, status: res.status, motivo: motivoGemini(res.status, cuerpo) };
  }

  const data = await res.json();
  const partes = data?.candidates?.[0]?.content?.parts || [];
  const texto = textoGemini(data);
  const corte = corteGemini(data);
  const conVeredicto = texto.includes("**VEREDICTO**");

  return {
    ok: conVeredicto,
    modelo,
    ms,
    corte,
    partes: partes.length,
    partesDeRazonamiento: partes.filter((p: any) => p?.thought === true).length,
    largo: texto.length,
    // La comparación que importa: lo que leía el código viejo contra lo que lee
    // el nuevo. Si difieren, este es exactamente el error que rompía la ficha.
    veredictoEnLaPrimeraParte: String(partes[0]?.text || "").includes("**VEREDICTO**"),
    veredictoJuntandoPartes: conVeredicto,
    motivo: conVeredicto
      ? "La ficha se generó completa, con veredicto."
      : corte === "MAX_TOKENS"
      ? "El modelo cortó por límite de largo antes del veredicto."
      : "El modelo contestó pero sin el veredicto en el formato esperado.",
    asomo: texto.slice(0, 300),
  };
}

export async function GET(req: Request) {
  const bruta = process.env.GEMINI_API_KEY || "";
  const apiKey = bruta.trim();
  const probarLaFicha = new URL(req.url).searchParams.get("ficha") === "1";

  const base = {
    keyPresente: Boolean(apiKey),
    keyLargo: apiKey.length,
    keyConEspacios: bruta !== bruta.trim(),
    modeloForzado: (process.env.GEMINI_MODEL || "").trim() || null,
    modeloForzadoCalidad: (process.env.GEMINI_MODEL_CALIDAD || "").trim() || null,
  };

  if (!apiKey) {
    return NextResponse.json(
      { ...base, ok: false, motivo: "No hay GEMINI_API_KEY cargada en el entorno." },
      { status: 500 }
    );
  }

  // Se descarta lo cacheado: si alguien entra acá es porque algo anda mal.
  olvidarModelo();

  let disponibles: string[] = [];
  try {
    disponibles = (await candidatosGemini(apiKey)).map((c) => `${c.nombre} (${c.puntaje})`);
  } catch {
    // No es concluyente: manda la llamada real de abajo.
  }

  // Los dos perfiles: el rápido corre cada 12s en vivo, el de calidad escribe
  // la ficha final. Se prueba el rápido, que es el que sostiene el evento.
  const modelo = await modeloGemini(apiKey, "rapido");
  const modeloCalidad = await modeloGemini(apiKey, "calidad");

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Respondé sólo: ok" }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ...base, modelo, modeloCalidad, disponibles, ok: false, motivo: `No se pudo contactar a Google: ${e?.message || "error de red"}` },
      { status: 504 }
    );
  }

  const ms = Date.now() - t0;

  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    if (res.status === 404) olvidarModelo();
    return NextResponse.json(
      {
        ...base,
        modelo,
        modeloCalidad,
        disponibles,
        ok: false,
        status: res.status,
        ms,
        motivo: motivoGemini(res.status, cuerpo),
        respuestaCruda: cuerpo.slice(0, 500),
      },
      // 200 a propósito: el diagnóstico funcionó, lo que falló es Gemini.
      { status: 200 }
    );
  }

  const ficha = probarLaFicha ? await probarFicha(apiKey) : null;

  return NextResponse.json({
    ...base,
    modelo,
    modeloCalidad,
    disponibles,
    ok: ficha ? ficha.ok : true,
    status: 200,
    ms,
    ...(ficha ? { ficha } : {}),
    motivo:
      `Gemini responde bien. En vivo: ${modelo} (${ms}ms). Ficha final: ${modeloCalidad}.` +
      (ficha ? ` ${ficha.motivo}` : " Agregá ?ficha=1 para generar una ficha de prueba y verificarla."),
  });
}
