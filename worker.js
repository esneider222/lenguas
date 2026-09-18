/**
 * WORKER "TUTOR IA — Lengua & Letras"
 * ------------------------------------------------------------
 * Qué hace:
 * 1. Recibe la pregunta del estudiante + el token de Google que generó al iniciar sesión.
 * 2. Verifica ese token directamente con Google (así confirma que es un login real).
 * 3. (Opcional) revisa una lista blanca de correos permitidos.
 * 4. (Opcional) aplica un límite diario de preguntas por persona, usando Cloudflare KV.
 * 5. Llama a la API de Anthropic con TU clave secreta (nunca viaja al celular del estudiante).
 * 6. Devuelve la respuesta al navegador.
 *
 * CONFIGURACIÓN NECESARIA (Cloudflare Dashboard → tu Worker → Settings → Variables):
 *   ANTHROPIC_API_KEY   (secreto)  → tu clave de https://console.anthropic.com
 *   GOOGLE_CLIENT_ID    (texto)    → el Client ID que generaste en Google Cloud Console
 *   ALLOWED_EMAILS      (texto, opcional) → "correo1@gmail.com,correo2@gmail.com" — si lo dejas vacío, cualquier cuenta de Google puede usarlo
 *   DAILY_LIMIT         (texto, opcional) → ej. "30" (preguntas por persona por día). Si lo dejas vacío, no hay límite.
 *
 * Si usas el límite diario, además debes crear un "KV Namespace" en Cloudflare
 * (Workers & Pages → KV → Create) y enlazarlo a este Worker con el nombre RATE_LIMIT_KV
 * (Settings → Variables → KV Namespace Bindings).
 */

const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;

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
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Método no permitido" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: "JSON inválido" }, 400);
    }

    const { idToken, messages } = body;
    if (!idToken || !messages) {
      return jsonResponse({ error: "Falta idToken o messages" }, 400);
    }

    // 1) Verificar el token de Google
    let tokenInfo;
    try {
      const tiResp = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      );
      if (!tiResp.ok) return jsonResponse({ error: "Token de Google inválido o expirado" }, 401);
      tokenInfo = await tiResp.json();
    } catch (e) {
      return jsonResponse({ error: "No se pudo verificar el token de Google" }, 502);
    }

    if (!env.GOOGLE_CLIENT_ID || tokenInfo.aud !== env.GOOGLE_CLIENT_ID) {
      return jsonResponse({ error: "El token no corresponde a esta aplicación" }, 401);
    }

    const email = tokenInfo.email || "desconocido";

    // 2) Lista blanca opcional
    const allowList = (env.ALLOWED_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (allowList.length > 0 && !allowList.includes(email.toLowerCase())) {
      return jsonResponse({ error: `El correo ${email} no está autorizado para usar este tutor.` }, 403);
    }

    // 3) Límite diario opcional (requiere KV Namespace enlazado como RATE_LIMIT_KV)
    const dailyLimit = parseInt(env.DAILY_LIMIT || "0", 10);
    if (dailyLimit > 0 && env.RATE_LIMIT_KV) {
      const today = new Date().toISOString().slice(0, 10);
      const key = `usage:${email}:${today}`;
      const currentRaw = await env.RATE_LIMIT_KV.get(key);
      const current = parseInt(currentRaw || "0", 10);
      if (current >= dailyLimit) {
        return jsonResponse(
          { error: `Alcanzaste el límite de ${dailyLimit} preguntas por hoy. Vuelve mañana.` },
          429
        );
      }
      await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 60 * 60 * 24 });
    }

    // 4) Llamar a Anthropic con la clave secreta del servidor
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "El servidor no tiene configurada ANTHROPIC_API_KEY" }, 500);
    }
    try {
      const anthResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: MAX_TOKENS,
          messages,
        }),
      });
      const data = await anthResp.json();
      return jsonResponse(data, anthResp.status);
    } catch (e) {
      return jsonResponse({ error: "Error llamando a la API de Anthropic: " + e.message }, 502);
    }
  },
};
