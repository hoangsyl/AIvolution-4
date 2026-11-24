// AIvolution Module: Food & Drinks quanh bạn (GPS Google Maps)
// ==========================================
// AIvolution - FOOD & DRINKS QUANH BẠN (GPS GOOGLE MAPS)
// ==========================================
(function initFoodDrinksNearby() {
  const CACHE_PREFIX = "aivolution_fd_v2";
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const MOVE_THRESHOLD_M = 250;

  const openBtn = document.getElementById("fd-open-btn");
  const modal = document.getElementById("fd-modal");
  const panel = document.getElementById("fd-panel");
  const refreshBtn = document.getElementById("fd-refresh-btn");
  const statusEl = document.getElementById("fd-status");
  const bodyEl = document.getElementById("fd-body");
  const listEl = document.getElementById("fd-list");
  const allCatBtns = document.querySelectorAll("[data-fd-cat]");

  if (!openBtn || !modal || !panel || !listEl) return;

  let currentCategory = "all";
  let currentRadius = 1000;
  let lastPlaces = [];
  let lastFocusedEl = null;

  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function formatDist(m) {
    return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
  }

  function askAIForPlace(place) {
    const prompt =
      `Review nhanh "${place.name}" (${place.type}, ${place.rating.toFixed(1)} sao` +
      `${place.address ? `, địa chỉ: ${place.address}` : ""}). ` +
      `Quán này có món gì ngon đáng thử và tầm giá khoảng bao nhiêu?`;

    closeModal();
    if (typeof navigateTo === "function") navigateTo("chat");

    const input = document.getElementById("chatInput");
    const form = document.getElementById("chatForm");
    if (input && form) {
      input.value = prompt;
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      }
    }
  }

  function renderSkeletons() {
    bodyEl.setAttribute("aria-busy", "true");
    listEl.innerHTML = `
      <div class="fd-grid">
        <div class="fd-featured-col">
          <div class="fd-skel-card"></div>
          <div class="fd-skel-card"></div>
        </div>
        <div class="fd-list-box">
          <div class="fd-skel-row"></div>
          <div class="fd-skel-row"></div>
          <div class="fd-skel-row"></div>
          <div class="fd-skel-row"></div>
        </div>
      </div>`;
  }

  function renderPlaces(places) {
    lastPlaces = places;
    bodyEl.setAttribute("aria-busy", "false");

    if (!places.length) {
      const nextRadius = currentRadius < 2000 ? 2000 : 3000;
      listEl.innerHTML = `
        <div class="fd-state-box">
          <p class="fd-state-text">
            Không tìm thấy địa điểm từ 4.0★ trở lên trong bán kính ${currentRadius / 1000}km.
          </p>
          ${
            currentRadius < 3000
              ? `<button type="button" id="fd-expand-btn" class="fd-action-btn">
                  Mở rộng quét lên ${nextRadius / 1000}km
                </button>`
              : ""
          }
        </div>`;
      const expandBtn = document.getElementById("fd-expand-btn");
      if (expandBtn) {
        expandBtn.addEventListener("click", () => {
          currentRadius = nextRadius;
          scanNearby(true);
        });
      }
      return;
    }

    const featured = places.slice(0, 2);
    const rest = places.slice(2);

    const featuredHtml = featured
      .map(
        (p, idx) => `
        <article class="fd-featured-card">
          <div class="fd-featured-top">
            <span class="fd-rank-badge tabular-nums">TOP ${idx + 1} • ★ ${p.rating.toFixed(1)}</span>
            <span class="fd-card-meta tabular-nums" style="margin:0">${formatDist(p.distance)}</span>
          </div>
          <h3 class="fd-featured-name">${escapeHtml(p.name)}</h3>
          <p class="fd-card-meta tabular-nums" style="margin:0">
            <span>${p.reviews} đánh giá</span>
            <span aria-hidden="true">•</span>
            <span>${escapeHtml(p.type)}</span>
          </p>
          ${p.address ? `<p class="fd-card-addr">${escapeHtml(p.address)}</p>` : ""}
          <div class="fd-featured-actions">
            <a
              class="fd-btn-maps"
              href="${escapeHtml(p.mapsUrl)}"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Chỉ đường Google Maps tới ${escapeHtml(p.name)}"
            >
              Chỉ đường
            </a>
            <button type="button" class="fd-btn-ai" data-idx="${idx}" aria-label="Hỏi AI về ${escapeHtml(p.name)}">
              Hỏi AI
            </button>
          </div>
        </article>`
      )
      .join("");

    const listBoxHtml = rest.length
      ? `
        <div class="fd-list-box">
          <ul class="fd-list">
            ${rest
              .map(
                (p, idx) => `
                <li class="fd-card">
                  <div class="fd-card-info">
                    <h3 class="fd-card-name">${escapeHtml(p.name)}</h3>
                    <p class="fd-card-meta tabular-nums">
                      <span class="fd-rating">★ ${p.rating.toFixed(1)}</span>
                      <span>(${p.reviews})</span>
                      <span aria-hidden="true">•</span>
                      <span>${formatDist(p.distance)}</span>
                      <span aria-hidden="true">•</span>
                      <span>${escapeHtml(p.type)}</span>
                    </p>
                  </div>
                  <div class="fd-card-actions">
                    <button type="button" class="fd-btn-ai" data-idx="${idx + 2}" aria-label="Hỏi AI về ${escapeHtml(p.name)}">
                      AI
                    </button>
                    <a
                      class="fd-btn-maps"
                      href="${escapeHtml(p.mapsUrl)}"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Mở Google Maps tới ${escapeHtml(p.name)}"
                    >
                      Maps
                    </a>
                  </div>
                </li>`
              )
              .join("")}
          </ul>
        </div>`
      : "";

    listEl.innerHTML = `
      <div class="fd-grid">
        <div class="fd-featured-col">${featuredHtml}</div>
        ${listBoxHtml}
      </div>`;
  }

  function renderError(message) {
    bodyEl.setAttribute("aria-busy", "false");
    statusEl.textContent = "Chưa quét được";
    listEl.innerHTML = `
      <div class="fd-state-box is-error">
        <p class="fd-state-text">${escapeHtml(message)}</p>
        <button type="button" id="fd-retry-btn" class="fd-action-btn">Thử quét lại</button>
      </div>`;
    const retryBtn = document.getElementById("fd-retry-btn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => scanNearby(true));
    }
  }

  function getGPS(forceFresh = false) {
    if (!forceFresh && Number.isFinite(currentCoords?.lat) && Number.isFinite(currentCoords?.lng)) {
      return Promise.resolve({ lat: currentCoords.lat, lng: currentCoords.lng });
    }
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        return reject(new Error("Trình duyệt của bạn không hỗ trợ định vị GPS."));
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          currentCoords.lat = pos.coords.latitude;
          currentCoords.lng = pos.coords.longitude;
          resolve({ lat: currentCoords.lat, lng: currentCoords.lng });
        },
        (err) => {
          if (err.code === 1) {
            reject(new Error("Bạn chưa cấp quyền GPS. Hãy bật vị trí cho trình duyệt rồi thử lại."));
          } else {
            reject(new Error("Không lấy được tín hiệu GPS. Vui lòng thử lại."));
          }
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: forceFresh ? 0 : 60000 }
      );
    });
  }

  async function scanNearby(forceRefresh = false) {
    statusEl.textContent = `Đang quét ${currentRadius / 1000}km...`;
    renderSkeletons();

    try {
      const coords = await getGPS(forceRefresh);
      const cacheKey = `${CACHE_PREFIX}_${currentCategory}_${currentRadius}`;
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");

      const movedFar =
        !cached ||
        Math.hypot(coords.lat - cached.lat, coords.lng - cached.lng) * 111000 > MOVE_THRESHOLD_M;

      if (!forceRefresh && cached && !movedFar && Date.now() - cached.ts < CACHE_TTL_MS) {
        statusEl.textContent = `Top ${cached.places.length} nơi • ${currentRadius / 1000}km`;
        renderPlaces(cached.places);
        return;
      }

      const url = `/api/nearby-places?lat=${coords.lat}&lng=${coords.lng}&radius=${currentRadius}&category=${encodeURIComponent(currentCategory)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Lỗi tải dữ liệu địa điểm.");

      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({ lat: coords.lat, lng: coords.lng, ts: Date.now(), places: data.places })
        );
      } catch (_) {}

      statusEl.textContent = `Top ${data.places.length} nơi • ${currentRadius / 1000}km`;
      renderPlaces(data.places);
    } catch (err) {
      renderError(err?.message || "Đã xảy ra lỗi khi quét địa điểm.");
    }
  }

  function openModal() {
    lastFocusedEl = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => modal.classList.add("is-open"));
    panel.focus();
    scanNearby(false);
  }

  function closeModal() {
    if (modal.hidden) return;
    modal.classList.remove("is-open");
    document.body.style.overflow = "";

    const finishClose = () => {
      if (!modal.classList.contains("is-open")) {
        modal.hidden = true;
      }
      if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
        lastFocusedEl.focus();
      }
    };

    if (prefersReducedMotion()) {
      finishClose();
    } else {
      setTimeout(finishClose, 200);
    }
  }

  openBtn.addEventListener("click", openModal);

  modal.querySelectorAll("[data-fd-close]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => scanNearby(true));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) {
      e.stopPropagation();
      closeModal();
    }
  });

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".fd-btn-ai");
    if (!btn) return;
    const place = lastPlaces[Number(btn.dataset.idx)];
    if (place) askAIForPlace(place);
  });

  allCatBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentCategory = btn.dataset.fdCat;
      currentRadius = 1000;
      allCatBtns.forEach((b) => {
        const isMatch = b.dataset.fdCat === currentCategory;
        b.classList.toggle("active", isMatch);
        b.setAttribute("aria-selected", String(isMatch));
      });
      scanNearby(false);
    });
  });
})();
