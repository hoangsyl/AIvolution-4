// AIvolution Module: Camera, Nén ảnh thích ứng, Quét AI chịu tải >100 người & Màn hình Chi tiết
// ==========================================
// 3. CAMERA (LUÔN FULL MÀN HÌNH TRÊN IOS) & GPS
// ==========================================
function recreateVideoElement() {
  if (!video || !video.parentNode) return;
  const fresh = document.createElement("video");
  fresh.id = "camera";
  fresh.autoplay = true;
  fresh.playsInline = true;
  fresh.muted = true;
  fresh.setAttribute("autoplay", "");
  fresh.setAttribute("playsinline", "");
  fresh.setAttribute("muted", "");
  video.parentNode.replaceChild(fresh, video);
  video = fresh;
}

async function startCamera() {
  cameraErrorBanner.hidden = true;
  stopCamera();
  recreateVideoElement();

  const session = ++cameraSessionId;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });

    if (session !== cameraSessionId || activeView !== "scanner") {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    currentStream = stream;
    video.srcObject = currentStream;
    video.onloadedmetadata = () => {
      video.play().catch(() => {});
    };
    video.play().catch(() => {});
  } catch (_) {
    if (session === cameraSessionId) {
      cameraErrorBanner.textContent = "Không mở được camera. Bạn có thể bấm nút Thư viện bên dưới để chọn ảnh có sẵn.";
      cameraErrorBanner.hidden = false;
    }
  }
}

function stopCamera() {
  cameraSessionId++;
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
  if (video) {
    video.pause();
    video.srcObject = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopSpeaking();
    resetAudioContext();
  } else {
    if (activeView === "scanner") {
      const track = currentStream?.getVideoTracks?.()[0];
      if (!track || track.readyState === "ended") startCamera();
      else if (video && video.paused) video.play().catch(() => {});
    }
  }
});

window.addEventListener("pagehide", () => {
  stopSpeaking();
  resetAudioContext();
});

function initGPS() {
  if (!navigator.geolocation) {
    gpsText.textContent = "Đà Nẵng – Hội An";
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      currentCoords.lat = pos.coords.latitude;
      currentCoords.lng = pos.coords.longitude;
      gpsDot.classList.add("ready");
      gpsText.textContent = `${currentCoords.lat.toFixed(4)}, ${currentCoords.lng.toFixed(4)}`;
    },
    () => {
      gpsText.textContent = "Đà Nẵng – Hội An";
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 }
  );
}


// ==========================================
// 6. QUÉT ẢNH TỐC ĐỘ CAO & HIỂN THỊ MÀN HÌNH CHI TIẾT
// ==========================================
function makeThumbnail(sourceCanvas) {
  try {
    const thumbCanvas = document.createElement("canvas");
    const maxW = 360;
    const scale = Math.min(1, maxW / sourceCanvas.width);
    thumbCanvas.width = Math.round(sourceCanvas.width * scale);
    thumbCanvas.height = Math.round(sourceCanvas.height * scale);
    thumbCanvas.getContext("2d").drawImage(sourceCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    return thumbCanvas.toDataURL("image/jpeg", 0.65);
  } catch (_) {
    return "";
  }
}

function setScanningLock(locked) {
  isScanning = locked;
  statusPill.classList.toggle("show", locked);
  const captureBtn = document.getElementById("captureBtn");
  const uploadBtn = document.getElementById("uploadBtn");
  if (captureBtn) captureBtn.disabled = locked;
  if (uploadBtn) uploadBtn.disabled = locked;
}

async function scanBase64(imageBase64, thumbDataUrl) {
  if (isScanning) return;
  const startTime = performance.now();
  setScanningLock(true);

  try {
    const modeHint = scanMode === "food"
      ? "Ưu tiên đong đếm calo từ nhãn hoặc nguyên liệu nhìn thấy rõ, tuyệt đối không bịa số. "
      : scanMode === "place"
      ? "Ưu tiên nhận diện chính xác địa điểm, logo trường học, thương hiệu, di tích. "
      : "";

    const locationContext = currentCoords.lat
      ? `${modeHint}GPS(${currentCoords.lat.toFixed(4)}, ${currentCoords.lng.toFixed(4)}) - Hội An & Đà Nẵng`
      : `${modeHint}Hội An – Đà Nẵng`;

    if (typeof statusPill !== "undefined" && statusPill) {
      statusPill.textContent = "Đang phân tích hình ảnh...";
    }
    const clientCacheKey = `${scanMode}:${imageBase64.length}:${imageBase64.slice(0, 64)}:${imageBase64.slice(-64)}`;
    window.__aivClientScanCache = window.__aivClientScanCache || new Map();
    if (window.__aivClientScanCache.has(clientCacheKey)) {
      const cachedData = window.__aivClientScanCache.get(clientCacheKey);
      lastScanData = cachedData;
      addToHistory(cachedData, thumbDataUrl);
      renderDetailView(cachedData, "0.1s", thumbDataUrl, false);
      return;
    }

    const { res, data } = await fetchApiWithRetry(
      {
        imageBase64,
        scanMode,
        lat: currentCoords.lat,
        lng: currentCoords.lng,
        locationContext
      },
      { timeoutMs: 20000, maxRetries: 3 }
    );

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

    if (!res.ok || data.error) {
      renderErrorDetail(data.debug || "", thumbDataUrl);
    } else {
      if (window.__aivClientScanCache) {
        if (window.__aivClientScanCache.size >= 40) {
          const oldest = window.__aivClientScanCache.keys().next().value;
          window.__aivClientScanCache.delete(oldest);
        }
        window.__aivClientScanCache.set(clientCacheKey, data);
      }
      lastScanData = data;
      addToHistory(data, thumbDataUrl);
      renderDetailView(data, `${elapsed}s`, thumbDataUrl, false);
    }
  } catch (err) {
    renderErrorDetail(
      err?.name === "AbortError"
        ? "Quá thời gian phản hồi, bạn thử bấm Quét lại nhé"
        : (err?.message || "Lỗi kết nối mạng"),
      thumbDataUrl
    );
  } finally {
    setScanningLock(false);
  }
}

function setDetailHero(thumbDataUrl) {
  const img = document.getElementById("detailHeroImg");
  const placeholder = document.getElementById("detailHeroPlaceholder");
  if (thumbDataUrl) {
    img.src = thumbDataUrl;
    img.hidden = false;
    placeholder.hidden = true;
  } else {
    img.hidden = true;
    placeholder.hidden = false;
  }
}

function renderErrorDetail(debugMsg, thumbDataUrl) {
  stopCamera();
  setDetailHero(thumbDataUrl);
  const sheet = document.getElementById("detailSheet");
  sheet.innerHTML = `
    <div class="detail-pills"><span class="pill-tag">THỬ LẠI</span></div>
    <h2 class="detail-title">Chưa nhận diện được</h2>
    <div class="error-panel">
      ${FRIENDLY_ERROR_MSG}
      ${debugMsg ? `<div class="error-debug">Chi tiết: ${escapeHtml(debugMsg)}</div>` : ""}
    </div>
    <div class="detail-actions">
      <button type="button" class="btn-pill btn-secondary" id="errHomeBtn">Trang chủ</button>
      <button type="button" class="btn-pill btn-primary" id="errRetryBtn">Quét lại</button>
    </div>
  `;
  navigateTo("detail");
  document.getElementById("errHomeBtn").addEventListener("click", () => navigateTo("home"));
  document.getElementById("errRetryBtn").addEventListener("click", () => navigateTo("scanner"));
}

function getShortHealthStatus(healthText, isFood) {
  if (!isFood) return "N/A";
  const t = String(healthText || "").toLowerCase();
  if (/hạn chế|nhiều đường|nhiều dầu|calo cao|không tốt|cân nhắc/.test(t)) return "Vừa phải";
  if (/không áp dụng|chưa rõ|chưa đủ dữ liệu/.test(t)) return "N/A";
  return "Tốt";
}

function renderDetailView(data, timeOrElapsed, thumbDataUrl, fromHistory) {
  stopCamera();
  setDetailHero(thumbDataUrl);
  lastScanData = data;

  currentSpeechText = `${data.ten_dia_diem || ""}. ${data.cau_chuyen_lich_su || ""} ${data.giai_thoai_dac_biet || ""}`;

  const sp = data.thong_tin_san_pham;
  const loaiLower = String(data.loai_doi_tuong || "").toLowerCase();
  const isFoodOrDrink = /thức ăn|đồ uống|món ăn|nước uống|thực phẩm|bánh|trái cây/.test(loaiLower);
  const kcalNum = parseCalories(sp?.calo_uoc_tinh);

  const hasValidAddress = data.dia_chi && !/không áp dụng|chưa xác định/i.test(data.dia_chi);
  const highlightText = isFoodOrDrink && sp?.calo_uoc_tinh
    ? `🔥 Calo: ${sp.calo_uoc_tinh}`
    : (hasValidAddress ? `📍 ${data.dia_chi}` : "Đà Nẵng – Hội An");

  const providerBadge = data._cached
    ? " • FAST CACHE"
    : data._provider
    ? ` • ${escapeHtml(String(data._provider).split(":")[0].toUpperCase())}`
    : "";

  const verifiedPill = data._verified
    ? `<span class="pill-tag accent">✓ Đã xác thực</span>`
    : "";

  const healthLabel = getShortHealthStatus(sp?.tot_cho_suc_khoe, isFoodOrDrink);

  const ringBlock = sp && sp.hien_thi ? `
    <div class="ring-grid">
      <div class="ring-tile">
        <span class="ring-tile-label">Calo</span>
        <div class="ring-mini-wrap">
          <svg class="ring-mini-svg" viewBox="0 0 60 60" aria-hidden="true">
            <circle class="ring-mini-bg" cx="30" cy="30" r="24" />
            <circle cx="30" cy="30" r="24" fill="none" stroke="#94D82D" stroke-width="6" stroke-linecap="round" stroke-dasharray="150.8" stroke-dashoffset="${kcalNum > 0 ? 42 : 135}" />
          </svg>
          <span class="ring-mini-val tabular-nums">${kcalNum > 0 ? kcalNum : "N/A"}</span>
        </div>
      </div>
      <div class="ring-tile">
        <span class="ring-tile-label">${isFoodOrDrink ? "Dinh dưỡng" : "Xác thực"}</span>
        <div class="ring-mini-wrap">
          <svg class="ring-mini-svg" viewBox="0 0 60 60" aria-hidden="true">
            <circle class="ring-mini-bg" cx="30" cy="30" r="24" />
            <circle cx="30" cy="30" r="24" fill="none" stroke="#38BDF8" stroke-width="6" stroke-linecap="round" stroke-dasharray="150.8" stroke-dashoffset="${isFoodOrDrink ? 50 : (data._verified ? 18 : 48)}" />
          </svg>
          <span class="ring-mini-val">${isFoodOrDrink ? healthLabel : (data._verified ? "100%" : "AI")}</span>
        </div>
      </div>
      <div class="ring-tile">
        <span class="ring-tile-label">Tốc độ</span>
        <div class="ring-mini-wrap">
          <svg class="ring-mini-svg" viewBox="0 0 60 60" aria-hidden="true">
            <circle class="ring-mini-bg" cx="30" cy="30" r="24" />
            <circle cx="30" cy="30" r="24" fill="none" stroke="#FB923C" stroke-width="6" stroke-linecap="round" stroke-dasharray="150.8" stroke-dashoffset="35" />
          </svg>
          <span class="ring-mini-val tabular-nums">${escapeHtml(timeOrElapsed)}</span>
        </div>
      </div>
    </div>
  ` : "";

  const productBlock = sp && sp.hien_thi ? `
    <div class="info-block">
      <h3>${isFoodOrDrink ? "🍽️ Dinh dưỡng & Định lượng" : "📌 Thông số & Khu vực"}</h3>
      ${sp.tot_cho_suc_khoe && sp.tot_cho_suc_khoe !== "Không áp dụng" ? `<p><strong>Sức khỏe / Lưu ý:</strong> ${escapeHtml(sp.tot_cho_suc_khoe)}</p>` : ""}
      <p><strong>Chi tiết:</strong> ${escapeHtml(sp.chi_tiet_san_pham || "Đang cập nhật")}</p>
      <p><strong>${data.la_dia_diem ? "Địa điểm / Giờ mở cửa" : "Nơi mua gợi ý"}:</strong> ${escapeHtml(sp.noi_mua_goi_y || "Đà Nẵng – Hội An")}</p>
    </div>
  ` : "";

  const hv = data.han_viet;
  const hanVietBlock = hv && hv.co_han_viet ? `
    <div class="info-block">
      <h3>Giải nghĩa Hán – Nôm</h3>
      <p><strong>${escapeHtml(hv.chu_goc || "")}</strong> (${escapeHtml(hv.phien_am || "")})</p>
      <p>${escapeHtml(hv.y_nghia_tong_the || "")}</p>
    </div>
  ` : "";

  const reviewsHtml = (data.danh_gia_ban_dia?.review_mau || [])
    .map((r) => `<div class="review-chip">${escapeHtml(r)}</div>`)
    .join("");

  const mapUrl = data.hien_chi_duong ? data.chi_duong_url : data.google_maps_url;
  const mapLabel = data.hien_chi_duong ? "Chỉ đường" : "Tìm nơi mua";

  const sheet = document.getElementById("detailSheet");
  sheet.innerHTML = `
    <div class="detail-pills">
      <span class="pill-tag accent">${escapeHtml(data.loai_doi_tuong || "NHẬN DIỆN")}</span>
      ${verifiedPill}
      <span class="pill-tag tabular-nums">${escapeHtml(data.nien_dai_hoac_gia || (fromHistory ? timeOrElapsed : "Đà Nẵng – Hội An"))}</span>
    </div>

    <h2 class="detail-title">${escapeHtml(data.ten_dia_diem || "Kết quả nhận diện")}</h2>

    <div class="highlight-bar">
      <span>${escapeHtml(highlightText)}</span>
      <span class="highlight-meta tabular-nums">${escapeHtml(timeOrElapsed)}${providerBadge}</span>
    </div>

    ${ringBlock}

    <div class="info-block">
      <h3>📊 Thông tin chi tiết</h3>
      <p>${escapeHtml(data.cau_chuyen_lich_su || "")}</p>
    </div>

    <div class="info-block">
      <h3>✨ Điểm độc đáo</h3>
      <p>${escapeHtml(data.giai_thoai_dac_biet || "")}</p>
    </div>

    ${productBlock}
    ${hanVietBlock}

    <div class="info-block">
      <h3>💬 Đánh giá từ người địa phương</h3>
      <p>${escapeHtml(data.danh_gia_ban_dia?.tom_tat || "")}</p>
      ${reviewsHtml}
    </div>

    <div class="detail-actions">
      <button type="button" id="speakBtn" class="btn-pill btn-secondary">Nghe thuyết minh</button>
      <a class="btn-pill btn-primary" href="${mapUrl || "#"}" target="_blank" rel="noopener">${mapLabel}</a>
    </div>
  `;

  navigateTo("detail");
  sheet.scrollTop = 0;
  document.getElementById("speakBtn").addEventListener("click", () => speakText(currentSpeechText));
}

// ==========================================
// SỰ KIỆN GIAO DIỆN
// ==========================================
document.querySelectorAll("[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => navigateTo(btn.dataset.nav));
});

document.getElementById("btnQuickWeather").addEventListener("click", () => navigateTo("weather"));
document.getElementById("btnQuickChat").addEventListener("click", () => navigateTo("chat"));
document.getElementById("btnRefreshWeather").addEventListener("click", () => renderWeatherView(true));

document.getElementById("detailBackBtn").addEventListener("click", () => navigateTo(previousView || "home"));
document.getElementById("detailCloseBtn").addEventListener("click", () => navigateTo("home"));

document.getElementById("btnClearHistory").addEventListener("click", () => {
  if (confirmDialog && typeof confirmDialog.showModal === "function") {
    confirmDialog.showModal();
  } else {
    setTotalScans(0);
    saveHistoryList([]);
    renderHomeDashboard();
  }
});

document.getElementById("dialogCancelBtn").addEventListener("click", () => confirmDialog.close());
document.getElementById("dialogConfirmBtn").addEventListener("click", () => {
  confirmDialog.close();
  setTotalScans(0);
  saveHistoryList([]);
  renderHomeDashboard();
});

document.querySelectorAll(".mode-pill[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    scanMode = btn.dataset.mode;
    document.querySelectorAll(".mode-pill[data-mode]").forEach((b) => {
      const active = b === btn;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
  });
});

document.getElementById("uploadBtn").addEventListener("click", () => {
  if (!isScanning) fileInput.click();
});

document.getElementById("lastThumbBtn").addEventListener("click", () => {
  const list = loadHistory();
  if (list.length) {
    renderDetailView(list[0].data, list[0].time, list[0].thumb, true);
  } else {
    navigateTo("home");
  }
});

document.getElementById("switchBtn").addEventListener("click", () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  startCamera();
});

function prepareScanImage(source, srcW, srcH) {
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  canvas.width = Math.round(srcW * scale);
  canvas.height = Math.round(srcH * scale);

  const ctx2d = canvas.getContext("2d");
  ctx2d.imageSmoothingEnabled = true;
  ctx2d.imageSmoothingQuality = "high";
  ctx2d.drawImage(source, 0, 0, canvas.width, canvas.height);

  let base64 = canvas.toDataURL("image/jpeg", 0.66).split(",")[1];
  if (base64.length > 180000) {
    base64 = canvas.toDataURL("image/jpeg", 0.54).split(",")[1];
  }
  return {
    base64,
    thumb: makeThumbnail(canvas)
  };
}

document.getElementById("captureBtn").addEventListener("click", () => {
  if (isScanning || !video || !video.videoWidth) return;
  const { base64, thumb } = prepareScanImage(video, video.videoWidth, video.videoHeight);
  scanBase64(base64, thumb);
});

fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file || isScanning) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const { base64, thumb } = prepareScanImage(img, img.width, img.height);
      scanBase64(base64, thumb);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});

// Khởi chạy ban đầu
initTheme();
updateHistoryBadge();
renderHomeDashboard();
initGPS();

