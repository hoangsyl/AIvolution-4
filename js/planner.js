/**
 * AIvolution Module: AI Travel Planner (Siêu nhanh, chi tiết từng khung giờ & không lỗi)
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

  function formatVnd(n) {
    const val = Number(n) || 0;
    if (val <= 0) return "Miễn phí (0đ)";
    return `${val.toLocaleString("vi-VN")}đ`;
  }

  const plannerModal = document.getElementById("plannerModal");
  const btnOpenPlanner = document.getElementById("btnOpenPlannerHub");
  const plannerForm = document.getElementById("plannerForm");
  const plannerSubmitBtn = document.getElementById("plannerSubmitBtn");
  const plannerResultEl = document.getElementById("plannerResult");
  const SAVED_PLAN_KEY = "aiv_saved_travel_plan_v2";

  function openPlannerModal() {
    if (!plannerModal) return;
    plannerModal.hidden = false;
    document.body.style.overflow = "hidden";
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_PLAN_KEY) || "null");
      if (saved && saved.days && plannerResultEl && !plannerResultEl.innerHTML.trim()) {
        renderPlan(saved, "Đã lưu offline");
      }
    } catch (_) {}
  }

  function closePlannerModal() {
    if (!plannerModal) return;
    plannerModal.hidden = true;
    document.body.style.overflow = "";
  }

  function planToPlainText(plan) {
    const lines = [
      `${plan.title}`,
      `${plan.summary}`,
      `Tổng dự kiến: ${formatVnd(plan.totalEstimatedVnd)}`,
      ""
    ];
    (plan.days || []).forEach((d) => {
      lines.push(`NGÀY ${d.day}: ${d.theme}`);
      (d.slots || []).forEach((s) => {
        const addr = s.address ? ` (${s.address})` : "";
        lines.push(`- ${s.time} [${s.period}]: ${s.place}${addr} — ${s.activity} | ${formatVnd(s.costVnd)}`);
      });
      lines.push("");
    });
    if (plan.tips?.length) {
      lines.push("Mẹo hay:\n" + plan.tips.map((t) => `• ${t}`).join("\n"));
    }
    return lines.join("\n");
  }

  function renderPlan(plan, speedText) {
    if (!plannerResultEl) return;
    const daysHtml = (plan.days || [])
      .map((d) => {
        const dayTotal = (d.slots || []).reduce((acc, s) => acc + (Number(s.costVnd) || 0), 0);
        const slotsHtml = (d.slots || [])
          .map(
            (s) => `
            <div class="aiv-slot">
              <div class="aiv-slot-time">
                <div>${esc(s.time || s.period)}</div>
                ${s.period && s.time ? `<div style="font-size:10.5px;opacity:0.65;font-weight:500">${esc(s.period)}</div>` : ""}
              </div>
              <div class="aiv-slot-info">
                <div class="aiv-slot-place">${esc(s.place)}</div>
                ${s.address ? `<div style="font-size:11.5px;opacity:0.68;margin-bottom:3px">📍 ${esc(s.address)}</div>` : ""}
                <div class="aiv-slot-act">${esc(s.activity)}</div>
                <div class="aiv-slot-foot">
                  <span><strong>${esc(formatVnd(s.costVnd))}</strong></span>
                  <a class="aiv-slot-link" href="${esc(s.mapsUrl)}" target="_blank" rel="noopener noreferrer">Mở Google Maps ↗</a>
                </div>
              </div>
            </div>
          `
          )
          .join("");
        return `
          <section class="aiv-day-card">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px">
              <h4 class="aiv-day-title" style="margin:0">Ngày ${d.day}: ${esc(d.theme)}</h4>
              <span style="font-size:11.5px;opacity:0.7;white-space:nowrap">${esc(formatVnd(dayTotal))}</span>
            </div>
            ${slotsHtml}
          </section>
        `;
      })
      .join("");

    const tipsHtml =
      plan.tips && plan.tips.length
        ? `<div class="aiv-vcard" style="margin-bottom:10px">
            <div class="aiv-vcard-title">Mẹo di chuyển &amp; tiết kiệm</div>
            <ul style="margin:6px 0 0 18px;padding:0;font-size:12.5px;line-height:1.5;opacity:0.85">
              ${plan.tips.map((t) => `<li>${esc(t)}</li>`).join("")}
            </ul>
          </div>`
        : "";

    plannerResultEl.innerHTML = `
      <div class="aiv-plan-header">
        <h3>${esc(plan.title)}</h3>
        <p>${esc(plan.summary)}</p>
        <p style="margin-top:6px;font-weight:700">Tổng dự kiến: ${esc(formatVnd(plan.totalEstimatedVnd))} • ${esc(speedText)}</p>
      </div>
      ${daysHtml}
      ${tipsHtml}
      <div class="aiv-vcard-actions">
        <button type="button" class="aiv-btn aiv-btn-primary" id="btnCopyPlan">Sao chép lịch trình</button>
        <button type="button" class="aiv-btn" id="btnRegenPlan">Tạo phương án khác</button>
      </div>
    `;

    const btnCopy = document.getElementById("btnCopyPlan");
    if (btnCopy) {
      btnCopy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(planToPlainText(plan));
          btnCopy.textContent = "Đã sao chép ✓";
          setTimeout(() => (btnCopy.textContent = "Sao chép lịch trình"), 1800);
        } catch (_) {}
      });
    }
    const btnRegen = document.getElementById("btnRegenPlan");
    if (btnRegen) {
      btnRegen.addEventListener("click", () => submitPlanner(true));
    }
  }

  async function submitPlanner(force) {
    if (!plannerForm || !plannerSubmitBtn) return;
    const payload = {
      city: document.getElementById("planCity")?.value || "Đà Nẵng – Hội An",
      days: Number(document.getElementById("planDays")?.value) || 2,
      budget: Number(document.getElementById("planBudget")?.value) || 1500000,
      people: Number(document.getElementById("planPeople")?.value) || 2,
      style: document.getElementById("planStyle")?.value || "Tự túc",
      transport: document.getElementById("planTransport")?.value || "Xe máy / Grab",
      interests: document.getElementById("planInterests")?.value || "Ăn uống đặc sản, chụp ảnh, biển, workshop",
      force: Boolean(force)
    };

    const start = performance.now();
    plannerSubmitBtn.disabled = true;
    plannerSubmitBtn.textContent = "Đang tạo lịch trình chi tiết...";
    if (plannerResultEl) {
      plannerResultEl.innerHTML = `<div class="aiv-empty">Đang tối ưu tuyến đường theo cụm &amp; ngân sách thực tế...</div>`;
    }

    try {
      let data = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 22000);
        try {
          const res = await fetch("/api/travel-planner", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
          clearTimeout(timer);
          const json = await res.json();
          if (res.ok && Array.isArray(json.days) && json.days.length) {
            data = json;
            break;
          }
        } catch (err) {
          clearTimeout(timer);
          if (attempt === 1) throw err;
        }
      }

      if (!data) throw new Error("Không thể tạo lịch trình lúc này, bạn thử bấm Tạo lại nhé.");

      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      const speedLabel = data._cached
        ? `Tức thì (${elapsed}s • Cache)`
        : data._provider === "smart-local-engine"
        ? `Tạo trong ${elapsed}s • Tuyến chuẩn`
        : `Tạo trong ${elapsed}s`;

      try {
        localStorage.setItem(SAVED_PLAN_KEY, JSON.stringify(data));
      } catch (_) {}
      renderPlan(data, speedLabel);
    } catch (err) {
      if (plannerResultEl) {
        plannerResultEl.innerHTML = `<div class="aiv-empty">${esc(
          err?.name === "AbortError" ? "Mạng hơi chậm, bạn bấm Tạo lại nhé!" : err.message
        )}</div>`;
      }
    } finally {
      plannerSubmitBtn.disabled = false;
      plannerSubmitBtn.textContent = "Tạo lịch trình AI";
    }
  }

  if (btnOpenPlanner) btnOpenPlanner.addEventListener("click", openPlannerModal);
  if (plannerModal) {
    plannerModal.querySelectorAll("[data-planner-close]").forEach((el) => {
      el.addEventListener("click", closePlannerModal);
    });
  }
  if (plannerForm) {
    plannerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      submitPlanner(false);
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && plannerModal && !plannerModal.hidden) closePlannerModal();
  });
})();
