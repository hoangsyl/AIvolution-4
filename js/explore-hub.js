// AIvolution Module: Thanh Dock Kính Lỏng & Explore Mini-Tab Hub (News / Food / Check-in)
// ==========================================
// AIvolution Team - Liquid Glass Bottom Nav
// ==========================================
(function initBottomNavLiquidGlass() {
  if (!bottomNav) return;

  const glassPill = document.createElement("span");
  glassPill.className = "nav-liquid-glass is-visible";
  glassPill.setAttribute("aria-hidden", "true");
  bottomNav.appendChild(glassPill);

  const buttons = Array.from(bottomNav.querySelectorAll(".nav-btn, .nav-scan-btn"));
  let isHolding = false;
  let hoveredBtn = null;

  function setHoveredButton(btn) {
    if (hoveredBtn === btn) return;
    if (hoveredBtn) hoveredBtn.classList.remove("is-glass-hover");
    hoveredBtn = btn;
    if (hoveredBtn) hoveredBtn.classList.add("is-glass-hover");
  }

  function getActiveTabButton() {
    if (activeView === "weather") {
      return bottomNav.querySelector('.nav-btn[data-nav="weather"]');
    }
    if (activeView === "chat") {
      return bottomNav.querySelector('.nav-btn[data-nav="chat"]');
    }
    if (activeView === "history") {
      return bottomNav.querySelector("#navHistoryBtn");
    }
    return bottomNav.querySelector('.nav-btn[data-nav="home"]');
  }

  function snapGlassToButton(btn, scale = 1) {
    if (!btn || bottomNav.hidden) return;
    const navRect = bottomNav.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    if (!navRect.width || !btnRect.width) return;

    const isScan = btn.classList.contains("nav-scan-btn");
    const pillW = isScan ? 68 : 60;
    const pillH = isScan ? 64 : 46;
    const centerInNav = btnRect.left - navRect.left + btnRect.width / 2;
    const leftX = centerInNav - pillW / 2;

    glassPill.style.width = `${pillW}px`;
    glassPill.style.height = `${pillH}px`;
    glassPill.classList.remove("is-dragging");
    glassPill.classList.add("is-visible");
    glassPill.style.transform = `translate3d(${leftX.toFixed(1)}px, -50%, 0) scale(${scale})`;
  }

  syncNavGlassFn = () => {
    if (!isHolding) snapGlassToButton(getActiveTabButton(), 1);
  };

  function moveGlassTo(clientX, dragging) {
    const navRect = bottomNav.getBoundingClientRect();
    let nearest = null;
    let minDist = Infinity;

    buttons.forEach((btn) => {
      const r = btn.getBoundingClientRect();
      const center = r.left + r.width / 2;
      const dist = Math.abs(clientX - center);
      if (dist < minDist) {
        minDist = dist;
        nearest = btn;
      }
    });

    if (!nearest) return;
    setHoveredButton(nearest);

    const btnRect = nearest.getBoundingClientRect();
    const isScan = nearest.classList.contains("nav-scan-btn");
    const pillW = isScan ? 68 : 60;
    const pillH = isScan ? 64 : 46;

    const btnCenterInNav = btnRect.left - navRect.left + btnRect.width / 2;
    const fingerInNav = Math.min(navRect.width - pillW / 2, Math.max(pillW / 2, clientX - navRect.left));
    const targetCenter = btnCenterInNav * 0.72 + fingerInNav * 0.28;
    const leftX = targetCenter - pillW / 2;

    glassPill.style.width = `${pillW}px`;
    glassPill.style.height = `${pillH}px`;
    glassPill.classList.toggle("is-dragging", Boolean(dragging));
    glassPill.classList.add("is-visible");
    glassPill.style.transform = `translate3d(${leftX.toFixed(1)}px, -50%, 0) scale(1.06)`;
  }

  function releaseGlass() {
    if (!isHolding) return;
    isHolding = false;
    const target = hoveredBtn;
    setHoveredButton(null);
    if (target) {
      snapGlassToButton(target, 1);
      target.click();
    } else {
      snapGlassToButton(getActiveTabButton(), 1);
    }
  }

  bottomNav.addEventListener("pointerdown", (e) => {
    isHolding = true;
    if (bottomNav.setPointerCapture) {
      try { bottomNav.setPointerCapture(e.pointerId); } catch (_) {}
    }
    moveGlassTo(e.clientX, false);
  });

  bottomNav.addEventListener("pointermove", (e) => {
    if (!isHolding) return;
    moveGlassTo(e.clientX, true);
  });

  bottomNav.addEventListener("pointerup", releaseGlass);
  bottomNav.addEventListener("pointercancel", () => {
    isHolding = false;
    setHoveredButton(null);
    snapGlassToButton(getActiveTabButton(), 1);
  });

  const observer = new MutationObserver(() => {
    if (!isHolding && !bottomNav.hidden) {
      requestAnimationFrame(() => snapGlassToButton(getActiveTabButton(), 1));
    }
  });
  observer.observe(bottomNav, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("resize", () => {
    if (!isHolding) snapGlassToButton(getActiveTabButton(), 1);
  });

  requestAnimationFrame(() => snapGlassToButton(getActiveTabButton(), 1));
})();

// ==========================================
// AIvolution - EXPLORE NEWS / FOOD / CHECK-IN MINI-TAB HUB
// ==========================================
(function initExploreNewsHub() {
  const triggerBtn = document.getElementById("btnOpenNewsHub");
  const modal = document.getElementById("exploreHubModal");
  const win = document.getElementById("exploreWindow");
  const track = document.getElementById("exploreTrack");
  const updatedEl = document.getElementById("exploreUpdatedAt");
  const refreshBtn = document.getElementById("btnRefreshExplore");

  if (!triggerBtn || !modal || !win || !track) return;

  const TABS = ["news", "food", "checkin"];
  const tabCache = Object.create(null);
  const inFlight = Object.create(null);
  let activeTab = "news";
  let lastFocusedEl = null;

  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setTabIndicators(tab) {
    activeTab = tab;
    modal.querySelectorAll("[data-explore-tab]").forEach((btn) => {
      const isMatch = btn.dataset.exploreTab === tab;
      btn.classList.toggle("active", isMatch);
      btn.setAttribute("aria-selected", String(isMatch));
    });
    const cached = tabCache[tab];
    if (updatedEl) {
      updatedEl.textContent = cached?.updatedAt
        ? `Cập nhật ${cached.updatedAt}`
        : "Đang đồng bộ...";
    }
  }

  function renderSkeleton(paneEl) {
    paneEl.innerHTML = `
      <div class="explore-grid">
        <div class="explore-featured-col">
          <div class="explore-skel-card"></div>
          <div class="explore-skel-card"></div>
        </div>
        <div class="explore-list-box">
          <div class="explore-skel-row"></div>
          <div class="explore-skel-row"></div>
          <div class="explore-skel-row"></div>
          <div class="explore-skel-row"></div>
        </div>
      </div>
    `;
  }

  function renderError(paneEl, tab, msg) {
    paneEl.innerHTML = `
      <div class="explore-empty">
        <p>${escapeHtml(msg || "Chưa tải được dữ liệu xu hướng lúc này.")}</p>
        <button type="button" class="explore-card-action primary" data-retry-tab="${tab}" style="flex:0 0 auto;padding:9px 18px">
          Tải lại ngay
        </button>
      </div>
    `;
    const retryBtn = paneEl.querySelector("[data-retry-tab]");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => loadTabData(tab, true));
    }
  }

  function askAssistantFromExplore(item, tab) {
    closeModal();
    if (typeof navigateTo === "function") navigateTo("chat");

    const promptText =
      tab === "news" || item.type === "news"
        ? `Tóm tắt nhanh thông tin chính và gợi ý trải nghiệm liên quan đến tin này tại Đà Nẵng – Hội An: "${item.title}"`
        : `Review ngắn gọn địa điểm "${item.title}" (${item.subtitle}): món ngon/góc chụp ảnh nổi bật, giá tham khảo và khung giờ đi đỡ đông?`;

    const input = document.getElementById("chatInput");
    const form = document.getElementById("chatForm");
    if (input && form) {
      input.value = promptText;
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    }
  }

  function renderTabItems(paneEl, tab, items) {
    if (!Array.isArray(items) || !items.length) {
      renderError(paneEl, tab, "Chưa có mục nổi bật nào mới. Bạn thử làm mới lại nhé!");
      return;
    }

    const featured = items.slice(0, 2);
    const rest = items.slice(2, 35);
    const shortTag = tab === "news" ? "NEWS" : tab === "food" ? "FOOD" : "CHECK-IN";

    const featuredHtml = featured
      .map((item, idx) => {
        const isPlace = item.type === "place";
        const actionLabel = isPlace ? "Chỉ đường" : "Đọc bài";
        const coverHtml = item.image
          ? `<img class="explore-cover-img" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
          : `<span class="explore-cover-fallback" aria-hidden="true">${shortTag}</span>`;

        return `
          <article class="explore-featured-card">
            <a class="explore-cover-link" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener noreferrer">
              ${coverHtml}
              <span class="explore-cover-badge tabular-nums">${escapeHtml(item.badge || shortTag)}</span>
            </a>
            <div class="explore-featured-content">
              <div class="explore-meta-row">
                <span class="explore-badge">${shortTag}</span>
                <span class="explore-meta-text tabular-nums">${escapeHtml(item.meta || "")}</span>
              </div>
              <a class="explore-card-title-link" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener noreferrer">
                <h3 class="explore-card-title">${escapeHtml(item.title)}</h3>
              </a>
              <p class="explore-card-desc">${escapeHtml(item.subtitle || "")}</p>
              <div class="explore-card-actions">
                <a class="explore-card-action primary" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener noreferrer">${actionLabel}</a>
                <button type="button" class="explore-card-action" data-ask-idx="${idx}">Hỏi AI</button>
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    const listHtml = (rest.length ? rest : featured)
      .map((item, idx) => {
        const realIdx = rest.length ? idx + 2 : idx;
        const isPlace = item.type === "place";
        const thumbHtml = item.image
          ? `<img class="explore-list-thumb" src="${escapeHtml(item.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
          : `<span class="explore-list-fallback" aria-hidden="true">${shortTag}</span>`;

        return `
          <article class="explore-list-item">
            <a class="explore-list-media" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener noreferrer">
              ${thumbHtml}
            </a>
            <div class="explore-list-info">
              <a class="explore-list-title" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
              <div class="explore-list-bottom">
                <span class="explore-list-sub tabular-nums">${escapeHtml(item.badge || "")}${item.meta ? ` • ${escapeHtml(item.meta)}` : ""}</span>
                <div class="explore-list-btns">
                  <button type="button" class="explore-mini-btn" data-ask-idx="${realIdx}" aria-label="Hỏi AI về ${escapeHtml(item.title)}">AI</button>
                  <a class="explore-mini-btn accent" href="${escapeHtml(item.url || "#")}" target="_blank" rel="noopener noreferrer">${isPlace ? "Maps" : "Đọc"}</a>
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    paneEl.innerHTML = `
      <div class="explore-grid">
        <div class="explore-featured-col">${featuredHtml}</div>
        <div class="explore-list-box">${listHtml}</div>
      </div>
    `;

    paneEl.querySelectorAll("img.explore-cover-img, img.explore-list-thumb").forEach((img) => {
      img.addEventListener("error", () => {
        const fb = document.createElement("span");
        fb.className = img.classList.contains("explore-cover-img")
          ? "explore-cover-fallback"
          : "explore-list-fallback";
        fb.setAttribute("aria-hidden", "true");
        fb.textContent = shortTag;
        img.replaceWith(fb);
      }, { once: true });
    });

    paneEl.querySelectorAll("[data-ask-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = items[Number(btn.dataset.askIdx)];
        if (item) askAssistantFromExplore(item, tab);
      });
    });
  }

  async function loadTabData(tab, force = false) {
    const paneEl = document.getElementById(`pane-${tab}`);
    if (!paneEl) return;

    const cached = tabCache[tab];
    if (!force && cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
      if (!paneEl.dataset.rendered) {
        renderTabItems(paneEl, tab, cached.items);
        paneEl.dataset.rendered = "1";
      }
      if (tab === activeTab && updatedEl) {
        updatedEl.textContent = `Cập nhật ${cached.updatedAt}`;
      }
      return;
    }

    if (inFlight[tab] && !force) return;
    inFlight[tab] = true;
    renderSkeleton(paneEl);
    if (tab === activeTab && updatedEl) updatedEl.textContent = "Đang tải...";

    try {
      const res = await fetch(`/api/explore?tab=${encodeURIComponent(tab)}${force ? `&_t=${Date.now()}` : ""}`);
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.items)) {
        throw new Error(data.error || "Không tải được dữ liệu.");
      }
      tabCache[tab] = {
        items: data.items,
        updatedAt: data.updatedAt || "Vừa xong",
        fetchedAt: Date.now()
      };
      renderTabItems(paneEl, tab, data.items);
      paneEl.dataset.rendered = "1";
      if (tab === activeTab && updatedEl) {
        updatedEl.textContent = `Cập nhật ${tabCache[tab].updatedAt}`;
      }
    } catch (err) {
      renderError(paneEl, tab, err?.message || "Mạng không ổn định, bạn thử tải lại nhé.");
    } finally {
      inFlight[tab] = false;
    }
  }

  function scrollToTab(tab) {
    const paneEl = document.getElementById(`pane-${tab}`);
    if (!paneEl) return;
    setTabIndicators(tab);
    paneEl.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      inline: "start",
      block: "nearest"
    });
    loadTabData(tab, false);
  }

  const paneObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
          const tab = entry.target.dataset.paneTab;
          if (tab && TABS.includes(tab)) {
            if (tab !== activeTab) setTabIndicators(tab);
            loadTabData(tab, false);
          }
        }
      }
    },
    { root: track, threshold: 0.55 }
  );

  track.querySelectorAll(".explore-pane").forEach((pane) => paneObserver.observe(pane));

  function openModal() {
    lastFocusedEl = document.activeElement;
    modal.hidden = false;
    win.classList.add("is-animating");
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      modal.classList.add("is-open");
    });

    loadTabData(activeTab, false);
    setTimeout(() => {
      if (modal.classList.contains("is-open")) {
        TABS.forEach((t) => {
          if (t !== activeTab && !tabCache[t]) loadTabData(t, false);
        });
      }
    }, 450);

    const closeBtn = document.getElementById("btnCloseExplore");
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    if (modal.hidden) return;
    win.classList.add("is-animating");
    modal.classList.remove("is-open");
    document.body.style.overflow = "";

    const finishClose = () => {
      win.classList.remove("is-animating");
      if (!modal.classList.contains("is-open")) {
        modal.hidden = true;
      }
    };

    if (prefersReducedMotion()) {
      finishClose();
    } else {
      setTimeout(finishClose, 240);
    }

    if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
      lastFocusedEl.focus();
    }
  }

  win.addEventListener("transitionend", () => {
    win.classList.remove("is-animating");
  });

  triggerBtn.addEventListener("click", openModal);

  modal.querySelectorAll("[data-explore-close]").forEach((el) => {
    el.addEventListener("click", closeModal);
  });

  modal.querySelectorAll("[data-explore-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.exploreTab;
      if (tab && TABS.includes(tab)) scrollToTab(tab);
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => loadTabData(activeTab, true));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) {
      e.stopPropagation();
      closeModal();
    }
  });
})();

