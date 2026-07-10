// ========================================
// Gemini - modelo usado pelo frontend
// ========================================

// Ponto único de troca do modelo. O Google aposenta versões sem aviso: em
// 09/07/2026 o gemini-2.5-flash devolveu 404 "no longer available" e a IA
// parou de responder. O backend (functions/index.js) tem seu próprio par
// primário/fallback — mantenha os dois em sintonia ao migrar.
export const GEMINI_MODEL = 'gemini-3.5-flash';

export const GEMINI_API_URL =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
