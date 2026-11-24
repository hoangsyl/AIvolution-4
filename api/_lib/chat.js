/**
 * AIvolution Backend Module: Trợ lý Chatbot (Groq Primary + OpenRouter Backup)
 */
const { CONFIG, fetchWithTimeout, markKeyCooldown } = require("./runtime");
const { querySerperCached, fetchWorkingGroqModels } = require("./vision");

// ==========================================
// 8. TRỢ LÝ AI THÔNG MINH (GROQ CHÍNH -> OPENROUTER FREE DỰ PHÒNG)
// ==========================================
async function searchWebContextForChat(userText, lastScan) {
  if (!userText) return "";
  const needSearch = /quán|ăn gì|ở đâu|giá|mấy giờ|đường|thời tiết|review|ngon|mua|địa chỉ|sự kiện|vé|trường|chỗ nào/i.test(userText);
  if (!needSearch) return "";

  let query = userText.trim();
  if (/món này|cái này|sản phẩm này|vừa quét|trường này|quán này/i.test(query) && lastScan?.ten_dia_diem) {
    query = `${lastScan.ten_dia_diem} Hội An Đà Nẵng`;
  } else if (!/đà nẵng|hội an/i.test(query)) {
    query = `${query} Hội An Đà Nẵng`;
  }

  const data = await querySerperCached(query, 3, CONFIG.SERPER_TIMEOUT_MS);
  if (!data) return "";
  const snippets = (data.organic || [])
    .map((item) => `- ${item.title}: ${item.snippet}`)
    .join("\n");
  return snippets ? `\n[Dữ liệu Google thực tế]:\n${snippets}` : "";
}

function buildSmartChatSystemPrompt({ locationContext, lastScan, webContext }) {
  const vnTime = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  const scanContext = lastScan && lastScan.ten_dia_diem
    ? `\n[Vừa quét]: ${lastScan.ten_dia_diem} (${lastScan.loai_doi_tuong || ""}) | Địa chỉ: ${lastScan.dia_chi || "Không"} | Giá/Niên đại: ${lastScan.nien_dai_hoac_gia || ""} | Calo: ${lastScan.thong_tin_san_pham?.calo_uoc_tinh || "Không áp dụng"}`
    : "";

  return `Bạn là Trợ lý thông minh AIvolution tại Hội An – Đà Nẵng.
Thời gian: ${vnTime}. Vị trí: ${locationContext || "Hội An – Đà Nẵng"}.${scanContext}${webContext}

Trả lời đúng trọng tâm, ngắn gọn 3–5 câu, không bịa thông tin. KHÔNG dùng ký tự Markdown (**, ##, *); chỉ dùng gạch đầu dòng (-) hoặc số (1., 2.).`;
}

async function handleGroqChat({ apiKeys, messages, locationContext, lastScan }) {
  const lastUserMsg = Array.isArray(messages)
    ? [...messages].reverse().find((m) => m.role === "user")?.content || ""
    : "";

  const webContext = await searchWebContextForChat(lastUserMsg, lastScan);
  const systemPrompt = buildSmartChatSystemPrompt({ locationContext, lastScan, webContext });

  const chatMessages = [
    { role: "system", content: systemPrompt },
    ...(Array.isArray(messages) ? messages.slice(-10) : [])
  ];

  for (const apiKey of apiKeys.slice(0, 6)) {
    let models;
    try {
      models = await fetchWorkingGroqModels(apiKey);
    } catch (_) {
      continue;
    }

    const sortedModels = [
      ...models.filter((m) => /llama-3\.3-70b|gpt-oss-120b|qwen3\.8|qwen-2\.5-32b/i.test(m)),
      ...models.filter((m) => /llama-3\.1|gpt-oss-20b|qwen/i.test(m))
    ];

    for (const model of [...new Set(sortedModels)].slice(0, 2)) {
      try {
        const chatPayload = {
          model,
          temperature: 0.3,
          max_completion_tokens: 650,
          messages: chatMessages
        };
        if (/qwen3/i.test(model)) {
          chatPayload.reasoning_effort = "none";
        }

        const res = await fetchWithTimeout(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(chatPayload)
          },
          CONFIG.CHAT_TIMEOUT_MS
        );
        if (res.status === 429) {
          markKeyCooldown(apiKey, CONFIG.KEY_COOLDOWN_429_MS);
          break;
        }
        if (res.status === 401 || res.status === 403) {
          markKeyCooldown(apiKey, CONFIG.KEY_COOLDOWN_AUTH_MS);
          break;
        }
        if (!res.ok) continue;
        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply) {
          return reply
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/\*\*/g, "")
            .replace(/^#+\s*/gm, "")
            .trim();
        }
      } catch (_) {}
    }
  }
  throw new Error("Groq chat unavailable");
}

async function handleOpenRouterBackupChat({ apiKeys, messages, locationContext, lastScan }) {
  const lastUserMsg = Array.isArray(messages)
    ? [...messages].reverse().find((m) => m.role === "user")?.content || ""
    : "";
  const webContext = await searchWebContextForChat(lastUserMsg, lastScan);
  const systemPrompt = buildSmartChatSystemPrompt({ locationContext, lastScan, webContext });

  const chatMessages = [
    { role: "system", content: systemPrompt },
    ...(Array.isArray(messages) ? messages.slice(-10) : [])
  ];

  for (const model of CONFIG.OPENROUTER_CHAT_MODELS) {
    for (const apiKey of apiKeys.slice(0, 6)) {
      try {
        const res = await fetchWithTimeout(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "HTTP-Referer": "https://aitl-teal.vercel.app",
              "X-Title": "AIvolution"
            },
            body: JSON.stringify({
              model,
              temperature: 0.3,
              max_tokens: 650,
              reasoning: { enabled: false },
              provider: { sort: "throughput" },
              messages: chatMessages
            })
          },
          CONFIG.CHAT_TIMEOUT_MS
        );
        if (res.status === 429) {
          markKeyCooldown(apiKey, CONFIG.KEY_COOLDOWN_429_MS);
          break;
        }
        if (!res.ok) continue;
        const data = await res.json();
        const msgObj = data.choices?.[0]?.message || {};
        const reply = String(msgObj.content || msgObj.reasoning || "").trim();
        if (reply) {
          return reply
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .replace(/\*\*/g, "")
            .replace(/^#+\s*/gm, "")
            .trim();
        }
      } catch (_) {}
    }
  }
  throw new Error("Trợ lý tạm thời bận, bạn thử gửi lại sau vài giây nhé.");
}


module.exports = {
  handleGroqChat,
  handleOpenRouterBackupChat
};
