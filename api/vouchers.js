/**
 * AIvolution - Auto Săn Voucher Đà Nẵng – Hội An Real-Time (Serper Search + Serper Google Maps)
 * - Tự động làm mới hàng ngày lúc 00:00 giờ Việt Nam (Vercel Cron + Auto-rollover theo ngày VN)
 * - Phủ đủ cả Hội An & Đà Nẵng với 7 nhóm lớn:
 *   Show & Vé (Ký Ức Hội An, Bà Nà Hills, VinWonders...), Nhà hàng, Quán ăn địa phương,
 *   Thức ăn nhanh (KFC, Jollibee, Lotteria, Dookki...), Workshop, Cà phê/Trà sữa, Shop & Minimart
 * - Chế độ "Săn deal bất kỳ shop nào trên Google Maps" (?shop=...) cào real-time thông tin Maps + ưu đãi
 * - Hỗ trợ xoay vòng 10 SERPER_API_KEY + Google News RSS fallback (0 key) + Cache chịu tải >100 người
 */

const crypto = require("crypto");

const UA = "Mozilla/5.0 (compatible; AIvolutionVoucherBot/3.0; +https://aitl-teal.vercel.app)";
const SERPER_TIMEOUT_MS = 4000;
const RSS_TIMEOUT_MS = 3200;
const SHOP_CACHE_TTL_MS = 30 * 60 * 1000;

const dailyCache = {
  dateKey: "",
  updatedAt: "",
  items: [],
  sourcesCount: 0,
  liveCount: 0,
  mapsCount: 0
};
const shopSearchCache = new Map();
let inFlightRefresh = null;

function getVietnamDateInfo(now = new Date()) {
  const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const year = vnTime.getUTCFullYear();
  const month = String(vnTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(vnTime.getUTCDate()).padStart(2, "0");
  const hours = String(vnTime.getUTCHours()).padStart(2, "0");
  const mins = String(vnTime.getUTCMinutes()).padStart(2, "0");
  const weekdayNames = ["Chủ Nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
  return {
    dateKey: `${year}-${month}-${day}`,
    displayDate: `${day}/${month}/${year}`,
    displayTime: `${hours}:${mins}`,
    monthYear: `${month}/${year}`,
    weekday: weekdayNames[vnTime.getUTCDay()]
  };
}

function collectSerperKeys() {
  const raw = [];
  if (process.env.SERPER_API_KEY) {
    raw.push(...String(process.env.SERPER_API_KEY).split(/[\s,;]+/));
  }
  for (let i = 1; i <= 10; i++) {
    const val = process.env[`SERPER_API_KEY_${i}`];
    if (val) raw.push(...String(val).split(/[\s,;]+/));
  }
  return [...new Set(raw.map((k) => k.trim()).filter(Boolean))];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDiscountBadge(text) {
  const s = String(text || "");
  const pct = s.match(/giảm\s*(?:đến|tới|ngay|lên\s*đến)?\s*(\d{1,2}\s*%)/i) || s.match(/(\d{1,2}\s*%)\s*(?:off|giảm)/i);
  if (pct) return `Giảm ${pct[1].replace(/\s+/g, "")}`;
  const vnd = s.match(/giảm\s*(?:đến|tới|ngay)?\s*(\d{1,3}(?:[.,]\d{3})+|\d{2,3}\s*k)/i);
  if (vnd) return `Giảm ${vnd[1].toUpperCase()}`;
  if (/mua\s*1\s*tặng\s*1|buy\s*1\s*get\s*1|1\s*tặng\s*1/i.test(s)) return "Mua 1 tặng 1";
  if (/combo|trọn gói|set\s*menu/i.test(s)) return "Ưu đãi Combo";
  if (/vé|ticket|show|ký ức|bà nà|vinwonders/i.test(s)) return "Ưu đãi Vé";
  if (/voucher|mã giảm|khuyến mãi|deal|ưu đãi|flash sale|giờ vàng/i.test(s)) return "Ưu đãi hôm nay";
  return "Deal mới nhất";
}

function extractPromoCode(text) {
  const s = String(text || "");
  const m = s.match(/(?:mã|code|voucher)\s*[:：]?\s*([A-Z0-9]{4,14})\b/);
  if (m && !/^(HTTP|HTTPS|HTML|FREE|SALE|DEAL|CODE|HOIAN|DANANG)$/i.test(m[1])) {
    return m[1];
  }
  return "";
}

function getDomainName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "Nguồn xác thực";
  }
}

function makeItemId(url, title) {
  return crypto.createHash("sha256").update(`${url}|${title}`).digest("hex").slice(0, 12);
}

function detectCity(text, fallbackCity = "hoian") {
  const s = String(text || "").toLowerCase();
  const hasHa = /hội an|hoi an|cẩm thanh|trà quế|thanh hà|an bàng|sông hoài|ký ức hội an/.test(s);
  const hasDn = /đà nẵng|da nang|mỹ khê|sơn trà|bà nà|hải châu|ngũ hành sơn|cầu rồng|sông hàn/.test(s);
  if (hasHa && hasDn) return "both";
  if (hasDn) return "danang";
  if (hasHa) return "hoian";
  return fallbackCity;
}

// 1. Quét Serper Google Search (Live Real-time Deals)
async function querySerperSearch(apiKey, query, category, defaultCity, vnDate, num = 6) {
  try {
    const res = await fetchWithTimeout(
      "https://google.serper.dev/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({ q: query, gl: "vn", hl: "vi", num, tbs: "qdr:m" })
      },
      SERPER_TIMEOUT_MS
    );
    if (!res.ok) return [];
    const data = await res.json();
    const organic = Array.isArray(data?.organic) ? data.organic : [];
    return organic
      .filter((r) => r && r.title && r.link && /^https?:\/\//i.test(r.link))
      .map((r) => {
        const title = stripHtml(r.title);
        const snippet = stripHtml(r.snippet || "");
        const combined = `${title} ${snippet}`;
        const city = detectCity(combined, defaultCity);
        const domain = getDomainName(r.link);
        const areaText = city === "danang" ? "Đà Nẵng" : city === "hoian" ? "Hội An" : "Đà Nẵng – Hội An";
        return {
          id: makeItemId(r.link, title),
          city,
          category,
          title,
          merchant: domain,
          discount: extractDiscountBadge(combined),
          code: extractPromoCode(combined),
          description: snippet || `Ưu đãi tổng hợp trực tiếp từ ${domain} tại ${areaText}.`,
          address: areaText,
          rating: null,
          sourceUrl: r.link,
          sourceName: domain,
          mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title.slice(0, 50) + " " + areaText)}`,
          verifiedLive: true,
          validLabel: `Cập nhật ${vnDate.displayDate}`
        };
      });
  } catch (_) {
    return [];
  }
}

// 2. Quét Serper Google Maps (/maps) để lấy trực tiếp các shop thật có trên Google Maps
async function querySerperMaps(apiKey, query, category, defaultCity, vnDate) {
  try {
    const res = await fetchWithTimeout(
      "https://google.serper.dev/maps",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({ q: query, gl: "vn", hl: "vi" })
      },
      SERPER_TIMEOUT_MS
    );
    if (!res.ok) return [];
    const data = await res.json();
    const places = Array.isArray(data?.places) ? data.places : [];
    return places.slice(0, 8).map((p) => {
      const name = stripHtml(p.title || "");
      const addr = stripHtml(p.address || "");
      const city = detectCity(`${name} ${addr}`, defaultCity);
      const mapsUrl = p.cid
        ? `https://www.google.com/maps?cid=${encodeURIComponent(p.cid)}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${addr}`)}`;
      const dealSearchUrl = p.website && /^https?:\/\//i.test(p.website)
        ? p.website
        : `https://www.google.com/search?q=${encodeURIComponent(`"${name}" ${city === "danang" ? "Đà Nẵng" : "Hội An"} voucher khuyến mãi`)}`;
      const ratingStr = p.rating ? `★ ${p.rating}${p.ratingCount ? ` (${p.ratingCount})` : ""}` : "";
      return {
        id: makeItemId(mapsUrl, name),
        city,
        category,
        title: name,
        merchant: p.category || "Google Maps",
        discount: ratingStr ? `Maps ${ratingStr}` : "Shop Google Maps",
        code: "",
        description: `${addr || (city === "danang" ? "Đà Nẵng" : "Hội An")}${p.phoneNumber ? ` • ĐT: ${p.phoneNumber}` : ""}`,
        address: addr || (city === "danang" ? "Đà Nẵng" : "Hội An"),
        rating: p.rating || null,
        sourceUrl: dealSearchUrl,
        sourceName: p.website ? getDomainName(p.website) : "Google Maps",
        mapsUrl,
        verifiedLive: true,
        isGoogleMapsPlace: true,
        validLabel: `Maps live • ${vnDate.displayDate}`
      };
    });
  } catch (_) {
    return [];
  }
}

// 3. Fallback miễn phí 0 API Key qua Google News RSS
async function queryGoogleNewsRss(query, category, defaultCity, vnDate) {
  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=vi&gl=VN&ceid=VN:vi`;
    const res = await fetchWithTimeout(rssUrl, { headers: { "User-Agent": UA } }, RSS_TIMEOUT_MS);
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 4) {
      const block = match[1];
      const title = stripHtml((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
      const link = stripHtml((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "");
      const sourceName = stripHtml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1] || "Google News");
      if (!title || !/^https?:\/\//i.test(link)) continue;
      const city = detectCity(title, defaultCity);
      const areaText = city === "danang" ? "Đà Nẵng" : city === "hoian" ? "Hội An" : "Đà Nẵng – Hội An";
      items.push({
        id: makeItemId(link, title),
        city,
        category,
        title,
        merchant: sourceName,
        discount: extractDiscountBadge(title),
        code: extractPromoCode(title),
        description: `Tin ưu đãi xác thực từ ${sourceName} (${vnDate.displayDate}).`,
        address: areaText,
        rating: null,
        sourceUrl: link,
        sourceName,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title.slice(0, 50) + " " + areaText)}`,
        verifiedLive: true,
        validLabel: `Làm mới ${vnDate.displayDate}`
      });
    }
    return items;
  } catch (_) {
    return [];
  }
}

// 4. Danh mục kênh săn deal chính thức phủ đủ Hội An & Đà Nẵng (kể cả Ký Ức Hội An, Fast Food, Show, Minimart)
function buildOfficialDnHaChannels(vnDate) {
  const lbl = `Kênh chính thức • ${vnDate.displayDate}`;
  return [
    // SHOW & VÉ THAM QUAN (HỘI AN & ĐÀ NẴNG)
    {
      id: "ha-show-kyuc",
      city: "hoian",
      category: "show",
      title: "Voucher Vé Show Ký Ức Hội An (Hoi An Memories Land)",
      merchant: "Ký Ức Hội An / Klook",
      discount: "Ưu đãi Vé Show",
      code: "",
      description: "Kiểm tra giá vé ưu đãi & combo Công viên Ấn Tượng Hội An + Show thực cảnh Ký Ức Hội An cập nhật theo ngày.",
      address: "Cồn Hến (200 Nguyễn Tri Phương rẽ trái), Cẩm Nam, Hội An",
      sourceUrl: "https://www.klook.com/vi/search/result/?query=K%C3%BD%20%E1%BB%A8c%20H%E1%BB%99i%20An",
      sourceName: "klook.com",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=K%C3%BD+%E1%BB%A8c+H%E1%BB%99i+An+Hoi+An+Memories+Land",
      verifiedLive: false,
      validLabel: lbl
    },
    {
      id: "dn-show-bana",
      city: "danang",
      category: "show",
      title: "Voucher Vé Cáp Treo Sun World Bà Nà Hills & Combo Buffet",
      merchant: "Sun World / Klook",
      discount: "Combo Vé + Buffet",
      code: "",
      description: "Săn ưu đãi vé cáp treo Bà Nà Hills, Cầu Vàng và combo buffet trưa trực tiếp theo ngày.",
      address: "Hòa Ninh, Hòa Vang, Đà Nẵng",
      sourceUrl: "https://www.klook.com/vi/search/result/?query=B%C3%A0%20N%C3%A0%20Hills",
      sourceName: "klook.com",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Sun+World+Ba+Na+Hills+Da+Nang",
      verifiedLive: false,
      validLabel: lbl
    },
    {
      id: "ha-show-vinwonders",
      city: "hoian",
      category: "show",
      title: "Voucher Vé VinWonders Nam Hội An & River Safari",
      merchant: "VinWonders / Traveloka",
      discount: "Ưu đãi Vé",
      code: "",
      description: "Tra cứu voucher vé vào cổng VinWonders Nam Hội An, công viên nước và Safari trên sông theo ngày.",
      address: "Đường Võ Chí Công, Bình Minh, Thăng Bình (gần Hội An)",
      sourceUrl: "https://www.traveloka.com/vi-vn/activities/search?st=VinWonders%20Nam%20H%E1%BB%99i%20An",
      sourceName: "traveloka.com",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=VinWonders+Nam+Hoi+An",
      verifiedLive: false,
      validLabel: lbl
    },
    // THỨC ĂN NHANH (FAST FOOD ĐÀ NẴNG – HỘI AN)
    {
      id: "dnha-ff-kfc",
      city: "both",
      category: "fastfood",
      title: "Khuyến Mãi Hôm Nay — KFC Đà Nẵng & Hội An",
      merchant: "KFC Việt Nam",
      discount: "Combo & Mua 1 tặng 1",
      code: "",
      description: "Xem trực tiếp danh mục combo gà rán, ưu đãi thứ 3/thứ 4 và voucher online chính hãng của KFC.",
      address: "Các chi nhánh KFC Đà Nẵng & Hội An",
      sourceUrl: "https://kfcvietnam.com.vn/menu/hot-deal",
      sourceName: "kfcvietnam.com.vn",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=KFC+%C4%90%C3%A0+N%E1%BA%B5ng+H%E1%BB%99i+An",
      verifiedLive: false,
      validLabel: lbl
    },
    {
      id: "dnha-ff-jollibee",
      city: "both",
      category: "fastfood",
      title: "Ưu Đãi Combo Gà Giòn & Mì Ý — Jollibee Đà Nẵng – Hội An",
      merchant: "Jollibee Việt Nam",
      discount: "Ưu đãi Combo",
      code: "",
      description: "Tổng hợp khuyến mãi combo nhóm, học sinh sinh viên và mã giảm giá mới nhất từ Jollibee.",
      address: "Các cửa hàng Jollibee Đà Nẵng & Hội An",
      sourceUrl: "https://jollibee.com.vn/khuyen-mai",
      sourceName: "jollibee.com.vn",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Jollibee+%C4%90%C3%A0+N%E1%BA%B5ng",
      verifiedLive: false,
      validLabel: lbl
    },
    {
      id: "dn-ff-lotteria",
      city: "danang",
      category: "fastfood",
      title: "Deal Khuyến Mãi Ngày — Lotteria & Dookki Đà Nẵng",
      merchant: "Lotteria Việt Nam",
      discount: "Khuyến mãi ngày",
      code: "",
      description: "Kiểm tra trực tiếp các chương trình giảm giá gà rán, burger và combo ưu đãi tại Lotteria Đà Nẵng.",
      address: "Các chi nhánh Lotteria Đà Nẵng",
      sourceUrl: "https://www.lotteria.vn/khuyen-mai",
      sourceName: "lotteria.vn",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Lotteria+%C4%90%C3%A0+N%E1%BA%B5ng",
      verifiedLive: false,
      validLabel: lbl
    },
    // QUÁN ĂN ĐỊA PHƯƠNG & NHÀ HÀNG (HỘI AN & ĐÀ NẴNG)
    {
      id: "ha-local-grab",
      city: "hoian",
      category: "food",
      title: "Deal Quán Ăn Địa Phương Hội An (Cao Lầu, Cơm Gà, Bánh Mì)",
      merchant: "GrabFood Hội An",
      discount: "Voucher mỗi ngày",
      code: "",
      description: "Săn mã giảm giá trực tiếp theo khung giờ trưa & tối cho quán ăn địa phương tại Hội An.",
      address: "Trung tâm TP. Hội An",
      sourceUrl: "https://food.grab.com/vn/vi/restaurants?search=H%E1%BB%99i%20An",
      sourceName: "food.grab.com",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Qu%C3%A1n+%C4%83n+%C4%91%E1%BB%8Ba+ph%C6%B0%C6%A1ng+H%E1%BB%99i+An",
      verifiedLive: false,
      validLabel: lbl
    },
    {
      id: "dn-local-grab",
      city: "danang",
      category: "food",
      title: "Deal Quán Ăn Địa Phương Đà Nẵng (Mì Quảng, Bún Chả Cá, Bánh Tráng)",
      merchant: "GrabFood Đà Nẵng",
      discount: "Voucher mỗi ngày",
      code: "",
      description: "Tổng hợp voucher đặt món & ăn tại chỗ đang mở tại các quán đặc sản Đà Nẵng.",
      address: "TP. Đà Nẵng",
      sourceUrl: "https://food.grab.com/vn/vi/restaurants?search=%C4%90%C3%A0%20N%E1%BA%B5ng",
      sourceName: "food.grab.com",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Qu%C3%A1n+%C4%83n+%C4%91%E1%BA%B7c+s%E1%BA%A3n+%C4%90%C3%A0+N%E1%BA%B5ng",
      verifiedLive: false,
      validLabel: lbl
    },
    {
      id: "dnha-rest-klook",
      city: "both",
      category: "restaurant",
      title: "Voucher Nhà Hàng Hải Sản & Buffet Đà Nẵng – Hội An",
      merchant: "Klook Ẩm Thực",
      discount: "Deal đặt bàn",
      code: "",
      description: "Săn voucher giảm giá đặt bàn trước tại nhà hàng hải sản Mỹ Khê, sông Hàn và ven sông Hoài.",
      address: "Đà Nẵng & Hội An",
      sourceUrl: "https://www.klook.com/vi/search/result/?query=nh%C3%A0%20h%C3%A0ng%20%C4%90%C3%A0%20N%E1%BA%B5ng%20H%E1%BB%99i%20An",
      sourceName: "klook.com",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Nh%C3%A0+h%C3%A0ng+h%E1%BA%A3i+s%E1%BA%A3n+%C4%90%C3%A0+N%E1%BA%B5ng+H%E1%BB%99i+An",
      verifiedLive: false,
      validLabel: lbl
    },
    // WORKSHOP HỘI AN & ĐÀ NẴNG
    {
      id: "ha-ws-lantern",
      city: "hoian",
      category: "workshop",
      title: "Workshop Làm Đèn Lồng, Gốm Thanh Hà & Nấu Ăn Trà Quế Hội An",
      merchant: "Klook / Traveloka",
      discount: "Ưu đãi Workshop",
      code: "",
      description: "Kiểm tra voucher giảm giá đặt online trong ngày cho các lớp làm đèn lồng, làm gốm, nấu ăn tại Hội An.",
      address: "Phố cổ, Cẩm Thanh & Trà Quế, Hội An",
      sourceUrl: "https://www.klook.com/vi/search/result/?query=workshop%20H%E1%BB%99i%20An",
      sourceName: "klook.com",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Workshop+H%E1%BB%99i+An",
      verifiedLive: false,
      validLabel: lbl
    },
    // CÀ PHÊ & TRÀ SỮA
    {
      id: "dnha-cafe-highlands",
      city: "both",
      category: "cafe",
      title: "Voucher Cà Phê & Trà — Highlands Coffee Đà Nẵng – Hội An",
      merchant: "Highlands Coffee",
      discount: "Voucher chính hãng",
      code: "",
      description: "Ưu đãi mua theo combo / giảm giá thức uống chính thức áp dụng tại chi nhánh Đà Nẵng & Hội An.",
      address: "Đà Nẵng & Hội An",
      sourceUrl: "https://www.highlandscoffee.com.vn/vn/tin-tuc.html",
      sourceName: "highlandscoffee.com.vn",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=Highlands+Coffee+%C4%90%C3%A0+N%E1%BA%B5ng+H%E1%BB%99i+An",
      verifiedLive: false,
      validLabel: lbl
    },
    // SHOP, SIÊU THỊ & MINIMART
    {
      id: "dnha-shop-bhx",
      city: "both",
      category: "minimart",
      title: "Khuyến Mãi Hôm Nay — Bách Hóa Xanh Đà Nẵng & Hội An",
      merchant: "Bách Hóa Xanh",
      discount: "Giảm giá ngày",
      code: "",
      description: "Tra cứu thực phẩm, đồ uống và hàng tiêu dùng giảm giá trong ngày tại hệ thống Bách Hóa Xanh.",
      address: "Các chi nhánh Đà Nẵng & Hội An",
      sourceUrl: "https://www.bachhoaxanh.com/khuyen-mai",
      sourceName: "bachhoaxanh.com",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=B%C3%A1ch+H%C3%B3a+Xanh+%C4%90%C3%A0+N%E1%BA%B5ng+H%E1%BB%99i+An",
      verifiedLive: false,
      validLabel: lbl
    },
    {
      id: "dnha-shop-winmart",
      city: "both",
      category: "minimart",
      title: "Giá Sốc Ngày & Hội Viên WiN — WinMart / WinMart+ Đà Nẵng – Hội An",
      merchant: "WinMart",
      discount: "Ưu đãi Hội viên",
      code: "",
      description: "Xem khuyến mãi hàng ngày và ưu đãi hội viên WiN tại hệ thống WinMart & WinMart+ toàn khu vực.",
      address: "Đà Nẵng & Hội An",
      sourceUrl: "https://winmart.vn/khuyen-mai",
      sourceName: "winmart.vn",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=WinMart+%C4%90%C3%A0+N%E1%BA%B5ng+H%E1%BB%99i+An",
      verifiedLive: false,
      validLabel: lbl
    },
    {
      id: "dn-shop-go",
      city: "danang",
      category: "minimart",
      title: "Cẩm Nang Khuyến Mãi — GO! (Big C) & Lotte Mart Đà Nẵng",
      merchant: "GO! Đà Nẵng",
      discount: "Siêu thị giảm sốc",
      code: "",
      description: "Cập nhật chương trình khuyến mãi siêu thị, đồ ăn nhanh và mua sắm theo ngày tại GO! Đà Nẵng.",
      address: "255-257 Hùng Vương, Thanh Khê, Đà Nẵng",
      sourceUrl: "https://go-vietnam.vn/khuyen-mai",
      sourceName: "go-vietnam.vn",
      mapsUrl: "https://www.google.com/maps/search/?api=1&query=GO+Da+Nang+Hung+Vuong",
      verifiedLive: false,
      validLabel: lbl
    }
  ];
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.sourceUrl}|${item.title.toLowerCase().slice(0, 45)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// Săn deal REAL-TIME cho BẤT KỲ shop/quán nào trên Google Maps Đà Nẵng – Hội An
async function searchSpecificShopRealtime(shopName, cityFilter, vnDate) {
  const areaLabel = cityFilter === "danang" ? "Đà Nẵng" : cityFilter === "hoian" ? "Hội An" : "Đà Nẵng Hội An";
  const cacheKey = `${shopName.toLowerCase()}|${cityFilter}|${vnDate.dateKey}`;
  const cached = shopSearchCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return cached.val;

  const serperKeys = collectSerperKeys();
  let items = [];
  let mapsCount = 0;

  if (serperKeys.length > 0) {
    const k1 = serperKeys[0];
    const k2 = serperKeys[1 % serperKeys.length];
    const [mapsPlaces, dealResults] = await Promise.all([
      querySerperMaps(k1, `${shopName} ${areaLabel}`, "food", cityFilter === "all" ? "both" : cityFilter, vnDate),
      querySerperSearch(
        k2,
        `"${shopName}" (${areaLabel}) (voucher OR "giảm giá" OR "khuyến mãi" OR combo OR "ưu đãi" OR "mã giảm")`,
        "food",
        cityFilter === "all" ? "both" : cityFilter,
        vnDate,
        8
      )
    ]);
    mapsCount = mapsPlaces.length;
    items = dedupeItems([...dealResults, ...mapsPlaces]);
  } else {
    items = await queryGoogleNewsRss(`${shopName} ${areaLabel} khuyến mãi voucher`, "food", "both", vnDate);
  }

  // Luôn kèm 1 thẻ tra cứu trực tiếp Google Maps + Google Deal cho đúng tên shop người dùng nhập
  const directCard = {
    id: makeItemId("direct", `${shopName}|${areaLabel}`),
    city: cityFilter === "all" ? "both" : cityFilter,
    category: "food",
    title: `Tra cứu ưu đãi & Google Maps: ${shopName}`,
    merchant: "Tìm kiếm trực tiếp",
    discount: "Real-time",
    code: "",
    description: `Mở trực tiếp kết quả khuyến mãi mới nhất và vị trí Google Maps cho "${shopName}" tại ${areaLabel}.`,
    address: areaLabel,
    rating: null,
    sourceUrl: `https://www.google.com/search?q=${encodeURIComponent(`"${shopName}" ${areaLabel} voucher khuyến mãi`)}`,
    sourceName: "google.com",
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shopName} ${areaLabel}`)}`,
    verifiedLive: true,
    validLabel: `Tìm lúc ${vnDate.displayTime}`
  };

  const finalItems = items.length ? items : [directCard];
  const result = {
    dateKey: vnDate.dateKey,
    updatedAt: `${vnDate.displayTime} • ${vnDate.weekday}, ${vnDate.displayDate}`,
    renewSchedule: "Kết quả cào real-time theo tên shop Google Maps",
    total: finalItems.length,
    liveCount: items.length,
    mapsCount,
    shopQuery: shopName,
    items: finalItems
  };

  if (shopSearchCache.size >= 300) {
    const oldest = shopSearchCache.keys().next().value;
    if (oldest !== undefined) shopSearchCache.delete(oldest);
  }
  shopSearchCache.set(cacheKey, { val: result, exp: Date.now() + SHOP_CACHE_TTL_MS });
  return result;
}

async function refreshDailyVouchers(force = false) {
  const vnDate = getVietnamDateInfo();
  if (!force && dailyCache.dateKey === vnDate.dateKey && dailyCache.items.length > 0) {
    return dailyCache;
  }
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    const serperKeys = collectSerperKeys();
    const searchQueries = [
      // Show & Vé (Ký Ức Hội An, Bà Nà Hills, VinWonders...)
      { city: "hoian", category: "show", q: `("Ký Ức Hội An" OR "Hoi An Memories" OR "VinWonders Nam Hội An") (voucher OR "giảm giá" OR "ưu đãi" OR vé) ${vnDate.monthYear}` },
      { city: "danang", category: "show", q: `("Bà Nà Hills" OR "Núi Thần Tài" OR "Đà Nẵng") (voucher OR "giảm giá" OR combo) vé ${vnDate.monthYear}` },
      // Nhà hàng & Quán ăn địa phương (Hội An + Đà Nẵng)
      { city: "hoian", category: "food", q: `"Hội An" (voucher OR "giảm giá" OR "khuyến mãi") ("quán ăn" OR "cao lầu" OR "cơm gà" OR "bánh mì" OR "đặc sản") ${vnDate.monthYear}` },
      { city: "danang", category: "food", q: `"Đà Nẵng" (voucher OR "giảm giá" OR "khuyến mãi") ("quán ăn" OR "mì quảng" OR "hải sản" OR "đặc sản") ${vnDate.monthYear}` },
      { city: "both", category: "restaurant", q: `("Hội An" OR "Đà Nẵng") (voucher OR "ưu đãi" OR combo) ("nhà hàng" OR buffet OR "lẩu nướng") ${vnDate.monthYear}` },
      // Thức ăn nhanh (Fast food)
      { city: "both", category: "fastfood", q: `("Đà Nẵng" OR "Hội An") ("KFC" OR "Jollibee" OR "Lotteria" OR "Dookki" OR "Pizza" OR "McDonald") ("khuyến mãi" OR voucher OR combo) ${vnDate.monthYear}` },
      // Workshop & Cà phê & Shop/Minimart
      { city: "hoian", category: "workshop", q: `"Hội An" (voucher OR "ưu đãi" OR "giảm giá") (workshop OR "làm đèn lồng" OR "làm gốm" OR "nấu ăn") ${vnDate.monthYear}` },
      { city: "both", category: "cafe", q: `("Đà Nẵng" OR "Hội An") (voucher OR "mua 1 tặng 1" OR "giảm giá") ("Highlands" OR "Phúc Long" OR "Katinat" OR "Mixue" OR "cà phê") ${vnDate.monthYear}` },
      { city: "both", category: "minimart", q: `("Đà Nẵng" OR "Hội An") ("khuyến mãi" OR "giảm giá" OR voucher) ("Bách Hóa Xanh" OR "WinMart" OR "GO!" OR "Lotte Mart" OR minimart OR shop) ${vnDate.monthYear}` }
    ];

    let liveItems = [];
    let mapsCount = 0;

    if (serperKeys.length > 0) {
      const searchJobs = searchQueries.map((item, idx) =>
        querySerperSearch(serperKeys[idx % serperKeys.length], item.q, item.category, item.city, vnDate, 5)
      );
      // Cào thêm top shop thật trên Google Maps tại Hội An & Đà Nẵng
      const mapJobs = [
        querySerperMaps(serperKeys[0], "nhà hàng quán ăn ngon Hội An", "restaurant", "hoian", vnDate),
        querySerperMaps(serperKeys[1 % serperKeys.length], "nhà hàng quán ăn ngon Đà Nẵng", "restaurant", "danang", vnDate),
        querySerperMaps(serperKeys[2 % serperKeys.length], "workshop làm đèn lồng gốm nấu ăn Hội An", "workshop", "hoian", vnDate)
      ];
      const [searchRes, mapRes] = await Promise.all([Promise.all(searchJobs), Promise.all(mapJobs)]);
      const flatMaps = mapRes.flat();
      mapsCount = flatMaps.length;
      liveItems = [...searchRes.flat(), ...flatMaps];
    } else {
      const rssQueries = [
        { city: "hoian", category: "show", q: "Ký Ức Hội An ưu đãi vé khuyến mãi" },
        { city: "both", category: "food", q: "Đà Nẵng Hội An khuyến mãi quán ăn nhà hàng" },
        { city: "both", category: "fastfood", q: "KFC Jollibee Lotteria khuyến mãi hôm nay" },
        { city: "both", category: "minimart", q: "Bách Hóa Xanh WinMart GO khuyến mãi hôm nay" }
      ];
      const rssResults = await Promise.all(
        rssQueries.map((item) => queryGoogleNewsRss(item.q, item.category, item.city, vnDate))
      );
      liveItems = rssResults.flat();
    }

    const officialChannels = buildOfficialDnHaChannels(vnDate);
    const merged = dedupeItems([...liveItems, ...officialChannels]);

    dailyCache.dateKey = vnDate.dateKey;
    dailyCache.updatedAt = `${vnDate.displayTime} • ${vnDate.weekday}, ${vnDate.displayDate}`;
    dailyCache.items = merged;
    dailyCache.liveCount = liveItems.length;
    dailyCache.mapsCount = mapsCount;
    dailyCache.sourcesCount = new Set(merged.map((i) => i.sourceName)).size;
    return dailyCache;
  })().finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const queryObj = req.query || {};
    const isCron = queryObj.cron === "1" || queryObj.cron === "true";
    const force = isCron || queryObj.refresh === "1" || queryObj.refresh === "true";
    const city = String(queryObj.city || "all").toLowerCase();
    const category = String(queryObj.category || "all").toLowerCase();
    const search = String(queryObj.q || "").trim().toLowerCase();
    const shopQuery = String(queryObj.shop || "").trim().slice(0, 80);

    // Chế độ săn deal REAL-TIME cho bất kỳ tên shop nào trên Google Maps
    if (shopQuery) {
      const vnDate = getVietnamDateInfo();
      const shopResult = await searchSpecificShopRealtime(shopQuery, city, vnDate);
      res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");
      return res.status(200).json(shopResult);
    }

    const data = await refreshDailyVouchers(force);

    let filtered = data.items;
    if (city && city !== "all") {
      filtered = filtered.filter((item) => item.city === city || item.city === "both");
    }
    if (category && category !== "all") {
      filtered = filtered.filter((item) => item.category === category);
    }
    if (search) {
      filtered = filtered.filter((item) =>
        `${item.title} ${item.merchant} ${item.description} ${item.discount} ${item.code} ${item.address}`
          .toLowerCase()
          .includes(search)
      );
    }

    if (!force) {
      res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    } else {
      res.setHeader("Cache-Control", "no-store");
    }

    return res.status(200).json({
      dateKey: data.dateKey,
      updatedAt: data.updatedAt,
      renewSchedule: "Tự động làm mới 00:00 mỗi ngày (giờ VN)",
      total: filtered.length,
      liveCount: data.liveCount,
      mapsCount: data.mapsCount,
      sourcesCount: data.sourcesCount,
      items: filtered
    });
  } catch (err) {
    return res.status(500).json({
      error: "Không thể tải danh sách voucher lúc này, bạn thử lại nhé.",
      debug: err?.message || "Voucher fetch error"
    });
  }
};
