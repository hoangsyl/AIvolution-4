// AIvolution Module: Lịch sử quét & Bảng điều khiển Trang chủ
// ==========================================
// 2. LỊCH SỬ KHÔNG GIỚI HẠN (> 9.999 LƯỢT) & THỐNG KÊ
// ==========================================
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function getTotalScans() {
  const historyLen = loadHistory().length;
  try {
    const saved = Number(localStorage.getItem(TOTAL_SCANS_KEY) || "0");
    return Math.max(Number.isFinite(saved) ? saved : 0, historyLen);
  } catch (_) {
    return historyLen;
  }
}

function setTotalScans(count) {
  try {
    localStorage.setItem(TOTAL_SCANS_KEY, String(Math.max(0, Math.floor(count))));
  } catch (_) {}
}

function saveHistoryList(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (_) {
    const slim = list.map((item, idx) => (idx >= 20 ? { ...item, thumb: "" } : item));
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(slim));
    } catch (_) {
      const ultraSlim = list.slice(0, 500).map((item, idx) => (idx >= 5 ? { ...item, thumb: "" } : item));
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(ultraSlim));
      } catch (_) {}
    }
  }
  updateHistoryBadge();
}

function addToHistory(data, thumbDataUrl) {
  const nextTotal = getTotalScans() + 1;
  setTotalScans(nextTotal);

  const list = loadHistory();
  list.unshift({
    id: Date.now(),
    time: new Date().toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit"
    }),
    thumb: thumbDataUrl || "",
    data
  });
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  saveHistoryList(list);
}

function updateHistoryBadge() {
  const count = getTotalScans();
  if (count > 0) {
    historyBadge.textContent = count > 9999 ? "9999+" : String(count);
    historyBadge.hidden = false;
  } else {
    historyBadge.hidden = true;
  }
}

function parseCalories(str) {
  if (!str) return 0;
  const text = String(str).toLowerCase();
  if (/không áp dụng|chưa xác định|chưa đủ dữ liệu|n\/a/.test(text)) return 0;
  const nums = text.match(/\d+/g);
  if (!nums) return 0;
  if (nums.length >= 2) {
    return Math.round((Number(nums[0]) + Number(nums[1])) / 2);
  }
  return Number(nums[0]) || 0;
}

function renderHomeDashboard() {
  const list = loadHistory();
  const totalScans = getTotalScans();
  let totalCalories = 0;
  let placesCount = 0;
  let foodCount = 0;
  let productCount = 0;

  list.forEach((item) => {
    const d = item.data || {};
    const type = String(d.loai_doi_tuong || "").toLowerCase();
    const kcal = parseCalories(d.thong_tin_san_pham?.calo_uoc_tinh);
    totalCalories += kcal;

    if (d.la_dia_diem || /di tích|nhà hàng|quán ăn|workshop|shop|hán nôm|trường học|tổ chức|thương hiệu/.test(type)) {
      placesCount++;
    } else if (/thức ăn|đồ uống|món ăn|nước uống|thực phẩm|bánh|trái cây/.test(type) || kcal > 0) {
      foodCount++;
    } else {
      productCount++;
    }
  });

  document.getElementById("totalScansVal").textContent = totalScans.toLocaleString("vi-VN");
  document.getElementById("totalScansSub").textContent =
    totalCalories > 0
      ? `Không giới hạn • ${totalCalories.toLocaleString("vi-VN")} kcal`
      : `Không giới hạn • Đã lưu ${list.length.toLocaleString("vi-VN")} mục`;

  const circumference = 226.2;
  const milestone = totalScans <= 10 ? 10 : totalScans <= 100 ? 100 : totalScans <= 1000 ? 1000 : 10000;
  const ratio = totalScans === 0 ? 0.08 : Math.min(1, Math.max(0.12, (totalScans % milestone || milestone) / milestone));
  const offset = circumference * (1 - ratio);
  document.getElementById("heroRingProgress").setAttribute("stroke-dashoffset", offset.toFixed(1));

  const maxCat = Math.max(1, placesCount, foodCount, productCount);
  document.getElementById("statPlaces").textContent = `${placesCount} mục`;
  document.getElementById("statFood").textContent = `${foodCount} mục`;
  document.getElementById("statProducts").textContent = `${productCount} mục`;

  document.getElementById("barPlaces").style.transform = `scaleX(${Math.max(0.12, placesCount / maxCat)})`;
  document.getElementById("barFood").style.transform = `scaleX(${Math.max(0.12, foodCount / maxCat)})`;
  document.getElementById("barProducts").style.transform = `scaleX(${Math.max(0.12, productCount / maxCat)})`;

  const clearBtn = document.getElementById("btnClearHistory");
  if (clearBtn) clearBtn.hidden = list.length === 0 && totalScans === 0;

  const container = document.getElementById("homeHistoryContainer");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `
      <div class="empty-card">
        <p>Chưa có mục nào được quét. Hãy mở máy quét để nhận diện món ăn, logo trường học, địa điểm hoặc sản phẩm quanh bạn.</p>
        <button type="button" class="btn-pill btn-primary" id="emptyScanBtn">Mở AI Scanner</button>
      </div>
    `;
    document.getElementById("emptyScanBtn").addEventListener("click", () => navigateTo("scanner"));
    return;
  }

  const visibleList = list.slice(0, 100);

  container.innerHTML = `
    <ul class="history-list">
      ${visibleList
        .map((item) => {
          const kcal = parseCalories(item.data?.thong_tin_san_pham?.calo_uoc_tinh);
          const subText = kcal > 0
            ? `${kcal} kcal • ${item.time}`
            : `${escapeHtml(item.data?.loai_doi_tuong || "Nhận diện")} • ${item.time}`;

          return `
            <li class="history-card">
              <button type="button" class="history-open-btn" data-open-id="${item.id}">
                ${
                  item.thumb
                    ? `<img class="history-thumb" src="${item.thumb}" alt="" />`
                    : `<span class="history-thumb" aria-hidden="true">AI</span>`
                }
                <span class="history-meta">
                  <span class="history-name">${escapeHtml(item.data?.ten_dia_diem || "Kết quả nhận diện")}</span>
                  <span class="history-sub tabular-nums">${subText}</span>
                </span>
              </button>
              <button type="button" class="history-del-btn" data-del-id="${item.id}" aria-label="Xóa ${escapeHtml(item.data?.ten_dia_diem || "mục này")}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </li>
          `;
        })
        .join("")}
    </ul>
  `;

  container.querySelectorAll("[data-open-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.openId);
      const item = loadHistory().find((x) => x.id === id);
      if (item) renderDetailView(item.data, item.time, item.thumb, true);
    });
  });

  container.querySelectorAll("[data-del-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.delId);
      const next = loadHistory().filter((x) => x.id !== id);
      saveHistoryList(next);
      renderHomeDashboard();
    });
  });
}

function updateLastThumbPreview() {
  const list = loadHistory();
  const img = document.getElementById("lastThumbImg");
  const icon = document.getElementById("lastThumbIcon");
  if (list.length && list[0].thumb) {
    img.src = list[0].thumb;
    img.hidden = false;
    icon.hidden = true;
  } else {
    img.hidden = true;
    icon.hidden = false;
  }
}

