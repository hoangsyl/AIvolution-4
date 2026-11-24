/**
 * AIvolution Team - High Concurrency, Auto-Verify & Explore Hub Client
 * Bản quyền thuộc về AIvolution Team
 */

const HISTORY_KEY = "aivolution_scan_history_v1";
const TOTAL_SCANS_KEY = "aivolution_total_scans_v1";
const THEME_KEY = "aivolution_theme_v1";
const MAX_HISTORY = 10000;
const FRIENDLY_ERROR_MSG =
  "Opps! Mình không thể nhận diện được, có lẽ do bạn chụp không rõ hoặc mờ hoặc tối quá, bạn hãy giữ nguyên và để rõ giúp mình nhé.";

// Views & Elements
const views = {
  home: document.getElementById("viewHome"),
  weather: document.getElementById("viewWeather"),
  chat: document.getElementById("viewChat"),
  history: document.getElementById("viewHistory"),
  scanner: document.getElementById("viewScanner"),
  detail: document.getElementById("viewDetail")
};

const bottomNav = document.getElementById("bottomNav");
let video = document.getElementById("camera");
const canvas = document.getElementById("canvas");
const fileInput = document.getElementById("fileInput");
const statusPill = document.getElementById("statusPill");
const cameraErrorBanner = document.getElementById("cameraErrorBanner");
const gpsDot = document.getElementById("gpsDot");
const gpsText = document.getElementById("gpsText");
const historyBadge = document.getElementById("historyBadge");
const confirmDialog = document.getElementById("confirmDialog");
const btnToggleTheme = document.getElementById("btnToggleTheme");
const iconMoon = document.getElementById("iconMoon");
const iconSun = document.getElementById("iconSun");
const themeColorMeta = document.getElementById("themeColorMeta");

// State
let activeView = "home";
let previousView = "home";
let scanMode = "auto";
let facingMode = "environment";
let currentStream = null;
let cameraSessionId = 0;
let currentCoords = { lat: null, lng: null };
let currentSpeechText = "";
let isSpeaking = false;
let speechSessionId = 0;
let syncNavGlassFn = null;
let isScanning = false;
let isChatSending = false;
let lastScanData = null;

// Web Audio API + Fallback Audio + Bộ đệm giọng Hoài My
let audioCtx = null;
let activeSource = null;
let activeHtmlAudio = null;
let activeAudioUrl = null;
let audioNeedsReset = false;
const ttsBufferCache = new Map();

let chatHistory = [
  {
    role: "assistant",
    content:
      "Chào bạn! Mình là trợ lý AIvolution. Bạn cần hỏi đường, quán ngon Đà Nẵng – Hội An hay thông tin dinh dưỡng món vừa quét cứ nhắn mình nhé!"
  }
];

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetch có timeout + tự thử lại kèm độ trễ ngẫu nhiên (jitter) khi nhiều người quét cùng lúc
async function fetchApiWithRetry(payload, { timeoutMs = 20000, maxRetries = 3 } = {}) {
  let lastRes = null;
  let lastData = null;
  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);

      let data = {};
      try {
        data = await res.json();
      } catch (_) {
        data = { error: FRIENDLY_ERROR_MSG, debug: `HTTP ${res.status}` };
      }

      lastRes = res;
      lastData = data;

      if ([429, 502, 503, 504].includes(res.status) && attempt < maxRetries) {
        if (typeof statusPill !== "undefined" && statusPill) {
          statusPill.textContent = "Đang có nhiều người quét, đang tự thử lại...";
        }
        const baseDelay = attempt === 0 ? 650 : attempt === 1 ? 1400 : 2400;
        const jitter = baseDelay + Math.floor(Math.random() * 1100);
        await sleep(jitter);
        continue;
      }
      return { res, data };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < maxRetries) {
        const jitter = 500 + Math.floor(Math.random() * 600);
        await sleep(jitter);
        continue;
      }
    }
  }

  if (lastRes) return { res: lastRes, data: lastData };
  throw lastErr || new Error("Kết nối máy chủ bị gián đoạn");
}

// ==========================================
// 0. CHẾ ĐỘ SÁNG / TỐI (LIGHT / DARK MODE)
// ==========================================
function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", isDark ? "#0B0B0D" : "#F3F3F5");
  }
  if (iconMoon && iconSun) {
    iconMoon.hidden = isDark;
    iconSun.hidden = !isDark;
  }
  if (btnToggleTheme) {
    btnToggleTheme.setAttribute("aria-pressed", String(isDark));
    btnToggleTheme.setAttribute(
      "aria-label",
      isDark ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"
    );
  }
  try {
    localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  } catch (_) {}
}

function initTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  applyTheme(current);
}

if (btnToggleTheme) {
  btnToggleTheme.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

// ==========================================
// 1. ĐIỀU HƯỚNG GIỮA CÁC MÀN HÌNH
// ==========================================
function navigateTo(viewName) {
  if (!views[viewName]) return;

  if (activeView === "detail" && viewName !== "detail") {
    stopSpeaking();
  }
  if (viewName !== activeView && activeView !== "detail") {
    previousView = activeView;
  }

  activeView = viewName;

  Object.entries(views).forEach(([key, el]) => {
    el.hidden = key !== viewName;
  });

  bottomNav.hidden = viewName === "scanner" || viewName === "detail";

  document.querySelectorAll(".bottom-nav .nav-btn").forEach((btn) => {
    const isMatch = btn.dataset.nav === viewName;
    btn.classList.toggle("active", isMatch);
    if (isMatch) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });

  if (viewName === "home") {
    stopCamera();
    renderHomeDashboard();
  } else if (viewName === "scanner") {
    startCamera();
    updateLastThumbPreview();
  } else if (viewName === "weather") {
    stopCamera();
    renderWeatherView();
  } else if (viewName === "chat") {
    stopCamera();
    renderChatView();
  } else if (viewName === "history") {
    stopCamera();
    renderHomeDashboard();
  }

  if (typeof syncNavGlassFn === "function" && !bottomNav.hidden) {
    requestAnimationFrame(() => syncNavGlassFn());
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const expModal = document.getElementById("exploreHubModal");
    if (expModal && !expModal.hidden) return;
    const fdModal = document.getElementById("fd-modal");
    if (fdModal && !fdModal.hidden) return;

    if (confirmDialog && confirmDialog.open) {
      confirmDialog.close();
    } else if (activeView === "detail") {
      navigateTo(previousView || "home");
    } else if (activeView === "scanner") {
      navigateTo("home");
    }
  }
});

