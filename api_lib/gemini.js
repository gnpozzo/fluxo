// In-memory cache for discovered models across warm serverless invocations
let cachedModels = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora de caché

// Modelos de respaldo en caso de fallo de red en /models
export const DEFAULT_FLASH_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.0-flash'
];

/**
 * Extrae la versión numérica de un modelo (ej. "gemini-3.6-flash" -> 3.6)
 */
export function parseModelVersion(modelName) {
  if (!modelName) return 0;
  const match = modelName.match(/gemini-(\d+(?:\.\d+)?)-flash/i);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Consulta dinámicamente la API de Google Gemini para obtener todos los modelos Flash
 * soportados por la API Key, ordenándolos descendentemente por versión.
 * De esta forma, la app siempre utiliza automáticamente la versión más reciente sin
 * requerir cambios manuales de código cuando Google actualice sus modelos.
 */
export async function getDynamicGeminiFlashModels(key) {
  const now = Date.now();
  if (cachedModels && cachedModels.length > 0 && now < cacheExpiry) {
    return cachedModels;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5s timeout

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const flashModels = (data.models || [])
        .filter(m => {
          const name = (m.name || '').replace('models/', '').toLowerCase();
          const supportsGenerate = (m.supportedGenerationMethods || []).includes('generateContent');
          return supportsGenerate &&
                 name.includes('flash') &&
                 !name.includes('tts') &&
                 !name.includes('audio') &&
                 !name.includes('imagen') &&
                 !name.includes('embedding') &&
                 !name.includes('bison') &&
                 !name.includes('realtime');
        })
        .map(m => m.name.replace('models/', ''));

      // Ordenar descendentemente por versión (ej. 4.0 > 3.8 > 3.6 ...)
      flashModels.sort((a, b) => {
        const vA = parseModelVersion(a);
        const vB = parseModelVersion(b);
        if (vA !== vB) return vB - vA;
        return a.localeCompare(b);
      });

      if (flashModels.length > 0) {
        cachedModels = flashModels;
        cacheExpiry = now + CACHE_TTL_MS;
        console.log('[Gemini Discovery] Modelos Flash activos descubiertos dinámicamente:', flashModels);
        return flashModels;
      }
    } else {
      console.warn('[Gemini Discovery] /models respondió HTTP', res.status);
    }
  } catch (err) {
    console.warn('[Gemini Discovery] Error al consultar /models:', err.message);
  }

  return cachedModels || DEFAULT_FLASH_MODELS;
}

/**
 * Ejecuta la llamada a Gemini utilizando automáticamente el modelo Flash más reciente
 * disponible de forma dinámica, con reintentos y fallback seguro.
 */
export async function callGemini(key, userModelOverride, systemInstruction, history, responseMimeType = null, timeoutMs = 9000) {
  const cleanHistory = (history || []).filter(h => h.role === 'user' || h.role === 'model');
  const payload = {
    contents: cleanHistory
  };
  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }
  if (responseMimeType) {
    payload.generationConfig = { responseMimeType };
  }

  // Descubrir modelos disponibles dinámicamente en tiempo real
  const dynamicModels = await getDynamicGeminiFlashModels(key);

  const preferredModel = process.env.GEMINI_MODEL || userModelOverride;

  const modelsToTry = [
    preferredModel,
    ...dynamicModels,
    ...DEFAULT_FLASH_MODELS
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError = null;
  let isOverloadError = false;

  for (const model of modelsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const result = await response.json();
        let text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          text = text.trim();
          if (text.startsWith('```json')) {
            text = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
          } else if (text.startsWith('```')) {
            text = text.replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
          }
          return text;
        }
      } else {
        const errTxt = await response.text();
        lastError = `${response.status} - ${errTxt}`;
        if (response.status === 503 || errTxt.includes('high demand') || errTxt.includes('UNAVAILABLE')) {
          isOverloadError = true;
        }
        console.warn(`[Gemini] Modelo ${model} falló (HTTP ${response.status}): ${errTxt}`);
      }
    } catch (e) {
      lastError = e.message;
      console.warn(`[Gemini] Modelo ${model} excepción/timeout: ${lastError}`);
    }
  }

  if (isOverloadError) {
    throw new Error('El servicio de IA (Google Gemini) se encuentra temporalmente con alta demanda en Google. Por favor, vuelve a intentar en unos instantes.');
  }

  throw new Error(`Gemini API error: ${lastError || 'Ningún modelo disponible respondió a tiempo'}`);
}
