/**
 * AIvolution Team - Entry Point /api/scan (Modular & 100+ Concurrent Users Ready)
 * Phân tách rõ: api/_lib/runtime.js | vision.js | chat.js | tts.js
 */
const {
  CONFIG,
  runtimeState,
  getCache,
  setCache,
  acquireScanSlot,
  getActiveUpstreamScans,
  runSingleFlight,
  hashShort,
  collectApiKeys
} = require("./_lib/runtime");
const {
  clampToDaNangHoiAn,
  buildVisionPrompt,
  runGroqPrimaryVision,
  runOpenRouterBackupVision,
  normalizeScanResult,
  autoVerifyWithGoogle
} = require("./_lib/vision");
const { handleGroqChat, handleOpenRouterBackupChat } = require("./_lib/chat");
const { generateVoiceBase64 } = require("./_lib/tts");

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: CONFIG.FRIENDLY_ERROR });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    // 1. ĐỌC THUYẾT MINH (HOÀI MY NEURAL)
    if (body.mode === "tts") {
      try {
        const audioBase64 = await generateVoiceBase64(body.text);
        if (audioBase64) return res.status(200).json({ audioBase64 });
        return res.status(502).json({ ttsError: "Không có dữ liệu âm thanh" });
      } catch (err) {
        return res.status(502).json({ ttsError: err.message || "Lỗi tạo giọng đọc" });
      }
    }

    const groqKeys = collectApiKeys("GROQ_API_KEY");
    const openRouterKeys = collectApiKeys("OPENROUTER_API_KEY");

    if (!groqKeys.length && !openRouterKeys.length) {
      return res.status(500).json({
        error: CONFIG.FRIENDLY_ERROR,
        debug: "Thiếu biến môi trường GROQ_API_KEY và OPENROUTER_API_KEY trên Vercel"
      });
    }

    // 2. CHATBOT THÔNG MINH
    if (body.mode === "chat") {
      if (groqKeys.length) {
        try {
          const reply = await handleGroqChat({
            apiKeys: groqKeys,
            messages: body.messages,
            locationContext: body.locationContext,
            lastScan: body.lastScan
          });
          return res.status(200).json({ reply, provider: "groq" });
        } catch (err) {
          console.error("[Groq Chat Fallback Reason]:", err.message);
        }
      }
      if (openRouterKeys.length) {
        const reply = await handleOpenRouterBackupChat({
          apiKeys: openRouterKeys,
          messages: body.messages,
          locationContext: body.locationContext,
          lastScan: body.lastScan
        });
        return res.status(200).json({ reply, provider: "openrouter" });
      }
      throw new Error("Không có API Key hoạt động cho Chatbot");
    }

    // 3. QUÉT ẢNH AI CHỊU TẢI >100 NGƯỜI ĐỒNG THỜI
    const { imageBase64, locationContext, lat, lng } = body;
    if (!imageBase64) {
      return res.status(400).json({ error: CONFIG.FRIENDLY_ERROR, debug: "Thiếu dữ liệu ảnh" });
    }

    const imgKey = `scan:${hashShort(imageBase64)}`;
    const cachedScan = getCache(runtimeState.scanCache, imgKey);
    if (cachedScan) {
      return res.status(200).json({ ...cachedScan, _cached: true });
    }

    const finalPayload = await runSingleFlight(imgKey, async () => {
      const releaseSlot = await acquireScanSlot(5500);
      try {
        const deadline = Date.now() + CONFIG.TOTAL_SCAN_BUDGET_MS;
        const areaPoint = clampToDaNangHoiAn(lat, lng, locationContext);
        const prompt = buildVisionPrompt(locationContext);

        let visionOutput = null;
        let groqError = null;

        if (groqKeys.length) {
          const groqBudgetMs = openRouterKeys.length ? 7500 : 12000;
          try {
            visionOutput = await runGroqPrimaryVision({
              apiKeys: groqKeys,
              prompt,
              imageBase64,
              deadline: Math.min(deadline, Date.now() + groqBudgetMs)
            });
          } catch (err) {
            groqError = err;
            console.error("[Groq Vision Fallback Reason]:", err.message);
          }
        }

        if (!visionOutput) {
          if (openRouterKeys.length && deadline - Date.now() >= 1500) {
            try {
              visionOutput = await runOpenRouterBackupVision({
                apiKeys: openRouterKeys,
                prompt,
                imageBase64,
                deadline
              });
            } catch (orErr) {
              const combinedErr = new Error(
                `Groq: ${groqError?.message || "N/A"} || OpenRouter: ${orErr.message}`
              );
              combinedErr.isRateLimit = Boolean(groqError?.isRateLimit || orErr?.isRateLimit);
              combinedErr.isOverloaded = Boolean(groqError?.isOverloaded || orErr?.isOverloaded);
              throw combinedErr;
            }
          } else if (groqError) {
            throw groqError;
          } else {
            throw new Error("Thiếu biến môi trường GROQ_API_KEY trên Vercel");
          }
        }

        let payload = normalizeScanResult(visionOutput.result, {
          areaPoint,
          locationContext,
          provider: visionOutput.provider
        });

        if (payload.error) return payload;

        // Bỏ qua bước Serper phụ khi có >= 10 yêu cầu đang chạy song song để giữ tốc độ siêu mượt
        const timeLeftForSerper = deadline - Date.now();
        if (timeLeftForSerper >= 1000 && getActiveUpstreamScans() < 10) {
          payload = await autoVerifyWithGoogle(payload, {
            areaPoint,
            locationContext,
            timeoutMs: Math.min(CONFIG.SERPER_TIMEOUT_MS, timeLeftForSerper - 100)
          });
        }

        setCache(runtimeState.scanCache, imgKey, payload, CONFIG.SCAN_CACHE_TTL_MS, 800);
        return payload;
      } finally {
        releaseSlot();
      }
    });

    if (finalPayload.error) {
      return res.status(422).json(finalPayload);
    }
    return res.status(200).json(finalPayload);
  } catch (err) {
    const status = err?.isRateLimit ? 429 : err?.isOverloaded ? 503 : 502;
    const message = err?.isRateLimit
      ? "Hệ thống đang có rất nhiều người quét cùng lúc (HTTP 429). Bạn đợi 3–5 giây rồi bấm Quét lại nhé!"
      : err?.isOverloaded
      ? "Máy chủ AI đang quá tải tạm thời (503). Ảnh của bạn vẫn rõ, bạn bấm Quét lại sau 3–5 giây nhé!"
      : CONFIG.FRIENDLY_ERROR;

    return res.status(status).json({
      error: message,
      debug: err?.message || "Lỗi xử lý máy chủ"
    });
  }
};
