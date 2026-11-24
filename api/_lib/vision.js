/**
 * AIvolution Backend Module: Vision AI (Groq Primary + OpenRouter Backup) & Google Auto-Verify
 */
const {
  CONFIG,
  runtimeState,
  getCache,
  setCache,
  runSingleFlight,
  normalizeTextForMatch,
  collectApiKeys,
  markKeyCooldown,
  fetchWithTimeout
} = require("./runtime");

// ==========================================
// 3. TIỆN ÍCH ĐỊA LÝ & CHUẨN HÓA DỮ LIỆU
// ==========================================
function clampToDaNangHoiAn(lat, lng, locationContext = "") {
  const numLat = Number(lat);
  const numLng = Number(lng);
  const ctx = String(locationContext || "").toLowerCase();
  const { minLat, maxLat, minLng, maxLng } = CONFIG.DN_HA_BOUNDS;

  if (
    Number.isFinite(numLat) &&
    Number.isFinite(numLng) &&
    numLat >= minLat &&
    numLat <= maxLat &&
    numLng >= minLng &&
    numLng <= maxLng
  ) {
    return { lat: Number(numLat.toFixed(6)), lng: Number(numLng.toFixed(6)) };
  }
  if (ctx.includes("hội an") || ctx.includes("hoi an")) {
    return { lat: 15.8801, lng: 108.3380 };
  }
  return { lat: 16.0544, lng: 108.2022 };
}

function detectLocalCityName(areaPoint, locationContext = "") {
  const ctx = normalizeTextForMatch(locationContext);
  if (ctx.includes("hoi an")) return "Hội An";
  if (areaPoint && Number(areaPoint.lat) < 15.96) return "Hội An";
  return "Đà Nẵng";
}

function buildDnHaMapsUrl({ query = "", lat, lng, locationContext = "" } = {}) {
  const point = clampToDaNangHoiAn(lat, lng, locationContext);
  const cleanQuery = String(query || "").trim();
  const scopedQuery = cleanQuery
    ? (/đà nẵng|hội an|quảng nam|việt nam/i.test(cleanQuery) ? cleanQuery : `${cleanQuery}, Hội An - Đà Nẵng`)
    : "Hội An - Đà Nẵng";

  const params = new URLSearchParams({
    api: "1",
    query: scopedQuery,
    center: `${point.lat},${point.lng}`,
    zoom: "15"
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

function buildDnHaDirectionsUrl({ destName = "", lat, lng, locationContext = "" } = {}) {
  const origin = clampToDaNangHoiAn(lat, lng, locationContext);
  const cleanDest = String(destName || "").trim();
  const scopedDest = cleanDest
    ? (/đà nẵng|hội an|quảng nam|việt nam/i.test(cleanDest) ? cleanDest : `${cleanDest}, Hội An - Đà Nẵng`)
    : "Hội An, Đà Nẵng";

  const params = new URLSearchParams({
    api: "1",
    origin: `${origin.lat},${origin.lng}`,
    destination: scopedDest,
    travelmode: "driving"
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function attachMapLinks(payload, { areaPoint, locationContext }) {
  if (payload.la_dia_diem) {
    const hasExactAddr = payload.dia_chi && !/không áp dụng|chưa xác định/i.test(payload.dia_chi);
    const placeQuery = hasExactAddr ? `${payload.ten_dia_diem}, ${payload.dia_chi}` : payload.ten_dia_diem;
    payload.hien_chi_duong = true;
    payload.google_maps_url = buildDnHaMapsUrl({
      query: placeQuery,
      lat: areaPoint.lat,
      lng: areaPoint.lng,
      locationContext
    });
    payload.chi_duong_url = buildDnHaDirectionsUrl({
      destName: placeQuery,
      lat: areaPoint.lat,
      lng: areaPoint.lng,
      locationContext
    });
  } else {
    const buyQuery = payload.thong_tin_san_pham?.tu_khoa_mua_hang || `mua ${payload.ten_dia_diem}`;
    payload.hien_chi_duong = false;
    payload.google_maps_url = buildDnHaMapsUrl({
      query: buyQuery,
      lat: areaPoint.lat,
      lng: areaPoint.lng,
      locationContext
    });
    payload.chi_duong_url = "";
  }
  return payload;
}

function extractJson(rawText) {
  const cleaned = String(rawText || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json|```/gi, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Phản hồi AI không phải JSON hợp lệ");
  }

  let jsonStr = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (_) {
    jsonStr = jsonStr
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u0000-\u0019]+/g, " ");
    return JSON.parse(jsonStr);
  }
}

function isInvalidTitle(str) {
  const s = String(str || "").trim();
  if (!s || s.length < 2) return true;
  return /^(không áp dụng|chưa xác định|không xác định|chưa rõ|không rõ|không có|n\/a|none|null|vật thể|đối tượng|sản phẩm)$/i.test(s) ||
    /chưa xác định|không xác định|chưa rõ từ ảnh|không áp dụng/i.test(s);
}

function deriveCleanTitle({ sp, data, ocrText, loai }) {
  const candidates = [
    sp.chi_tiet_san_pham,
    data.cau_chuyen_lich_su,
    data.giai_thoai_dac_biet
  ];

  for (const raw of candidates) {
    const text = String(raw || "")
      .replace(/^(ảnh chụp|hình ảnh|đây là|đối tượng là|vật thể là|sản phẩm là)\s+/i, "")
      .trim();
    if (!text || isInvalidTitle(text)) continue;

    let shortName = text
      .split(/[.,;(]|\s+(?:mang ý nghĩa|thường được|được sử dụng|dùng để|treo trên|đặt trên|có thiết kế)/i)[0]
      .trim();

    if (shortName.length > 56) {
      shortName = shortName.slice(0, 56).replace(/\s+\S*$/, "").trim();
    }
    if (shortName.length >= 4) {
      return shortName.charAt(0).toUpperCase() + shortName.slice(1);
    }
  }

  if (ocrText && !/không có chữ/i.test(ocrText)) {
    return ocrText.slice(0, 56);
  }
  return loai && !isInvalidTitle(loai) ? loai : "Vật phẩm nhận diện";
}

function normalizeScanResult(raw, { areaPoint, locationContext, provider }) {
  const data = raw && typeof raw === "object" ? raw : {};

  if (data.khong_nhan_dien_duoc === true || data.error) {
    return {
      error: CONFIG.FRIENDLY_ERROR,
      debug: String(data.ly_do || data.debug || "Ảnh không đủ rõ nét")
    };
  }

  const ocrText = String(data.chu_doc_duoc_tren_anh || "").trim();
  const sp = data.thong_tin_san_pham && typeof data.thong_tin_san_pham === "object"
    ? data.thong_tin_san_pham
    : {};
  const hv = data.han_viet && typeof data.han_viet === "object"
    ? data.han_viet
    : {};
  const dg = data.danh_gia_ban_dia && typeof data.danh_gia_ban_dia === "object"
    ? data.danh_gia_ban_dia
    : {};

  const loai = String(data.loai_doi_tuong || "Vật thể").trim();
  let ten = String(data.ten_dia_diem || "").trim();
  if (isInvalidTitle(ten)) {
    ten = deriveCleanTitle({ sp, data, ocrText, loai });
  }

  const isPlace =
    data.la_dia_diem === true ||
    /di tích|nhà hàng|quán ăn|workshop|shop|hán nôm|địa điểm|trường học|tổ chức|thương hiệu/i.test(loai);

  const diaChi = String(
    data.dia_chi || (isPlace ? "Chưa xác định rõ từ ảnh" : "Không áp dụng")
  ).trim();

  const rawPrice = String(data.nien_dai_hoac_gia || "").trim();
  const nienDaiGia = !rawPrice || /chưa xác định|không áp dụng/i.test(rawPrice)
    ? (isPlace ? "Chưa xác định rõ" : "Tham khảo theo nơi bán")
    : rawPrice;

  const isFoodOrDrink = /thức ăn|đồ uống|món ăn|nước uống|thực phẩm|bánh|trái cây/i.test(loai);
  const rawCalo = String(sp.calo_uoc_tinh || "").trim();
  const safeCalo = !isFoodOrDrink
    ? "Không áp dụng"
    : (/chưa đủ dữ liệu|chưa xác định/i.test(rawCalo)
      ? "Chưa đủ dữ liệu trên ảnh"
      : (/\d+/.test(rawCalo) ? rawCalo : "Chưa đủ dữ liệu trên ảnh"));

  const normalized = {
    loai_doi_tuong: loai,
    la_dia_diem: isPlace,
    ten_dia_diem: ten,
    dia_chi: diaChi,
    nien_dai_hoac_gia: nienDaiGia,
    cau_chuyen_lich_su: String(data.cau_chuyen_lich_su || "").trim(),
    giai_thoai_dac_biet: String(data.giai_thoai_dac_biet || "").trim(),
    thong_tin_san_pham: {
      hien_thi: typeof sp.hien_thi === "boolean" ? sp.hien_thi : true,
      calo_uoc_tinh: safeCalo,
      tot_cho_suc_khoe: isFoodOrDrink
        ? String(sp.tot_cho_suc_khoe || "Chưa đủ dữ liệu đánh giá").trim()
        : String(sp.tot_cho_suc_khoe || "Không áp dụng").trim(),
      chi_tiet_san_pham: String(sp.chi_tiet_san_pham || "Nhận diện từ đặc điểm trên ảnh").trim(),
      noi_mua_goi_y: String(sp.noi_mua_goi_y || "Đà Nẵng – Hội An").trim(),
      tu_khoa_mua_hang: String(sp.tu_khoa_mua_hang || "").trim()
    },
    han_viet: {
      co_han_viet: Boolean(hv.co_han_viet && String(hv.chu_goc || "").trim()),
      chu_goc: String(hv.chu_goc || "").trim(),
      phien_am: String(hv.phien_am || "").trim(),
      phan_tich_tung_tu: Array.isArray(hv.phan_tich_tung_tu) ? hv.phan_tich_tung_tu : [],
      y_nghia_tong_the: String(hv.y_nghia_tong_the || "").trim()
    },
    danh_gia_ban_dia: {
      tom_tat: String(dg.tom_tat || "Nhận xét thực tế theo chi tiết trong ảnh.").trim(),
      review_mau: Array.isArray(dg.review_mau)
        ? dg.review_mau.map((r) => String(r || "").trim()).filter(Boolean).slice(0, 2)
        : []
    },
    toa_do_khu_vuc: {
      lat: areaPoint.lat,
      lng: areaPoint.lng,
      khu_vuc: "Đà Nẵng – Hội An"
    },
    _ocr: ocrText,
    _verified: false,
    _provider: provider
  };

  return attachMapLinks(normalized, { areaPoint, locationContext });
}

// ==========================================
// 4. PROMPT CHI TIẾT SÂU SẮC – NHANH – KHÔNG BỊA
// ==========================================
function buildVisionPrompt(locationContext) {
  return `Chuyên gia Vision & OCR AIvolution (${locationContext || "Hội An – Đà Nẵng"}).
Luật:
1. OCR: Chép nguyên văn chữ/logo/dung tích/Hán-Nôm thấy rõ vào "chu_doc_duoc_tren_anh" (không có ghi "Không có chữ").
2. "ten_dia_diem": Ghi tên tiếng Việt cụ thể, chính xác của món ăn/vật thể/sản phẩm/địa điểm/trường học (cấm ghi "Chưa xác định").
3. Chống bịa: Không bịa thương hiệu, địa chỉ, năm thành lập (không chắc "dia_chi" ghi "Chưa xác định rõ từ ảnh"). Logo trường/tổ chức đặt "la_dia_diem":true. Phân biệt chuẩn 100% đặc sản Hội An – Đà Nẵng.
4. Giá & Calo: Ước lượng khoảng giá VNĐ thực tế tại VN cho món/sản phẩm. Calo phải đọc từ nhãn hoặc cộng từng nguyên liệu thấy rõ (liệt kê rõ từng phần vào "chi_tiet_san_pham"); bị che ghi "Chưa đủ dữ liệu trên ảnh"; đồ không ăn được ghi "Không áp dụng".
5. YÊU CẦU CHI TIẾT: Phân tích sâu, đầy đủ thông tin, cụ thể theo ảnh (2–3 câu cho mỗi mục chính). CHỈ TRẢ JSON THUẦN:
{"khong_nhan_dien_duoc":false,"chu_doc_duoc_tren_anh":"","loai_doi_tuong":"Trường học & Tổ chức|Thương hiệu|Di tích|Nhà hàng & Quán ăn|Shop & Workshop|Hán Nôm|Thức ăn & Đồ uống|Sản phẩm|Vật thể","la_dia_diem":false,"ten_dia_diem":"","dia_chi":"","nien_dai_hoac_gia":"","cau_chuyen_lich_su":"2-3 câu đầy đủ về bản chất, nguồn gốc/ý nghĩa văn hóa và công dụng thực tế","giai_thoai_dac_biet":"2-3 câu mô tả sắc nét màu sắc, hoa văn, bố cục, chất liệu, topping hoặc điểm nhấn nhìn thấy trong ảnh","thong_tin_san_pham":{"hien_thi":true,"calo_uoc_tinh":"","tot_cho_suc_khoe":"1-2 câu đánh giá dinh dưỡng/độ an toàn và lưu ý sử dụng (hoặc Không áp dụng)","chi_tiet_san_pham":"2 câu liệt kê rõ bảng cộng định lượng calo từng thành phần (nếu là món ăn) hoặc chất liệu, thông số, dung tích nổi bật","noi_mua_goi_y":"Địa điểm/khu vực hoặc hệ thống cửa hàng cụ thể tại Đà Nẵng – Hội An","tu_khoa_mua_hang":""},"han_viet":{"co_han_viet":false,"chu_goc":"","phien_am":"","phan_tich_tung_tu":[],"y_nghia_tong_the":""},"danh_gia_ban_dia":{"tom_tat":"1-2 câu nhận xét khách quan về giá trị sử dụng, độ phổ biến hoặc hương vị","review_mau":["Ưu điểm cụ thể thực tế","Lưu ý hữu ích khi mua hoặc thưởng thức"]}}`;
}

// ==========================================
// 5. TẦNG 1 (QUÉT ẢNH CHÍNH): GROQ LPU (QWEN 3.8 27B)
// ==========================================
async function fetchWorkingGroqModels(apiKey, timeoutMs = CONFIG.GROQ_MODELS_TIMEOUT_MS) {
  const now = Date.now();
  if (
    runtimeState.cachedGroqModels &&
    now - runtimeState.cachedGroqModelsAt < CONFIG.MODELS_CACHE_TTL_MS
  ) {
    return runtimeState.cachedGroqModels;
  }

  return runSingleFlight("groq:models", async () => {
    const res = await fetchWithTimeout(
      "https://api.groq.com/openai/v1/models",
      { headers: { Authorization: `Bearer ${apiKey}` } },
      timeoutMs
    );
    if (!res.ok) throw new Error(`Groq models HTTP ${res.status}`);

    const data = await res.json();
    const activeModels = (data.data || [])
      .map((m) => m.id)
      .filter(
        (id) =>
          id &&
          !/whisper|tts|guard|safeguard|embed|prompt-guard|playai|orpheus|compound/i.test(id)
      );

    if (!activeModels.length) throw new Error("Không tìm thấy model khả dụng trên Groq");

    runtimeState.cachedGroqModels = activeModels;
    runtimeState.cachedGroqModelsAt = Date.now();
    return activeModels;
  });
}

async function callGroqVision({ apiKey, model, prompt, imageUrl, timeoutMs }) {
  const isQwen38 = /qwen3\.8/i.test(model);
  const payload = {
    model,
    temperature: 0.1,
    max_completion_tokens: isQwen38 ? 850 : 1100,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } }
        ]
      }
    ]
  };

  if (isQwen38) {
    payload.reasoning_effort = "none";
  }

  const res = await fetchWithTimeout(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    },
    timeoutMs
  );

  const rawText = await res.text();
  if (!res.ok) {
    let msg = rawText.slice(0, 140);
    try {
      msg = JSON.parse(rawText)?.error?.message || msg;
    } catch (_) {}
    const err = new Error(`Groq(${model}) HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }

  const parsed = JSON.parse(rawText.trim());
  const msgObj = parsed.choices?.[0]?.message || {};
  const content = msgObj.content || msgObj.reasoning || "";
  if (!content) throw new Error(`Groq(${model}): Empty content`);
  return extractJson(content);
}

async function runGroqPrimaryVision({ apiKeys, prompt, imageBase64, deadline }) {
  const imageUrl = String(imageBase64).startsWith("data:image")
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;
  const errors = [];
  const now = Date.now();

  const availableModels = CONFIG.GROQ_VISION_MODELS.filter(
    (m) => !runtimeState.badGroqVisionModels.has(m)
  );
  const orderedModels = [
    ...availableModels.filter((m) => (runtimeState.modelCooldownUntil.get(m) || 0) <= now),
    ...availableModels.filter((m) => (runtimeState.modelCooldownUntil.get(m) || 0) > now)
  ];

  for (const model of orderedModels) {
    const remainingForModel = deadline - Date.now();
    if (remainingForModel < 1800) break;

    for (const apiKey of apiKeys.slice(0, 12)) {
      const remaining = deadline - Date.now();
      if (remaining < 1800) break;

      try {
        const result = await callGroqVision({
          apiKey,
          model,
          prompt,
          imageUrl,
          timeoutMs: Math.min(CONFIG.GROQ_VISION_TIMEOUT_MS, remaining)
        });
        if (result && typeof result === "object") {
          return { result, provider: `groq:${String(model).split("/").pop()}` };
        }
      } catch (err) {
        const msg = err?.name === "AbortError" ? `Groq(${model}) Timeout` : err.message;
        errors.push(msg);

        if (err.status === 400 || err.status === 404) {
          runtimeState.badGroqVisionModels.add(model);
          break;
        }
        if (err.status === 429) {
          markKeyCooldown(apiKey, CONFIG.KEY_COOLDOWN_429_MS);
          continue;
        }
        if (err.status === 401 || err.status === 403) {
          markKeyCooldown(apiKey, CONFIG.KEY_COOLDOWN_AUTH_MS);
          continue;
        }
        if (err.status === 502 || err.status === 503 || msg.includes("Timeout")) {
          if (availableModels.length > 1) {
            runtimeState.modelCooldownUntil.set(model, Date.now() + CONFIG.MODEL_COOLDOWN_MS);
          }
          break;
        }
      }
    }
  }

  const finalErr = new Error(errors.slice(0, 3).join(" | ") || "Groq Vision không phản hồi");
  finalErr.isRateLimit = errors.some((e) => e.includes("429"));
  finalErr.isOverloaded = errors.some((e) => e.includes("503") || e.includes("502") || e.includes("Timeout"));
  throw finalErr;
}

// ==========================================
// 6. TẦNG 2 (DỰ PHÒNG CHỐNG SẬP): OPENROUTER FREE VISION (THROUGHPUT + BẮN GỐI ĐẦU)
// ==========================================
async function callSingleOpenRouterVision({ apiKey, model, prompt, imageUrl, timeoutMs }) {
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
        temperature: 0.1,
        max_tokens: 1200,
        reasoning: { enabled: false },
        provider: { sort: "throughput" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ]
      })
    },
    timeoutMs
  );

  const rawText = await res.text();
  if (!res.ok) {
    let errDetail = "";
    try {
      errDetail = JSON.parse(rawText)?.error?.message || "";
    } catch (_) {}

    if (res.status === 404) {
      runtimeState.badOpenRouterModels.add(model);
    } else if (res.status === 429 || res.status === 502 || res.status === 503) {
      runtimeState.modelCooldownUntil.set(model, Date.now() + CONFIG.MODEL_COOLDOWN_MS);
      if (res.status === 429 && model === "openrouter/free") {
        markKeyCooldown(apiKey, CONFIG.KEY_COOLDOWN_429_MS);
      }
    } else if (res.status === 401 || res.status === 402 || res.status === 403) {
      markKeyCooldown(apiKey, CONFIG.KEY_COOLDOWN_AUTH_MS);
    }
    throw new Error(`OpenRouter(${model}) HTTP ${res.status}${errDetail ? `: ${errDetail.slice(0, 80)}` : ""}`);
  }

  const parsed = JSON.parse(rawText.trim());
  const msgObj = parsed.choices?.[0]?.message || {};
  const content = msgObj.content || msgObj.reasoning || "";
  if (!content) {
    runtimeState.modelCooldownUntil.set(model, Date.now() + CONFIG.MODEL_COOLDOWN_MS);
    throw new Error(`OpenRouter(${model}): Empty content`);
  }

  const usedModel = parsed.model || model;
  return {
    result: extractJson(content),
    provider: `openrouter:${String(usedModel).split("/").pop()}`
  };
}

async function runOpenRouterBackupVision({ apiKeys, prompt, imageBase64, deadline }) {
  const imageUrl = String(imageBase64).startsWith("data:image")
    ? imageBase64
    : `data:image/jpeg;base64,${imageBase64}`;
  const now = Date.now();

  const available = CONFIG.OPENROUTER_VISION_MODELS.filter(
    (m) => !runtimeState.badOpenRouterModels.has(m)
  );
  const orderedModels = [
    ...available.filter((m) => (runtimeState.modelCooldownUntil.get(m) || 0) <= now),
    ...available.filter((m) => (runtimeState.modelCooldownUntil.get(m) || 0) > now)
  ];

  const orKeyPool = apiKeys.slice(0, 8); let orKeyCursor = 0; const nextOrKey = () => orKeyPool[(orKeyCursor++) % orKeyPool.length]; const primaryKey = nextOrKey();
  const backupKey = apiKeys[1] || apiKeys[0];
  const errors = [];

  const m1 = orderedModels[0];
  const m2 = orderedModels[1];
  if (m1 && m2) {
    try {
      let hedgeTimer = null;
      let startedP2 = false;
      let triggerP2 = null;

      const p1 = callSingleOpenRouterVision({
        apiKey: nextOrKey(),
        model: m1,
        prompt,
        imageUrl,
        timeoutMs: Math.min(CONFIG.OPENROUTER_BACKUP_TIMEOUT_MS, deadline - Date.now())
      });

      const p2 = new Promise((resolve, reject) => {
        triggerP2 = () => {
          if (startedP2) return;
          startedP2 = true;
          clearTimeout(hedgeTimer);
          const left = deadline - Date.now();
          if (left < 1400) return reject(new Error("Hết thời gian cho nhánh dự phòng"));
          callSingleOpenRouterVision({
            apiKey: backupKey,
            model: m2,
            prompt,
            imageUrl,
            timeoutMs: Math.min(CONFIG.OPENROUTER_BACKUP_TIMEOUT_MS, left)
          }).then(resolve, reject);
        };
        hedgeTimer = setTimeout(triggerP2, CONFIG.HEDGE_DELAY_MS);
      });

      p1.then(
        () => clearTimeout(hedgeTimer),
        () => triggerP2 && triggerP2()
      );

      return await Promise.any([p1, p2]);
    } catch (aggErr) {
      const list = aggErr?.errors || [aggErr];
      list.forEach((e) =>
        errors.push(e?.name === "AbortError" ? "OpenRouter Timeout" : e?.message || "Failed")
      );
    }
  }

  for (const model of orderedModels.slice(2, 4)) {
    const remaining = deadline - Date.now();
    if (remaining < 1400) break;
    try {
      return await callSingleOpenRouterVision({
        apiKey: backupKey,
        model,
        prompt,
        imageUrl,
        timeoutMs: Math.min(3800, remaining)
      });
    } catch (err) {
      errors.push(err?.name === "AbortError" ? `OpenRouter(${model}) Timeout` : err.message);
    }
  }

  const finalErr = new Error(errors.slice(0, 3).join(" | ") || "OpenRouter không phản hồi");
  finalErr.isRateLimit = errors.some((e) => e.includes("429"));
  finalErr.isOverloaded = errors.some((e) => e.includes("503") || e.includes("502") || e.includes("Timeout"));
  throw finalErr;
}

// ==========================================
// 7. XÁC THỰC GOOGLE THÔNG MINH (CHỈ GỌI KHI CÓ ĐỊA ĐIỂM HOẶC THƯƠNG HIỆU RÕ)
// ==========================================
async function querySerperCached(query, num = 4, timeoutMs = CONFIG.SERPER_TIMEOUT_MS) {
  const normKey = `serper:${normalizeTextForMatch(query)}:${num}`;
  const cached = getCache(runtimeState.serperCache, normKey);
  if (cached !== null) return cached;

  const apiKeys = collectApiKeys("SERPER_API_KEY");
  if (!apiKeys.length || !query) return null;

  return runSingleFlight(normKey, async () => {
    for (const apiKey of apiKeys.slice(0, 2)) {
      try {
        const res = await fetchWithTimeout(
          "https://google.serper.dev/search",
          {
            method: "POST",
            headers: {
              "X-API-KEY": apiKey,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ q: query, gl: "vn", hl: "vi", num })
          },
          timeoutMs
        );

        if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 429) {
          markKeyCooldown(apiKey, CONFIG.KEY_COOLDOWN_AUTH_MS);
          continue;
        }
        if (!res.ok) continue;

        const data = await res.json();
        setCache(runtimeState.serperCache, normKey, data, CONFIG.SERPER_CACHE_TTL_MS, 250);
        return data;
      } catch (_) {
        continue;
      }
    }
    return null;
  });
}

function extractPriceRangeFromSerper(data) {
  const texts = [];
  if (data.answerBox?.snippet) texts.push(data.answerBox.snippet);
  (data.organic || []).forEach((item) => {
    if (item.price) texts.push(String(item.price));
    if (item.title) texts.push(item.title);
    if (item.snippet) texts.push(item.snippet);
  });

  const fullText = texts.join(" | ");
  const prices = [];

  const regexVnd = /(?:₫\s*)?(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|₫|vnđ|vnd)?/gi;
  let match;
  while ((match = regexVnd.exec(fullText)) !== null) {
    const val = Number(match[1].replace(/[.,]/g, ""));
    if (val >= 5000 && val <= 100000000) prices.push(val);
  }

  const regexK = /\b(\d{2,4})k\b/gi;
  while ((match = regexK.exec(fullText)) !== null) {
    const val = Number(match[1]) * 1000;
    if (val >= 5000 && val <= 50000000) prices.push(val);
  }

  if (!prices.length) return null;

  prices.sort((a, b) => a - b);
  const cut = prices.length >= 6 ? Math.floor(prices.length * 0.25) : (prices.length >= 4 ? 1 : 0);
  const trimmed = cut > 0 ? prices.slice(cut, prices.length - cut) : prices;
  const minP = trimmed[0];
  const maxP = trimmed[trimmed.length - 1];

  const fmt = (n) => n.toLocaleString("vi-VN");
  return minP === maxP ? `${fmt(minP)} VNĐ` : `${fmt(minP)} - ${fmt(maxP)} VNĐ`;
}

async function autoVerifyWithGoogle(payload, { areaPoint, locationContext, timeoutMs }) {
  if (!payload || !payload.ten_dia_diem || isInvalidTitle(payload.ten_dia_diem)) return payload;

  const isSchoolOrOrg = /trường học|tổ chức|di tích|hán nôm/i.test(payload.loai_doi_tuong);
  const isPlaceOrBrand =
    payload.la_dia_diem ||
    /trường học|tổ chức|thương hiệu|nhà hàng|quán ăn|shop|workshop|di tích/i.test(payload.loai_doi_tuong);
  const isFood = /thức ăn|đồ uống|món ăn|nước uống|thực phẩm/i.test(payload.loai_doi_tuong);

  if (isPlaceOrBrand) {
    const cityHint = detectLocalCityName(areaPoint, locationContext);
    const hasRegionInName = /hội an|đà nẵng|quảng nam|hà nội|tp\.?hcm|hồ chí minh|huế/i.test(
      `${payload.ten_dia_diem} ${payload._ocr || ""}`
    );

    const searchQuery = isSchoolOrOrg
      ? `${payload.ten_dia_diem}${hasRegionInName ? "" : ` ${cityHint}`} địa chỉ năm thành lập`
      : `${payload.ten_dia_diem}${hasRegionInName ? "" : ` ${cityHint}`} địa chỉ giá`;

    const data = await querySerperCached(searchQuery, 4, timeoutMs);
    if (!data) return payload;

    let verifiedAny = false;
    const kg = data.knowledgeGraph || {};
    const attrs = kg.attributes && typeof kg.attributes === "object" ? kg.attributes : {};
    const allSnippets = [
      data.answerBox?.snippet || "",
      kg.description || "",
      ...(data.organic || []).map((i) => `${i.title || ""} - ${i.snippet || ""}`)
    ].join(" | ");

    const attrAddr = attrs["Địa chỉ"] || attrs["Address"] || kg.address || "";
    if (attrAddr && attrAddr.length >= 6) {
      payload.dia_chi = String(attrAddr).trim();
      verifiedAny = true;
    } else if (/chưa xác định|không áp dụng/i.test(payload.dia_chi)) {
      const addrMatch = allSnippets.match(/Địa chỉ[:\s]+([^.|;\n]{8,95})/i);
      if (addrMatch) {
        payload.dia_chi = addrMatch[1].trim();
        verifiedAny = true;
      }
    }

    const foundedAttr = attrs["Thành lập"] || attrs["Năm thành lập"] || attrs["Founded"] || "";
    if (isSchoolOrOrg) {
      if (foundedAttr) {
        payload.nien_dai_hoac_gia = `Thành lập ${String(foundedAttr).trim()}`;
        verifiedAny = true;
      } else if (/chưa xác định|tham khảo/i.test(payload.nien_dai_hoac_gia)) {
        const yearMatch = allSnippets.match(
          /thành lập(?:\s+vào)?(?:\s+ngày)?\s+(\d{1,2}[\/.-]\d{1,2}[\/.-](?:1\d{3}|20\d{2})|(?:năm\s+)?(?:1\d{3}|20\d{2}))/i
        );
        if (yearMatch) {
          const cleanYear = yearMatch[1].replace(/^năm\s+/i, "").trim();
          payload.nien_dai_hoac_gia = /^\d{4}$/.test(cleanYear)
            ? `Thành lập năm ${cleanYear}`
            : `Thành lập ${cleanYear}`;
          verifiedAny = true;
        }
      }
    } else {
      const realPrice = extractPriceRangeFromSerper(data);
      if (realPrice) {
        payload.nien_dai_hoac_gia = realPrice;
        verifiedAny = true;
      }
    }

    const hoursAttr = attrs["Giờ"] || attrs["Giờ mở cửa"] || attrs["Hours"] || "";
    if (hoursAttr && payload.thong_tin_san_pham) {
      const baseLoc = !/chưa xác định|không áp dụng/i.test(payload.dia_chi)
        ? payload.dia_chi
        : payload.thong_tin_san_pham.noi_mua_goi_y;
      payload.thong_tin_san_pham.noi_mua_goi_y = `${baseLoc} (${String(hoursAttr).trim()})`;
      verifiedAny = true;
    } else if (!/chưa xác định|không áp dụng/i.test(payload.dia_chi) && payload.thong_tin_san_pham) {
      payload.thong_tin_san_pham.noi_mua_goi_y = payload.dia_chi;
    }

    if (kg.rating) {
      const countText = kg.ratingCount ? ` (${Number(kg.ratingCount).toLocaleString("vi-VN")} đánh giá)` : "";
      payload.danh_gia_ban_dia.tom_tat = `Google: ${kg.rating}/5 ⭐${countText}. ${payload.danh_gia_ban_dia.tom_tat}`;
      verifiedAny = true;
    }

    payload._verified = verifiedAny;
    return attachMapLinks(payload, { areaPoint, locationContext });
  }

  const hasBrandText = Boolean(payload._ocr && !/^không có chữ$/i.test(payload._ocr) && payload._ocr.length >= 3);
  if (!hasBrandText || isFood) return payload;

  const unitMatch = String(payload._ocr || "").match(/\b\d+\s*(?:ml|g|kg|lít|l|viên|gói)\b/i);
  const searchName = unitMatch && !payload.ten_dia_diem.toLowerCase().includes(unitMatch[0].toLowerCase())
    ? `${payload.ten_dia_diem} ${unitMatch[0]}`
    : payload.ten_dia_diem;

  const data = await querySerperCached(`giá ${searchName} chính hãng`, 4, timeoutMs);
  if (data) {
    const realPrice = extractPriceRangeFromSerper(data);
    if (realPrice) {
      payload.nien_dai_hoac_gia = realPrice;
      payload._verified = true;
    }
  }
  return payload;
}


module.exports = {
  clampToDaNangHoiAn,
  buildVisionPrompt,
  runGroqPrimaryVision,
  runOpenRouterBackupVision,
  normalizeScanResult,
  querySerperCached,
  autoVerifyWithGoogle,
  fetchWorkingGroqModels
};
