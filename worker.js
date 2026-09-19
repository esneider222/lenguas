/**
 * WORKER "TUTOR IA — Lengua & Letras" (CONECTADO A GOOGLE GEMINI)
 * VERSIÓN FINAL BLINDADA - USO LIBRE PARA APK MÓVIL
 */

const GEMINI_MODEL = "gemini-1.5-flash"; 

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default {
  async fetch(request, env) {
    // 1) Control de seguridad de peticiones CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Método no permitido" }, 405);
    }

    // 2) Validar el cuerpo del mensaje recibido
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: "JSON inválido" }, 400);
    }

    const messages = body.messages;
    if (!messages || !messages.length) {
      return jsonResponse({ error: "Falta el historial de mensajes" }, 400);
    }

    // 3) Verificar la existencia de la API Key de Gemini en Cloudflare
    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: "Servidor no configurado. Falta GEMINI_API_KEY en Cloudflare." }, 500);
    }

    // 4) Adaptar formato al estándar exigido por Google Gemini
    const contents = messages.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content || "" }]
    }));

    const systemInstruction = {
      parts: [{ text: "Eres el tutor de IA de la plataforma Lengua & Letras. Ayuda al estudiante con sus dudas sobre lingüística, literatura castellana, pedagogía e inglés académico. Responde de forma clara, amable y pedagógica." }]
    };

    // 5) Petición uniendo la URL oficial de forma limpia con tu clave de entorno
    try {
      const baseUrl = "https://googleapis.com" + GEMINI_MODEL + ":generateContent";
      const geminiUrl = baseUrl + "?key=" + env.GEMINI_API_KEY;

      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: contents,
          systemInstruction: systemInstruction
        })
      });

      const data = await response.json();

      // 6) Extracción ultra-segura del texto devuelto por Google Gemini
      if (response.ok && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
        const textReply = data.candidates.content.parts.text;
        return jsonResponse({ reply: textReply });
      } else {
        const errMsg = data.error?.message || "Estructura de respuesta inesperada en el motor de Gemini";
        return jsonResponse({ error: errMsg }, response.status || 400);
      }

    } catch (e) {
      return jsonResponse({ error: "Error de red con el servidor de Google: " + e.message }, 502);
    }
  },
};
