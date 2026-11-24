/**
 * AIvolution Team - Groq Vision Primary (qwen3.8-27b) + OpenRouter Free Backup + Auto-Verify
 * Bản quyền thuộc về AIvolution Team
 */

const crypto = require("crypto");

// ==========================================
// 1. CẤU HÌNH HỆ THỐNG (GROQ VISION CHÍNH – OPENROUTER FREE DỰ PHÒNG)
// ==========================================
const CONFIG = {
  DN_HA_BOUNDS: { minLat: 15.70, maxLat: 16.20, minLng: 107.90, maxLng: 108.45 },
  // Chỉ giữ model Vision còn hoạt động trên Groq (đã bỏ Llama 4 bị 404)
  GROQ_VISION_MODELS: [
    "qwen/qwen3.8-27b"
  ],
  OPENROUTER_VISION_MODELS: [
    "google/gemma-3-27b-it:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
    "openrouter/free",
    "qwen/qwen2.5-vl-32b-instruct:free",
    "qwen/qwen2.5-vl-72b-instruct:free"
  ],
  OPENROUTER_CHAT_MODELS: [
    "openrouter/free",
    "google/gemma-4-26b-a4b-it:free",
    "nvidia/nemotron-3.5-lightning:free"
  ],
  TOTAL_SCAN_BUDGET_MS: 18500,
  GROQ_VISION_TIMEOUT_MS: 7500,
  OPENROUTER_BACKUP_TIMEOUT_MS: 6200,
  HEDGE_DELAY_MS: 2200,
  GROQ_MODELS_TIMEOUT_MS: 1200,
  SERPER_TIMEOUT_MS: 750,
  CHAT_TIMEOUT_MS: 4500,
  TTS_TIMEOUT_MS: 4000,
  MODELS_CACHE_TTL_MS: 20 * 60 * 1000,
  SCAN_CACHE_TTL_MS: 30 * 60 * 1000,
  SERPER_CACHE_TTL_MS: 60 * 60 * 1000,
  TTS_CACHE_TTL_MS: 30 * 60 * 1000,
  KEY_COOLDOWN_429_MS: 25 * 1000,
  KEY_COOLDOWN_AUTH_MS: 10 * 60 * 1000,
  MODEL_COOLDOWN_MS: 60 * 1000,
  FRIENDLY_ERROR:
    "Opps! Mình không thể nhận diện được, có lẽ do bạn chụp không rõ, bị mờ hoặc thiếu sáng. Bạn giữ chắc tay và chụp rõ hơn giúp mình nhé!"
};

const runtimeState = {
  cachedGroqModels: null,
  cachedGroqModelsAt: 0,
  badGroqVisionModels: new Set(),
  badOpenRouterModels: new Set(),
  modelCooldownUntil: new Map(),
  keyCooldownUntil: new Map(),
  rrIndex: Object.create(null),
  inFlight: new Map(),
  scanCache: new Map(),
  serperCache: new Map(),
  ttsCache: new Map()
};

// ==========================================
// 2. CACHE 3 TẦNG, SINGLE-FLIGHT & ROUND-ROBIN 30 KEYS
// ==========================================
function getCache(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    map.delete(key);
    return null;
  }
  return entry.val;
}

function setCache(map, key, val, ttlMs, maxEntries = 800) {
  if (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, { val, exp: Date.now() + ttlMs });
}

const MAX_CONCURRENT_UPSTREAM = 28;
let activeUpstreamScans = 0;
const scanWaitQueue = [];

function acquireScanSlot(maxWaitMs = 5000) {
  if (activeUpstreamScans < MAX_CONCURRENT_UPSTREAM) {
    activeUpstreamScans++;
    return Promise.resolve(() => {
      activeUpstreamScans = Math.max(0, activeUpstreamScans - 1);
      const next = scanWaitQueue.shift();
      if (next) next();
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    const grant = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeUpstreamScans++;
      resolve(() => {
        activeUpstreamScans = Math.max(0, activeUpstreamScans - 1);
        const next = scanWaitQueue.shift();
        if (next) next();
      });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const idx = scanWaitQueue.indexOf(grant);
      if (idx !== -1) scanWaitQueue.splice(idx, 1);
      // Allow proceeding instead of dropping user under spike
      activeUpstreamScans++;
      resolve(() => {
        activeUpstreamScans = Math.max(0, activeUpstreamScans - 1);
        const next = scanWaitQueue.shift();
        if (next) next();
      });
    }, maxWaitMs);
    scanWaitQueue.push(grant);
  });
}

function runSingleFlight(key, fn) {
  if (runtimeState.inFlight.has(key)) {
    return runtimeState.inFlight.get(key);
  }
  const p = Promise.resolve()
    .then(fn)
    .finally(() => runtimeState.inFlight.delete(key));
  runtimeState.inFlight.set(key, p);
  return p;
}

function hashShort(str) {
  return crypto.createHash("sha256").update(String(str || "")).digest("hex").slice(0, 24);
}

function normalizeTextForMatch(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectApiKeys(prefix) {
  const raw = [];
  if (process.env[prefix]) {
    raw.push(...String(process.env[prefix]).split(/[\s,;]+/));
  }
  for (let i = 1; i <= 30; i++) {
    const val = process.env[`${prefix}_${i}`];
    if (val) raw.push(...String(val).split(/[\s,;]+/));
  }

  const unique = [...new Set(raw.map((k) => k.trim()).filter(Boolean))];
  if (unique.length <= 1) return unique;

  const now = Date.now();
  const ready = unique.filter((k) => (runtimeState.keyCooldownUntil.get(k) || 0) <= now);
  const cooling = unique.filter((k) => (runtimeState.keyCooldownUntil.get(k) || 0) > now);

  if (ready.length > 1) {
    const idx = (runtimeState.rrIndex[prefix] || 0) % ready.length;
    runtimeState.rrIndex[prefix] = idx + 1;
    return [...ready.slice(idx), ...ready.slice(0, idx), ...cooling];
  }
  return [...ready, ...cooling];
}

function markKeyCooldown(apiKey, ms = CONFIG.KEY_COOLDOWN_429_MS) {
  runtimeState.keyCooldownUntil.set(apiKey, Date.now() + ms);
}

function fetchWithTimeout(url, options = {}, timeoutMs = 4200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(600, timeoutMs));
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}


function getActiveUpstreamScans() {
  return activeUpstreamScans;
}

module.exports = {
  CONFIG,
  runtimeState,
  getCache,
  setCache,
  acquireScanSlot,
  getActiveUpstreamScans,
  runSingleFlight,
  hashShort,
  normalizeTextForMatch,
  collectApiKeys,
  markKeyCooldown,
  fetchWithTimeout
};
