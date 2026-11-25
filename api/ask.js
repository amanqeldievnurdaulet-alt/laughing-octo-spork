// AI Safety — Gemini API-ге сұрау жіберетін сервер функциясы (Vercel Serverless Function).
// API кілті тек серверде сақталады (GEMINI_API_KEY), браузерге ешқашан жіберілмейді.

const MODELS = (process.env.GEMINI_MODEL || 'gemini-3.6-flash,gemini-3.5-flash-lite')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_TEXT = 120_000;          // бір сұраудағы мәтіннің ең көп ұзындығы (таңба)
const MAX_IMAGE_B64 = 4_000_000;   // фото (base64) ~3 МБ-қа дейін (Vercel шегі 4.5 МБ)
const PER_MIN = Number(process.env.RATE_PER_MIN || 12); // бір IP-ден минутына сұрау саны

const hits = new Map(); // қарапайым жады ішіндегі шектеу (бір сервер данасы үшін)
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > PER_MIN;
}

const SAFETY = 'Сен — «AI Safety» прототипінің ЖИ бөлігісің. Тек құрылыстағы еңбек қауіпсіздігі, еңбекті қорғау және ҚР еңбек заңнамасы тақырыбында жауап бер.';

async function callGemini(model, body, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ code: 'config', error: 'GEMINI_API_KEY is not set' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) return res.status(429).json({ code: 429, error: 'Too many requests' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || !messages.length) return res.status(400).json({ error: 'messages required' });

  const total = messages.reduce((n, m) => n + String(m?.content || '').length, 0);
  if (total > MAX_TEXT) return res.status(413).json({ code: 413, error: 'Text too long' });

  const contents = messages.slice(-24).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '').slice(0, 60_000) }],
  }));
  if (contents[contents.length - 1].role !== 'user') return res.status(400).json({ error: 'last message must be user' });

  const img = body.image;
  if (img?.data) {
    if (String(img.data).length > MAX_IMAGE_B64) return res.status(413).json({ code: 413, error: 'Image too large' });
    if (!/^image\/(jpeg|png|webp)$/.test(img.mime)) return res.status(400).json({ error: 'Unsupported image type' });
    contents[contents.length - 1].parts.unshift({ inline_data: { mime_type: img.mime, data: img.data } });
  }

  const request = {
    system_instruction: { parts: [{ text: SAFETY }] },
    contents,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      ...(body.json ? { responseMimeType: 'application/json' } : {}),
    },
  };

  let last = { status: 500, data: {} };
  for (const model of MODELS) {
    try {
      last = await callGemini(model, request, key);
    } catch (e) {
      last = { status: 503, data: { error: { message: String(e) } } };
    }
    if (last.status === 200) {
      const cand = last.data?.candidates?.[0];
      const text = (cand?.content?.parts || []).map(p => p.text || '').join('').trim();
      if (!text) return res.status(422).json({ code: 'refused', error: cand?.finishReason || 'empty' });
      return res.status(200).json({ text, model });
    }
    // 404 (модель жоқ), 429 (лимит) немесе 5xx болса — келесі модельді көреміз
    if (![404, 429, 500, 503].includes(last.status)) break;
  }
  const status = last.status === 429 ? 429 : last.status >= 500 ? 503 : 502;
  return res.status(status).json({ code: status, error: last.data?.error?.message || 'Gemini error' });
}

