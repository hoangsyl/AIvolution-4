// AIvolution Module: Trợ lý Chatbot & Giọng đọc Hoài My Neural TTS

function renderChatView() {
  const box = document.getElementById("chatBox");
  box.innerHTML = chatHistory
    .map(
      (m) =>
        `<div class="chat-msg ${m.role === "user" ? "user" : "bot"}">${escapeHtml(m.content).replace(/\n/g, "<br>")}</div>`
    )
    .join("");
  box.scrollTop = box.scrollHeight;
}

document.getElementById("chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (isChatSending) return;

  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  isChatSending = true;
  chatHistory.push({ role: "user", content: text });
  input.value = "";
  renderChatView();

  const box = document.getElementById("chatBox");
  const typing = document.createElement("div");
  typing.className = "chat-msg bot";
  typing.textContent = "Đang trả lời...";
  box.appendChild(typing);
  box.scrollTop = box.scrollHeight;

  try {
    const locationContext = currentCoords.lat
      ? `GPS(${currentCoords.lat.toFixed(4)}, ${currentCoords.lng.toFixed(4)}) - Hội An & Đà Nẵng`
      : "Hội An – Đà Nẵng";

    const latestScan = lastScanData || loadHistory()[0]?.data || null;

    const { data } = await fetchApiWithRetry(
      {
        mode: "chat",
        messages: chatHistory.slice(-10),
        locationContext,
        lastScan: latestScan
      },
      { timeoutMs: 11000, maxRetries: 1 }
    );

    chatHistory.push({
      role: "assistant",
      content: data.reply || data.error || "Mình chưa nhận được phản hồi, bạn thử lại nhé."
    });
  } catch (err) {
    chatHistory.push({
      role: "assistant",
      content: "Lỗi kết nối: " + (err?.message || "Mạng không ổn định")
    });
  } finally {
    isChatSending = false;
    renderChatView();
  }
});

// ==========================================
// 5. GIỌNG ĐỌC HOÀI MY NEURAL (CHỈ TẢI KHI BẤM – GIẢM 50% TẢI SERVER)
// ==========================================
function normalizeTtsText(text) {
  return String(text || "").replace(/[*#_•]/g, " ").replace(/\s+/g, " ").trim();
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function getOrFetchTtsBuffer(cleanText) {
  if (ttsBufferCache.has(cleanText)) return ttsBufferCache.get(cleanText);

  const promise = fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "tts", text: cleanText })
  })
    .then(async (res) => {
      const data = await res.json();
      if (res.ok && data.audioBase64) return base64ToArrayBuffer(data.audioBase64);
      throw new Error(data.ttsError || "Không tải được âm thanh");
    })
    .catch((err) => {
      ttsBufferCache.delete(cleanText);
      throw err;
    });

  if (ttsBufferCache.size >= 10) {
    const firstKey = ttsBufferCache.keys().next().value;
    ttsBufferCache.delete(firstKey);
  }
  ttsBufferCache.set(cleanText, promise);
  return promise;
}

function resetAudioContext() {
  audioNeedsReset = true;
  if (audioCtx) {
    const oldCtx = audioCtx;
    audioCtx = null;
    try {
      if (oldCtx.state !== "closed") oldCtx.close().catch(() => {});
    } catch (_) {}
  }
}

function unlockAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  if (
    !audioCtx ||
    audioNeedsReset ||
    audioCtx.state === "closed" ||
    audioCtx.state === "interrupted"
  ) {
    if (audioCtx && audioCtx.state !== "closed") {
      try { audioCtx.close().catch(() => {}); } catch (_) {}
    }
    audioCtx = new AudioCtx();
    audioNeedsReset = false;
  }

  if (audioCtx.state !== "running") {
    audioCtx.resume().catch(() => {});
  }

  try {
    const silent = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = silent;
    src.connect(audioCtx.destination);
    src.start(0);
  } catch (_) {}

  return audioCtx;
}

function decodeAudio(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
  });
}

function playViaHtmlAudio(buffer, session) {
  return new Promise((resolve, reject) => {
    try {
      const blob = new Blob([buffer], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playsInline = true;
      activeHtmlAudio = audio;
      activeAudioUrl = url;

      audio.onended = () => {
        if (session === speechSessionId) {
          stopSpeaking();
        }
      };
      audio.onerror = () => {
        if (session === speechSessionId) stopSpeaking();
        reject(new Error("Audio playback failed"));
      };

      updateSpeakButton(true);
      audio.play().then(resolve).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
}

function updateSpeakButton(playing) {
  const btn = document.getElementById("speakBtn");
  if (!btn) return;
  btn.textContent = playing ? "Dừng thuyết minh" : "Nghe thuyết minh";
}

function stopSpeaking() {
  speechSessionId++;
  isSpeaking = false;
  if (activeSource) {
    try {
      activeSource.onended = null;
      activeSource.stop();
    } catch (_) {}
    activeSource = null;
  }
  if (activeHtmlAudio) {
    try {
      activeHtmlAudio.onended = null;
      activeHtmlAudio.onerror = null;
      activeHtmlAudio.pause();
      activeHtmlAudio.src = "";
    } catch (_) {}
    activeHtmlAudio = null;
  }
  if (activeAudioUrl) {
    try { URL.revokeObjectURL(activeAudioUrl); } catch (_) {}
    activeAudioUrl = null;
  }
  updateSpeakButton(false);
}

async function speakText(text) {
  if (isSpeaking) {
    stopSpeaking();
    return;
  }
  const cleanText = normalizeTtsText(text);
  if (!cleanText) return;

  const ctx = unlockAudioContext();
  const session = ++speechSessionId;
  isSpeaking = true;
  const btn = document.getElementById("speakBtn");
  if (btn) btn.textContent = "Đang tải giọng...";

  try {
    const buffer = await getOrFetchTtsBuffer(cleanText);
    if (session !== speechSessionId) return;

    if (ctx) {
      if (ctx.state !== "running") {
        await ctx.resume().catch(() => {});
      }
      if (ctx.state === "running") {
        const decoded = await decodeAudio(ctx, buffer);
        if (session !== speechSessionId) return;

        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(ctx.destination);
        activeSource = source;

        updateSpeakButton(true);
        source.onended = () => {
          if (session === speechSessionId) {
            activeSource = null;
            isSpeaking = false;
            updateSpeakButton(false);
          }
        };
        source.start(0);
        return;
      }
    }

    await playViaHtmlAudio(buffer, session);
  } catch (_) {
    if (session === speechSessionId) {
      stopSpeaking();
      resetAudioContext();
      if (btn) {
        btn.textContent = "Thử nghe lại";
        setTimeout(() => {
          if (!isSpeaking) updateSpeakButton(false);
        }, 2200);
      }
    }
  }
}

