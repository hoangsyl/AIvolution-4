/**
 * AIvolution - AI Travel Planner Siêu Nhanh, Chi Tiết & Không Bao Giờ Lỗi (Đà Nẵng – Hội An)
 * - Tầng 1: Groq tốc độ cao (qwen/qwen3.8-27b non-thinking 450t/s, openai/gpt-oss-20b 1000t/s, gpt-oss-120b)
 * - Tầng 2: OpenRouter Free dự phòng (openrouter/free, gemma-3-27b-it:free, mistral-small-3.1-24b:free)
 * - Tầng 3: Smart Local Engine (tự động dựng lịch trình chi tiết 1-7 ngày theo đúng ngân sách & sở thích nếu API quá tải/hết key -> 0% lỗi)
 * - Xoay vòng tới 30 API keys + Single-flight + Cache 6 giờ
 */

const crypto = require("crypto");

const CONFIG = {
  GROQ_MODELS: [
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile"
  ],
  OPENROUTER_MODELS: [
    "openrouter/free",
    "google/gemma-3-27b-it:free",
    "mistralai/mistral-small-3.1-24b-instruct:free"
  ],
  GROQ_TIMEOUT_MS: 11000,
  OPENROUTER_TIMEOUT_MS: 9000,
  CACHE_TTL_MS: 6 * 60 * 60 * 1000,
  MAX_CACHE_ENTRIES: 400,
  KEY_COOLDOWN_429_MS: 30 * 1000
};

const state = {
  cache: new Map(),
  inFlight: new Map(),
  keyCooldown: new Map(),
  rr: Object.create(null)
};

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
  const ready = unique.filter((k) => (state.keyCooldown.get(k) || 0) <= now);
  const cooling = unique.filter((k) => (state.keyCooldown.get(k) || 0) > now);
  const pool = ready.length ? ready : unique;
  const idx = (state.rr[prefix] || 0) % pool.length;
  state.rr[prefix] = idx + 1;
  return [...pool.slice(idx), ...pool.slice(0, idx), ...cooling];
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getCache(key) {
  const entry = state.cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) {
    state.cache.delete(key);
    return null;
  }
  return entry.val;
}

function setCache(key, val) {
  if (state.cache.size >= CONFIG.MAX_CACHE_ENTRIES) {
    const oldest = state.cache.keys().next().value;
    if (oldest !== undefined) state.cache.delete(oldest);
  }
  state.cache.set(key, { val, exp: Date.now() + CONFIG.CACHE_TTL_MS });
}

function extractJson(rawText) {
  const cleaned = String(rawText || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Không phân tích được JSON lịch trình");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function buildMapsUrl(placeName, address, city) {
  const q = `${String(placeName || "").trim()} ${String(address || city || "Đà Nẵng Hội An").trim()}`.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// ============================================================
// KHO DỮ LIỆU ĐỊA DANH & ẨM THỰC THỰC TẾ ĐÀ NẴNG – HỘI AN
// ============================================================
const LOCAL_KNOWLEDGE = `
KHO ĐỊA DANH & QUÁN ĂN THỰC TẾ (CHỈ DÙNG ĐỊA ĐIỂM CÓ THẬT, XẾP THEO CỤM GẦN NHAU):
- ĐÀ NẴNG:
  + Cụm Biển Mỹ Khê & Sơn Trà: Bãi biển Mỹ Khê (0đ), Bán đảo Sơn Trà – Chùa Linh Ứng (0đ), Đỉnh Bàn Cờ (0đ), Bãi Đá Obama, Bún chả cá 109 Nguyễn Chí Thanh (35k), Mì Quảng Bà Mua 19 Trần Bình Trọng (35k-50k), Hải sản Năm Đảnh K139/59/38 Trần Quang Khải (100k-200k).
  + Cụm Trung tâm Sông Hàn: Chợ Cồn 290 Hùng Vương (ăn vặt bánh bèo/ốc/kem bơ 15k-35k), Chợ Hàn 119 Trần Phú, Cầu Rồng (phun lửa/nước 21:00 T6-T7-CN, 0đ), Cầu Tình Yêu (0đ), Bảo tàng Điêu khắc Chăm (~60k), Bánh tráng cuốn thịt heo Mậu 35 Đỗ Thúc Tịnh (80k-120k), Cà phê Cộng / Bạch Đằng ven sông (30k-50k).
  + Cụm Ngũ Hành Sơn (trên đường đi Hội An): Danh thắng Ngũ Hành Sơn – Động Huyền Không (vé 40k), Làng đá mỹ nghệ Non Nước (0đ), Bãi biển Non Nước (0đ).
  + Cụm Bà Nà Hills (chỉ xếp nếu ngân sách/người >= 1.200.000đ): Sun World Bà Nà Hills (~900k).
- HỘI AN:
  + Cụm Phố cổ (đi bộ): Chùa Cầu, Nhà cổ Tấn Ký 101 Nguyễn Thái Học, Hội quán Phúc Kiến 46 Trần Phú, Sông Hoài & Chợ đêm Nguyễn Hoàng (0đ đi dạo), Nước Mót 150 Trần Phú (16k-25k), Cao Lầu Thanh 26 Thái Phiên (30k-45k), Cơm Gà Bà Buội 22 Phan Chu Trinh (35k-55k), Bánh Mì Phượng 2B Phan Chu Trinh (25k-40k), Bánh Mì Madam Khánh 115 Trần Cao Vân (25k-35k), Chè Xí Mà Phủ Ông Thiều 130 Nguyễn Trường Tộ (10k-15k), Workshop làm đèn lồng phố cổ (100k-250k).
  + Cụm Cẩm Thanh & Trà Quế: Làng rau Trà Quế (đạp xe/chụp ảnh 0đ-35k, workshop nấu ăn), Rừng Dừa Bảy Mẫu (thuyền thúng ~150k/thuyền 2 người), Làng gốm Thanh Hà (35k, nặn gốm), Bánh đập Hến xào Cẩm Nam (25k-40k).
  + Cụm Biển Hội An & Ký Ức Hội An: Bãi biển An Bàng (0đ), Biển Cửa Đại (0đ), Công viên Ấn Tượng & Show Ký Ức Hội An Cồn Hến (xem nếu đủ ngân sách).
`;

function buildPrompt({ city, days, budget, people, style, transport, interests }) {
  const perPerson = Math.round(budget / Math.max(1, people));
  const perDay = Math.round(budget / Math.max(1, days));
  const isUltraBudget = perPerson / days < 200000;
  return `Bạn là chuyên gia lập lịch trình du lịch thực tế tại Đà Nẵng – Hội An.
${LOCAL_KNOWLEDGE}

THÔNG TIN CHUYẾN ĐI:
- Điểm đến: ${city}
- Số ngày: ${days} ngày (bắt buộc đủ chính xác ${days} ngày)
- Tổng ngân sách: ${budget.toLocaleString("vi-VN")} VNĐ cho ${people} người (~${perPerson.toLocaleString("vi-VN")}đ/người, ~${perDay.toLocaleString("vi-VN")}đ/ngày)
- Loại hình: ${style} | Phương tiện: ${transport}
- Sở thích: ${interests}

QUY TẮC BẮT BUỘC:
1. Mỗi ngày phải có ĐÚNG 4–5 khung giờ chi tiết (Sáng, Trưa, Chiều, Tối) kèm địa chỉ cụ thể, món nên gọi hoặc trải nghiệm nên làm.
2. Xếp các địa điểm cùng cụm gần nhau trong 1 ngày để tiết kiệm thời gian di chuyển.
3. ${isUltraBudget ? "Ngân sách siêu tiết kiệm: Ưu tiên điểm tham quan/biển/phố cổ MIỄN PHÍ (0đ) và quán ăn bình dân/chợ địa phương 15k-40k để tổng chi phí thực tế sát ngân sách." : "Cân đối tổng chi phí ước tính sát ngân sách người dùng nhập."}
4. Chỉ trả về DUY NHẤT 1 JSON hợp lệ (không viết chữ nào ngoài JSON):
{
  "title": "Tiêu đề ngắn gọn hấp dẫn",
  "summary": "Tóm tắt 2 câu về tuyến đi, phong cách và điểm nhấn nổi bật",
  "totalEstimatedVnd": ${budget},
  "tips": ["Mẹo di chuyển tiết kiệm 1", "Mẹo ăn uống/check-in 2", "Mẹo thời tiết/giờ đẹp 3"],
  "days": [
    {
      "day": 1,
      "theme": "Chủ đề cụ thể ngày 1",
      "slots": [
        {
          "time": "07:30",
          "period": "Sáng",
          "place": "Tên địa điểm/quán ăn thật",
          "address": "Địa chỉ ngắn gọn",
          "activity": "Mô tả chi tiết việc nên làm, góc chụp đẹp hoặc món nên gọi",
          "costVnd": 35000
        }
      ]
    }
  ]
}`;
}

// ============================================================
// SMART LOCAL ITINERARY ENGINE (FALLBACK 0% LỖI, CHI TIẾT 1-7 NGÀY)
// ============================================================
const DAY_TEMPLATES_DANANG = [
  {
    theme: "Biển Mỹ Khê, Bán đảo Sơn Trà & Trung tâm Sông Hàn",
    slots: [
      { time: "06:30", period: "Sáng", place: "Bãi biển Mỹ Khê", address: "Võ Nguyên Giáp, Sơn Trà, Đà Nẵng", activity: "Đón bình minh, dạo biển chụp ảnh và hít thở không khí biển trong lành.", costVnd: 0 },
      { time: "08:00", period: "Sáng", place: "Mì Quảng Bà Mua", address: "19 Trần Bình Trọng, Hải Châu, Đà Nẵng", activity: "Thưởng thức mì Quảng tôm thịt/ếch chuẩn vị kèm rau sống tươi.", costVnd: 40000 },
      { time: "09:30", period: "Sáng", place: "Bán đảo Sơn Trà & Chùa Linh Ứng", address: "Hoàng Sa, Thọ Quang, Sơn Trà, Đà Nẵng", activity: "Viếng tượng Phật Quan Âm cao 67m, ngắm toàn cảnh vịnh Đà Nẵng từ trên cao.", costVnd: 0 },
      { time: "12:30", period: "Trưa", place: "Chợ Cồn Đà Nẵng", address: "290 Hùng Vương, Hải Châu, Đà Nẵng", activity: "Khám phá thiên đường ẩm thực bình dân: bánh bèo, bún mắm nêm, kem bơ Cô Vân.", costVnd: 45000 },
      { time: "16:30", period: "Chiều", place: "Cầu Tình Yêu & Cá Chép Hóa Rồng", address: "Trần Hưng Đạo, Sơn Trà, Đà Nẵng", activity: "Chụp ảnh hoàng hôn ven sông Hàn và dạo bộ hóng gió mát.", costVnd: 0 },
      { time: "19:30", period: "Tối", place: "Cầu Rồng & Chợ đêm Sơn Trà", address: "Mai Hắc Đế, Sơn Trà, Đà Nẵng", activity: "Dạo chợ đêm ăn vặt hải sản xiên nướng và xem Cầu Rồng lên đèn (phun lửa 21h T6–CN).", costVnd: 50000 }
    ]
  },
  {
    theme: "Ngũ Hành Sơn, Làng đá Non Nước & Biển chiều",
    slots: [
      { time: "07:30", period: "Sáng", place: "Bún Chả Cá 109", address: "109 Nguyễn Chí Thanh, Hải Châu, Đà Nẵng", activity: "Ăn sáng bún chả cá nước dùng thanh ngọt đặc trưng Đà Nẵng.", costVnd: 35000 },
      { time: "09:00", period: "Sáng", place: "Danh thắng Ngũ Hành Sơn", address: "81 Huyền Trân Công Chúa, Ngũ Hành Sơn", activity: "Leo bộ khám phá Động Huyền Không, Chùa Linh Ứng cổ và ngắm toàn cảnh biển Non Nước.", costVnd: 40000 },
      { time: "11:30", period: "Trưa", place: "Làng đá mỹ nghệ Non Nước & Quán cơm địa phương", address: "Huyền Trân Công Chúa, Ngũ Hành Sơn", activity: "Tham quan xưởng điêu khắc đá truyền thống và nghỉ trưa ăn cơm bình dân.", costVnd: 40000 },
      { time: "15:30", period: "Chiều", place: "Bãi biển Non Nước", address: "Trường Sa, Ngũ Hành Sơn, Đà Nẵng", activity: "Tắm biển, chụp ảnh bãi cát trắng yên bình ít đông người hơn Mỹ Khê.", costVnd: 0 },
      { time: "19:00", period: "Tối", place: "Phố đi bộ Bạch Đằng & Cà phê ven sông", address: "Bạch Đằng, Hải Châu, Đà Nẵng", activity: "Uống cà phê muối/trà trái cây và ngắm cầu quay Sông Hàn về đêm.", costVnd: 35000 }
    ]
  },
  {
    theme: "Văn hóa Chăm, Chợ Hàn & Check-in Đỉnh Bàn Cờ",
    slots: [
      { time: "07:30", period: "Sáng", place: "Bánh Mì Bà Lan", address: "62 Trưng Nữ Vương, Hải Châu, Đà Nẵng", activity: "Ăn sáng bánh mì chả bò, pate giòn rụm nổi tiếng của người địa phương.", costVnd: 25000 },
      { time: "09:00", period: "Sáng", place: "Nhà thờ Chính Tòa (Nhà thờ Con Gà) & Chợ Hàn", address: "156 Trần Phú, Hải Châu, Đà Nẵng", activity: "Chụp ảnh kiến trúc màu hồng cổ điển và dạo Chợ Hàn mua quà đặc sản.", costVnd: 0 },
      { time: "11:30", period: "Trưa", place: "Bánh Xèo Bà Dưỡng", address: "K280/23 Hoàng Diệu, Hải Châu, Đà Nẵng", activity: "Thưởng thức bánh xèo giòn rụm, nem lụi cuốn rau sống chấm nước lèo đậu phộng.", costVnd: 60000 },
      { time: "15:30", period: "Chiều", place: "Cung đường Sơn Trà – Hồ Xanh – Cây Đa Ngàn Năm", address: "Bán đảo Sơn Trà, Đà Nẵng", activity: "Chạy xe ngắm cảnh thiên nhiên rừng biển, chụp ảnh sống ảo cực đẹp.", costVnd: 0 },
      { time: "19:00", period: "Tối", place: "Hải sản bình dân ven biển Phạm Văn Đồng", address: "Phạm Văn Đồng, Sơn Trà, Đà Nẵng", activity: "Ăn tối ốc hút, nghêu hấp sả và dạo công viên Biển Đông.", costVnd: 65000 }
    ]
  }
];

const DAY_TEMPLATES_HOIAN = [
  {
    theme: "Phố cổ Hội An, Ẩm thực đặc sản & Đèn lồng Sông Hoài",
    slots: [
      { time: "07:30", period: "Sáng", place: "Bánh Mì Phượng Hội An", address: "2B Phan Chu Trinh, Hội An", activity: "Thưởng thức ổ bánh mì thập cẩm giòn rụm trứ danh Phố cổ.", costVnd: 30000 },
      { time: "08:30", period: "Sáng", place: "Chùa Cầu & Trục đường Trần Phú – Nguyễn Thái Học", address: "Phố cổ Hội An, Quảng Nam", activity: "Đi bộ chụp ảnh tường vàng mái ngói rêu phong lúc sáng sớm ít khách.", costVnd: 0 },
      { time: "11:30", period: "Trưa", place: "Cao Lầu Thanh", address: "26 Thái Phiên, Hội An", activity: "Ăn trưa Cao Lầu chuẩn vị sợi dai, thịt xá xíu mềm và rau Trà Quế.", costVnd: 35000 },
      { time: "15:00", period: "Chiều", place: "Nước Mót Hội An & Cafe sân thượng Faifo", address: "150 & 130 Trần Phú, Hội An", activity: "Uống trà thảo mộc cánh sen giải nhiệt và ngắm toàn cảnh mái ngói phố cổ từ tầng thượng.", costVnd: 20000 },
      { time: "18:30", period: "Tối", place: "Sông Hoài, Chợ đêm Nguyễn Hoàng & Chè Xí Mà Phủ", address: "Nguyễn Hoàng & 130 Nguyễn Trường Tộ, Hội An", activity: "Ngắm phố đèn lồng lung linh bên sông Hoài và ăn chè mè đen gia truyền.", costVnd: 25000 }
    ]
  },
  {
    theme: "Làng rau Trà Quế, Làng gốm Thanh Hà & Biển An Bàng",
    slots: [
      { time: "07:30", period: "Sáng", place: "Cơm Gà Bà Buội / Xôi sáng Phố cổ", address: "22 Phan Chu Trinh, Hội An", activity: "Nạp năng lượng buổi sáng với đặc sản Hội An trước khi chạy ra vùng ven.", costVnd: 40000 },
      { time: "09:00", period: "Sáng", place: "Làng rau Trà Quế", address: "Cẩm Hà, TP. Hội An", activity: "Dạo quanh cánh đồng rau hữu cơ xanh mướt, chụp ảnh đồng quê và tìm hiểu cách trồng rau.", costVnd: 0 },
      { time: "11:30", period: "Trưa", place: "Bánh Đập – Hến Xào Cẩm Nam", address: "Lương Như Bích, Cẩm Nam, Hội An", activity: "Thưởng thức bánh đập giòn dẻo chấm mắm nêm ăn kèm hến xào đậm đà.", costVnd: 35000 },
      { time: "14:30", period: "Chiều", place: "Làng gốm Thanh Hà (Workshop chuốt gốm)", address: "Phạm Phán, Thanh Hà, Hội An", activity: "Tham quan làng nghề 500 năm tuổi và tự tay trải nghiệm chuốt gốm thủ công.", costVnd: 35000 },
      { time: "16:45", period: "Chiều", place: "Bãi biển An Bàng", address: "Hai Bà Trưng, Cẩm An, Hội An", activity: "Tắm biển, ngắm hoàng hôn cực chill và thưởng thức đồ nướng ven biển.", costVnd: 30000 }
    ]
  },
  {
    theme: "Rừng Dừa Bảy Mẫu, Workshop Đèn Lồng & Chiều Cẩm Kim",
    slots: [
      { time: "07:30", period: "Sáng", place: "Bánh Mì Madam Khánh", address: "115 Trần Cao Vân, Hội An", activity: "Ăn sáng bánh mì thập cẩm đậm đà nộm đu đủ giòn.", costVnd: 25000 },
      { time: "09:00", period: "Sáng", place: "Khu du lịch Rừng Dừa Bảy Mẫu", address: "Cẩm Thanh, TP. Hội An", activity: "Tham quan vùng sông nước dừa nước xanh mát (có thể ghép thuyền thúng hoặc chụp ảnh ven kênh).", costVnd: 0 },
      { time: "12:00", period: "Trưa", place: "Chợ Hội An (Khu ẩm thực trong chợ)", address: "19 Trần Phú, Hội An", activity: "Ăn trưa bún thịt nướng, hoành thánh, bánh bao bánh vạc siêu ngon giá địa phương.", costVnd: 35000 },
      { time: "14:30", period: "Chiều", place: "Xưởng làm đèn lồng thủ công Hội An", address: "Khu vực Phố cổ / Cẩm Châu, Hội An", activity: "Tham quan quy trình bọc lụa đèn lồng truyền thống hoặc tham gia workshop gấp đèn.", costVnd: 0 },
      { time: "17:00", period: "Chiều", place: "Cầu Cẩm Kim & Cánh đồng lúa Cẩm Châu", address: "Cẩm Châu – Cẩm Kim, Hội An", activity: "Chạy xe đón hoàng hôn trên cánh đồng lúa bình yên và ăn tối quán địa phương.", costVnd: 35000 }
    ]
  },
  {
    theme: "Biển Cửa Đại, Cà phê đồng lúa & Mua quà đặc sản",
    slots: [
      { time: "07:00", period: "Sáng", place: "Bãi biển Cửa Đại", address: "Âu Cơ, Cửa Đại, Hội An", activity: "Đón bình minh trên biển, đi dạo bờ cát yên tĩnh.", costVnd: 0 },
      { time: "08:30", period: "Sáng", place: "Mì Quảng Ông Hai", address: "6A Trương Minh Lượng, Hội An", activity: "Thưởng thức tô mì Quảng nóng hổi đậm đà hương vị Quảng Nam.", costVnd: 35000 },
      { time: "10:30", period: "Sáng", place: "Quán cà phê view đồng lúa (Roving Chillhouse / Chic Chillax)", address: "Nguyễn Trãi, Cẩm Châu, Hội An", activity: "Thư giãn giữa cánh đồng lúa xanh và chụp bộ ảnh nghỉ dưỡng.", costVnd: 40000 },
      { time: "15:00", period: "Chiều", place: "Chợ Hội An & Con hẻm vàng Hoàng Văn Thụ", address: "Phố cổ Hội An", activity: "Chụp ảnh lưu niệm những góc hẻm vàng đặc trưng và mua bánh đậu xanh nướng làm quà.", costVnd: 30000 }
    ]
  }
];

function buildSmartLocalPlan(params) {
  const { city, days, budget, people, style, transport } = params;
  const isOnlyDn = /đà nẵng/i.test(city) && !/hội an/i.test(city);
  const isOnlyHa = /hội an/i.test(city) && !/đà nẵng/i.test(city);

  const selectedDays = [];
  let dnIdx = 0;
  let haIdx = 0;

  for (let i = 0; i < days; i++) {
    let tpl;
    if (isOnlyDn) {
      tpl = DAY_TEMPLATES_DANANG[dnIdx++ % DAY_TEMPLATES_DANANG.length];
    } else if (isOnlyHa) {
      tpl = DAY_TEMPLATES_HOIAN[haIdx++ % DAY_TEMPLATES_HOIAN.length];
    } else {
      // Kết hợp Đà Nẵng – Hội An: nửa đầu Đà Nẵng, nửa sau Hội An
      const dnDaysCount = Math.max(1, Math.floor(days / 2));
      if (i < dnDaysCount) {
        tpl = DAY_TEMPLATES_DANANG[dnIdx++ % DAY_TEMPLATES_DANANG.length];
      } else {
        tpl = DAY_TEMPLATES_HOIAN[haIdx++ % DAY_TEMPLATES_HOIAN.length];
      }
    }
    selectedDays.push({
      day: i + 1,
      theme: tpl.theme,
      slots: tpl.slots.map((s) => ({ ...s }))
    });
  }

  // Cân chỉnh chi phí dự kiến khớp ngân sách người dùng nhập
  const rawTotal = selectedDays.reduce(
    (sum, d) => sum + d.slots.reduce((s2, sl) => s2 + (sl.costVnd || 0) * people, 0),
    0
  );
  const scale = rawTotal > budget && rawTotal > 0 ? budget / rawTotal : 1;
  let finalTotal = 0;

  const finalDays = selectedDays.map((d) => ({
    day: d.day,
    theme: d.theme,
    slots: d.slots.map((s) => {
      const scaled = s.costVnd > 0 ? Math.max(10000, Math.round((s.costVnd * people * scale) / 5000) * 5000) : 0;
      finalTotal += scaled;
      return {
        time: s.time,
        period: s.period,
        place: s.place,
        address: s.address,
        activity: s.activity,
        costVnd: scaled,
        mapsUrl: buildMapsUrl(s.place, s.address, city)
      };
    })
  }));

  return {
    title: `Lịch trình ${city} ${days} ngày (${style})`,
    summary: `Lịch trình ${days} ngày cho ${people} người di chuyển bằng ${transport}, xếp tuyến theo cụm gần nhau tối ưu chi phí trong khoảng ${budget.toLocaleString("vi-VN")}đ.`,
    totalEstimatedVnd: finalTotal || budget,
    tips: [
      "Đi theo cụm khu vực trong từng ngày giúp tiết kiệm xăng/Grab và tránh quay đầu đường.",
      "Ưu tiên tham quan biển, bán đảo Sơn Trà và Phố cổ vào sáng sớm (6h30–9h) hoặc sau 16h để mát và ảnh đẹp nhất.",
      "Mở thêm mục Săn Voucher trên Trang chủ trước khi ăn uống/đi workshop để giảm thêm chi phí."
    ],
    days: finalDays,
    meta: { city, days, budget, people, style, transport },
    _provider: "smart-local-engine"
  };
}

// ============================================================
// GỌI AI GROQ + OPENROUTER TỐC ĐỘ CAO
// ============================================================
async function callGroqPlanner(apiKeys, prompt, maxTokens) {
  let lastErr = null;
  for (const model of CONFIG.GROQ_MODELS) {
    for (const apiKey of apiKeys.slice(0, 4)) {
      try {
        const body = {
          model,
          temperature: 0.2,
          max_completion_tokens: maxTokens,
          messages: [
            { role: "system", content: "Bạn chỉ trả về đúng 1 JSON hợp lệ bằng tiếng Việt, chi tiết và chuẩn xác, không markdown." },
            { role: "user", content: prompt }
          ]
        };
        if (/qwen3\.8/i.test(model)) {
          body.reasoning_effort = "none";
        } else if (/gpt-oss/i.test(model)) {
          body.reasoning_effort = "low";
        }

        const res = await fetchWithTimeout(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
          },
          CONFIG.GROQ_TIMEOUT_MS
        );

        const text = await res.text();
        if (!res.ok) {
          if (res.status === 429) state.keyCooldown.set(apiKey, Date.now() + CONFIG.KEY_COOLDOWN_429_MS);
          lastErr = new Error(`Groq(${model}) HTTP ${res.status}`);
          if (res.status === 400 || res.status === 404) break;
          continue;
        }

        const parsed = JSON.parse(text);
        const msg = parsed.choices?.[0]?.message || {};
        const content = msg.content || msg.reasoning || "";
        if (!content) throw new Error("Empty content");
        const json = extractJson(content);
        if (!Array.isArray(json.days) || !json.days.length) throw new Error("Missing days");
        return { data: json, provider: `groq:${model.split("/").pop()}` };
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr || new Error("Groq planner failed");
}

async function callOpenRouterPlanner(apiKeys, prompt, maxTokens) {
  let lastErr = null;
  for (const model of CONFIG.OPENROUTER_MODELS) {
    for (const apiKey of apiKeys.slice(0, 3)) {
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
              temperature: 0.2,
              max_tokens: maxTokens,
              reasoning: { enabled: false },
              messages: [{ role: "user", content: prompt }]
            })
          },
          CONFIG.OPENROUTER_TIMEOUT_MS
        );
        const text = await res.text();
        if (!res.ok) {
          if (res.status === 429) state.keyCooldown.set(apiKey, Date.now() + CONFIG.KEY_COOLDOWN_429_MS);
          lastErr = new Error(`OpenRouter(${model}) HTTP ${res.status}`);
          continue;
        }
        const parsed = JSON.parse(text);
        const msg = parsed.choices?.[0]?.message || {};
        const content = msg.content || msg.reasoning || "";
        const json = extractJson(content);
        if (!Array.isArray(json.days) || !json.days.length) throw new Error("Missing days");
        return { data: json, provider: `openrouter:${model.split("/").pop()}` };
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr || new Error("OpenRouter planner failed");
}

function normalizePlan(raw, params) {
  const days = Array.isArray(raw?.days) ? raw.days : [];
  let computedTotal = 0;

  const cleanDays = days.slice(0, params.days).map((d, idx) => {
    const slots = (Array.isArray(d?.slots) ? d.slots : []).map((s) => {
      const cost = Math.max(0, Number(s?.costVnd) || 0);
      computedTotal += cost;
      const place = String(s?.place || "Điểm tham quan").trim();
      const address = String(s?.address || "").trim();
      return {
        time: String(s?.time || "").trim(),
        period: String(s?.period || "").trim(),
        place,
        address,
        activity: String(s?.activity || "").trim(),
        costVnd: cost,
        mapsUrl: buildMapsUrl(place, address, params.city)
      };
    });
    return {
      day: Number(d?.day) || idx + 1,
      theme: String(d?.theme || `Ngày ${idx + 1} khám phá ${params.city}`).trim(),
      slots
    };
  });

  // Nếu AI trả thiếu ngày so với yêu cầu -> bổ sung thêm ngày từ Smart Local Engine
  if (cleanDays.length < params.days) {
    const fallback = buildSmartLocalPlan(params);
    for (let i = cleanDays.length; i < params.days; i++) {
      cleanDays.push({ ...fallback.days[i], day: i + 1 });
    }
  }

  return {
    title: String(raw?.title || `Lịch trình ${params.city} ${params.days} ngày`).trim(),
    summary: String(raw?.summary || "").trim(),
    totalEstimatedVnd: Number(raw?.totalEstimatedVnd) || computedTotal || params.budget,
    tips: Array.isArray(raw?.tips) ? raw.tips.map((t) => String(t).trim()).filter(Boolean).slice(0, 4) : [],
    days: cleanDays,
    meta: {
      city: params.city,
      days: params.days,
      budget: params.budget,
      people: params.people,
      style: params.style,
      transport: params.transport
    }
  };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  let params = {
    city: "Đà Nẵng – Hội An",
    days: 2,
    budget: 1500000,
    people: 2,
    style: "Tự túc",
    transport: "Xe máy / Grab",
    interests: "Ăn uống đặc sản, chụp ảnh, biển"
  };

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    params = {
      city: String(body.city || "Đà Nẵng – Hội An").trim().slice(0, 60) || "Đà Nẵng – Hội An",
      days: Math.min(7, Math.max(1, parseInt(body.days, 10) || 2)),
      budget: Math.min(100000000, Math.max(100000, parseInt(body.budget, 10) || 1500000)),
      people: Math.min(30, Math.max(1, parseInt(body.people, 10) || 2)),
      style: String(body.style || "Tự túc").trim().slice(0, 40),
      transport: String(body.transport || "Xe máy / Grab").trim().slice(0, 40),
      interests: String(body.interests || "Ăn uống đặc sản, chụp ảnh, biển").trim().slice(0, 160)
    };
    const force = Boolean(body.force);

    const cacheKey = crypto
      .createHash("sha256")
      .update(JSON.stringify(params).toLowerCase())
      .digest("hex")
      .slice(0, 20);

    if (!force) {
      const cached = getCache(cacheKey);
      if (cached) {
        return res.status(200).json({ ...cached, _cached: true });
      }
    }

    const groqKeys = collectApiKeys("GROQ_API_KEY");
    const openRouterKeys = collectApiKeys("OPENROUTER_API_KEY");
    const maxTokens = Math.min(4096, 1200 + params.days * 550);

    const run = async () => {
      const prompt = buildPrompt(params);
      let out = null;

      if (groqKeys.length) {
        try {
          out = await callGroqPlanner(groqKeys, prompt, maxTokens);
        } catch (err) {
          console.error("[TravelPlanner Groq fallback]:", err.message);
        }
      }
      if (!out && openRouterKeys.length) {
        try {
          out = await callOpenRouterPlanner(openRouterKeys, prompt, maxTokens);
        } catch (err) {
          console.error("[TravelPlanner OpenRouter fallback]:", err.message);
        }
      }

      // Tầng 3: Smart Local Engine — bảo đảm 0% lỗi kể cả khi API quá tải hoặc thiếu key
      const plan = out ? normalizePlan(out.data, params) : buildSmartLocalPlan(params);
      plan._provider = out ? out.provider : "smart-local-engine";
      setCache(cacheKey, plan);
      return plan;
    };

    if (!force && state.inFlight.has(cacheKey)) {
      const shared = await state.inFlight.get(cacheKey);
      return res.status(200).json({ ...shared, _cached: true });
    }

    const p = run().finally(() => state.inFlight.delete(cacheKey));
    if (!force) state.inFlight.set(cacheKey, p);
    const plan = await p;
    return res.status(200).json(plan);
  } catch (err) {
    // Fallback cuối cùng: luôn trả về lịch trình chi tiết thay vì màn hình lỗi
    const fallbackPlan = buildSmartLocalPlan(params);
    return res.status(200).json(fallbackPlan);
  }
};
