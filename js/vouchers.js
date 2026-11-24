/**
 * AIvolution Module: Auto Săn Voucher Hội An – Đà Nẵng Real-Time
 * - Lọc theo khu vực (Tất cả / Hội An / Đà Nẵng) và 7 danh mục (Show & Ký Ức Hội An, Nhà hàng, Quán địa phương, Thức ăn nhanh, Workshop, Cà phê, Shop & Minimart)
 * - Nút "Săn shop này" cào real-time bất kỳ shop nào có trên Google Maps Đà Nẵng – Hội An
 */
(function () {
  "use strict";

  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getVnDateKey() {
    const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  }

  const voucherModal = document.getElementById("voucherModal");
  const btnOpenVoucher = document.getElementById("btnOpenVoucherHub");
  const voucherListEl = document.getElementById("voucherList");
  const voucherMetaEl = document.getElementById("voucherMetaBanner");
  const voucherSubEl = document.getElementById("voucherUpdatedSub");
  const voucherSearchEl = document.getElementById("voucherSearchInput");
  const btnHuntShop = document.getElementById("btnHuntShopRealtime");
  const btnRefreshVoucher = document.getElementById("btnRefreshVouchers");

  let voucherState = {
    city: "all",
    category: "all",
    search: "",
    items: [],
    updatedAt: "",
    liveCount: 0,
    mapsCount: 0,
    dateKey: "",
    activeShopQuery: ""
  };

  function openVoucherModal() {
    if (!voucherModal) return;
    voucherModal.hidden = false;
    document.body.style.overflow = "hidden";
    loadVouchers(false);
  }

  function closeVoucherModal() {
    if (!voucherModal) return;
    voucherModal.hidden = true;
    document.body.style.overflow = "";
  }

  function renderVouchers(overrideList = null) {
    if (!voucherListEl) return;
    const cat = voucherState.category;
    const city = voucherState.city;
    const q = voucherState.search.trim().toLowerCase();

    const filtered = overrideList
      ? overrideList
      : voucherState.items.filter((item) => {
          if (city !== "all" && item.city && item.city !== city && item.city !== "both") return false;
          if (cat !== "all" && item.category !== cat) return false;
          if (q) {
            const hay = `${item.title} ${item.merchant} ${item.description} ${item.discount} ${item.code} ${item.address}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

    if (voucherMetaEl) {
      if (voucherState.activeShopQuery) {
        voucherMetaEl.innerHTML = `
          <span>Kết quả real-time cho <strong>"${esc(voucherState.activeShopQuery)}"</strong> (${filtered.length})</span>
          <button type="button" id="btnClearShopHunt" class="aiv-btn" style="padding:3px 9px;font-size:11px">Về danh sách chung</button>
        `;
        const clearBtn = document.getElementById("btnClearShopHunt");
        if (clearBtn) {
          clearBtn.addEventListener("click", () => {
            voucherState.activeShopQuery = "";
            if (voucherSearchEl) voucherSearchEl.value = "";
            voucherState.search = "";
            renderVouchers();
          });
        }
      } else {
        voucherMetaEl.innerHTML = `
          <span><strong>${filtered.length}</strong> ưu đãi hôm nay • Renew 00:00 mỗi ngày</span>
          <span>${voucherState.liveCount > 0 ? `${voucherState.liveCount} nguồn live` : "Đà Nẵng – Hội An"}</span>
        `;
      }
    }

    if (!filtered.length) {
      voucherListEl.innerHTML = `<div class="aiv-empty">Chưa thấy sẵn trong danh sách hôm nay. Bạn bấm nút <strong>"Săn Maps"</strong> ở ô tìm kiếm để cào real-time đúng quán này trên Google Maps nhé!</div>`;
      return;
    }

    const catLabels = {
      show: "Show & Vé",
      food: "Quán địa phương",
      restaurant: "Nhà hàng",
      fastfood: "Thức ăn nhanh",
      workshop: "Workshop",
      cafe: "Cà phê",
      minimart: "Shop & Minimart"
    };
    const cityLabels = {
      hoian: "Hội An",
      danang: "Đà Nẵng",
      both: "Đà Nẵng – Hội An"
    };

    voucherListEl.innerHTML = filtered
      .map((item) => {
        const verifiedText = item.isGoogleMapsPlace
          ? "📍 Google Maps Live"
          : item.verifiedLive
          ? "✓ Xác thực trực tiếp"
          : "✓ Kênh chính thức";
        const codeBtn = item.code
          ? `<button type="button" class="aiv-btn" data-copy-code="${esc(item.code)}">Sao chép mã: <strong>${esc(item.code)}</strong></button>`
          : "";
        return `
          <article class="aiv-vcard">
            <div class="aiv-vcard-top">
              <span class="aiv-badge-discount">${esc(item.discount || "Ưu đãi hôm nay")}</span>
              <span class="aiv-badge-verified">${verifiedText}</span>
            </div>
            <h3 class="aiv-vcard-title">${esc(item.title)}</h3>
            <p class="aiv-vcard-desc">${esc(item.description)}</p>
            <div class="aiv-vcard-meta">
              ${esc(cityLabels[item.city] || "Đà Nẵng – Hội An")} • ${esc(catLabels[item.category] || "Ưu đãi")} • ${esc(item.sourceName)} • ${esc(item.validLabel)}
            </div>
            <div class="aiv-vcard-actions">
              <a class="aiv-btn aiv-btn-primary" href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Xem nguồn &amp; Nhận deal</a>
              ${codeBtn}
              <a class="aiv-btn" href="${esc(item.mapsUrl)}" target="_blank" rel="noopener noreferrer">Maps</a>
            </div>
          </article>
        `;
      })
      .join("");

    voucherListEl.querySelectorAll("[data-copy-code]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const code = btn.getAttribute("data-copy-code");
        try {
          await navigator.clipboard.writeText(code);
          btn.innerHTML = `Đã chép: <strong>${esc(code)}</strong>`;
          setTimeout(() => {
            btn.innerHTML = `Sao chép mã: <strong>${esc(code)}</strong>`;
          }, 1800);
        } catch (_) {}
      });
    });
  }

  async function huntSpecificShop() {
    const shop = (voucherSearchEl?.value || "").trim();
    if (!shop) {
      if (voucherSearchEl) voucherSearchEl.focus();
      return;
    }
    voucherState.activeShopQuery = shop;
    if (voucherListEl) {
      voucherListEl.innerHTML = `<div class="aiv-empty">Đang cào Google Maps &amp; săn voucher real-time cho "${esc(shop)}"...</div>`;
    }
    if (btnHuntShop) btnHuntShop.disabled = true;

    try {
      const res = await fetch(`/api/vouchers?shop=${encodeURIComponent(shop)}&city=${encodeURIComponent(voucherState.city)}`);
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.items)) throw new Error(data.error || "Lỗi tìm shop");
      renderVouchers(data.items);
    } catch (err) {
      if (voucherListEl) {
        voucherListEl.innerHTML = `<div class="aiv-empty">${esc(err.message || "Không tìm được lúc này, bạn thử lại nhé.")}</div>`;
      }
    } finally {
      if (btnHuntShop) btnHuntShop.disabled = false;
    }
  }

  async function loadVouchers(force) {
    const todayKey = getVnDateKey();
    const storageKey = `aiv_vouchers_v3_${todayKey}`;
    voucherState.activeShopQuery = "";

    if (!force && voucherState.dateKey === todayKey && voucherState.items.length) {
      renderVouchers();
      return;
    }

    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (cached && Array.isArray(cached.items) && cached.items.length) {
          voucherState.items = cached.items;
          voucherState.updatedAt = cached.updatedAt || "";
          voucherState.liveCount = cached.liveCount || 0;
          voucherState.mapsCount = cached.mapsCount || 0;
          voucherState.dateKey = todayKey;
          if (voucherSubEl) voucherSubEl.textContent = `Cập nhật: ${voucherState.updatedAt}`;
          renderVouchers();
          return;
        }
      } catch (_) {}
    }

    if (voucherListEl) {
      voucherListEl.innerHTML = `<div class="aiv-empty">Đang cào ưu đãi mới nhất hôm nay tại Hội An &amp; Đà Nẵng...</div>`;
    }
    if (btnRefreshVoucher) btnRefreshVoucher.disabled = true;

    try {
      const url = `/api/vouchers${force ? `?refresh=1&_t=${Date.now()}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.items)) {
        throw new Error(data.error || "Lỗi tải voucher");
      }
      voucherState.items = data.items;
      voucherState.updatedAt = data.updatedAt || todayKey;
      voucherState.liveCount = data.liveCount || 0;
      voucherState.mapsCount = data.mapsCount || 0;
      voucherState.dateKey = data.dateKey || todayKey;

      if (voucherSubEl) voucherSubEl.textContent = `Cập nhật: ${voucherState.updatedAt}`;
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            items: data.items,
            updatedAt: data.updatedAt,
            liveCount: data.liveCount,
            mapsCount: data.mapsCount
          })
        );
      } catch (_) {}
      renderVouchers();
    } catch (err) {
      if (voucherListEl) {
        voucherListEl.innerHTML = `<div class="aiv-empty">${esc(err.message || "Không thể tải voucher lúc này. Thử bấm làm mới nhé!")}</div>`;
      }
    } finally {
      if (btnRefreshVoucher) btnRefreshVoucher.disabled = false;
    }
  }

  if (btnOpenVoucher) btnOpenVoucher.addEventListener("click", openVoucherModal);
  if (voucherModal) {
    voucherModal.querySelectorAll("[data-voucher-close]").forEach((el) => {
      el.addEventListener("click", closeVoucherModal);
    });
    voucherModal.querySelectorAll("[data-voucher-city]").forEach((btn) => {
      btn.addEventListener("click", () => {
        voucherState.city = btn.getAttribute("data-voucher-city") || "all";
        voucherState.activeShopQuery = "";
        voucherModal.querySelectorAll("[data-voucher-city]").forEach((b) => b.classList.toggle("active", b === btn));
        renderVouchers();
      });
    });
    voucherModal.querySelectorAll("[data-voucher-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        voucherState.category = btn.getAttribute("data-voucher-cat") || "all";
        voucherState.activeShopQuery = "";
        voucherModal.querySelectorAll("[data-voucher-cat]").forEach((b) => b.classList.toggle("active", b === btn));
        renderVouchers();
      });
    });
  }
  if (voucherSearchEl) {
    voucherSearchEl.addEventListener("input", () => {
      voucherState.search = voucherSearchEl.value || "";
      if (!voucherState.search.trim()) voucherState.activeShopQuery = "";
      renderVouchers();
    });
    voucherSearchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        huntSpecificShop();
      }
    });
  }
  if (btnHuntShop) btnHuntShop.addEventListener("click", huntSpecificShop);
  if (btnRefreshVoucher) btnRefreshVoucher.addEventListener("click", () => loadVouchers(true));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && voucherModal && !voucherModal.hidden) closeVoucherModal();
  });
})();
