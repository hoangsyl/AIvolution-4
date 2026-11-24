// AIvolution Module: Dự báo Thời tiết GPS 7 ngày & Biểu đồ mưa
// ==========================================
// 4. THỜI TIẾT ĐÀ NẴNG – HỘI AN (7 NGÀY + BIỂU ĐỒ MƯA) & CHATBOT
// ==========================================
const WEATHER_CITIES = {
  danang: { id: "danang", name: "Đà Nẵng", lat: 16.0544, lng: 108.2022 },
  hoian: { id: "hoian", name: "Hội An", lat: 15.8801, lng: 108.338 }
};

let weatherState = {
  cityId: "hoian",
  selectedDayIdx: 0,
  cache: {}
};

function interpretWeatherCode(code) {
  if (code === 0) return "Trời quang đãng";
  if ([1, 2].includes(code)) return "Ít mây, khô ráo";
  if (code === 3) return "Nhiều mây";
  if ([45, 48].includes(code)) return "Có sương mù";
  if ([51, 53, 55].includes(code)) return "Mưa phùn nhẹ";
  if ([61, 63, 80, 81].includes(code)) return "Có mưa rào";
  if ([65, 82].includes(code)) return "Mưa to";
  if ([95, 96, 99].includes(code)) return "Mưa dông";
  return "Thời tiết ổn định";
}

function isRainWeatherCode(code) {
  return [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code);
}

function getWindDirectionLabel(deg) {
  const dirs = ["B", "ĐB", "Đ", "ĐN", "N", "TN", "T", "TB"];
  const n = Number(deg);
  if (!Number.isFinite(n)) return "ĐB";
  return dirs[Math.round((n % 360) / 45) % 8];
}

function formatIsoTimeHHMM(isoStr) {
  if (!isoStr || !String(isoStr).includes("T")) return "--:--";
  return String(isoStr).split("T")[1].slice(0, 5);
}

function getVnWeekdayShort(dateStr, idx) {
  if (idx === 0) return "H.nay";
  const d = new Date(`${dateStr}T12:00:00`);
  const labels = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  return labels[d.getDay()] || dateStr.slice(5);
}

function getVnWeekdayLong(dateStr, idx) {
  if (idx === 0) return "Hôm nay";
  const d = new Date(`${dateStr}T12:00:00`);
  const labels = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
  return labels[d.getDay()] || dateStr;
}

function getWeatherIconSvg(code, size = 28, isDay = 1) {
  const storm = [95, 96, 99].includes(code);
  const rain = [51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code);
  const cloudy = [3, 45, 48].includes(code);
  const partly = [1, 2].includes(code);

  if (storm) {
    return `<svg class="wx-anim-icon wx-is-storm" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path class="wx-cloud" d="M9 21h14a5 5 0 0 0 .8-9.94A7 7 0 0 0 10.2 9.4 4.5 4.5 0 0 0 9 21Z" fill="#CBD5E1"/>
      <path class="wx-bolt" d="M16 19l-2.5 5h2.4l-1.1 4.5L20 22h-2.5L19 19h-3Z" fill="#FACC15"/>
      <path class="wx-drop wx-drop-1" d="M10.5 23l-1 3.5" stroke="#38BDF8" stroke-width="2" stroke-linecap="round"/>
      <path class="wx-drop wx-drop-2" d="M22 23l-1 3.5" stroke="#38BDF8" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }
  if (rain) {
    return `<svg class="wx-anim-icon wx-is-rain" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path class="wx-cloud" d="M9 20h14a5 5 0 0 0 .8-9.94A7 7 0 0 0 10.2 8.4 4.5 4.5 0 0 0 9 20Z" fill="#E2E8F0"/>
      <path class="wx-drop wx-drop-1" d="M11 22.5l-1.2 4" stroke="#38BDF8" stroke-width="2.2" stroke-linecap="round"/>
      <path class="wx-drop wx-drop-2" d="M16 22.5l-1.2 4" stroke="#38BDF8" stroke-width="2.2" stroke-linecap="round"/>
      <path class="wx-drop wx-drop-3" d="M21 22.5l-1.2 4" stroke="#38BDF8" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
  }
  if (cloudy) {
    return `<svg class="wx-anim-icon wx-is-cloudy" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path class="wx-cloud" d="M8.5 23h15a5 5 0 0 0 .7-9.95A7.2 7.2 0 0 0 10 11.4 4.8 4.8 0 0 0 8.5 23Z" fill="#CBD5E1"/>
    </svg>`;
  }
  if (partly) {
    return `<svg class="wx-anim-icon wx-is-partly" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      ${
        isDay
          ? `<circle class="wx-sun-orb" cx="20.5" cy="11.5" r="5" fill="#FBBF24"/>`
          : `<path class="wx-moon-orb" d="M22.5 7.5a5.2 5.2 0 1 0 3.2 9.3A5.8 5.8 0 0 1 22.5 7.5Z" fill="#E2E8F0"/>`
      }
      <path class="wx-cloud" d="M8 24h14a4.5 4.5 0 0 0 .6-8.96A6.2 6.2 0 0 0 10.4 13.8 4.2 4.2 0 0 0 8 24Z" fill="#F8FAFC"/>
    </svg>`;
  }
  return `<svg class="wx-anim-icon wx-is-clear" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    ${
      isDay
        ? `<g class="wx-sun-spin">
             <circle cx="16" cy="16" r="6.5" fill="#FBBF24"/>
             <path d="M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2.2 2.2M22.3 22.3l2.2 2.2M24.5 7.5l-2.2 2.2M9.7 22.3l-2.2 2.2" stroke="#FBBF24" stroke-width="2" stroke-linecap="round"/>
           </g>`
        : `<path class="wx-moon-orb" d="M19.5 7.2a8.5 8.5 0 1 0 5.3 15.1A9.2 9.2 0 0 1 19.5 7.2Z" fill="#E2E8F0"/>`
    }
  </svg>`;
}

function buildSmoothWavePaths(points, baseY) {
  if (!points.length) return { line: "", area: "" };
  let line = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = Math.min(baseY, Math.max(24, p1.y + (p2.y - p0.y) / 6));
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = Math.min(baseY, Math.max(24, p2.y - (p3.y - p1.y) / 6));

    line += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  const area = `${line} L ${last.x.toFixed(1)} ${baseY} L ${points[0].x.toFixed(1)} ${baseY} Z`;
  return { line, area };
}

function pickHourlyRainSlots(hourly, dateStr, isToday) {
  const times = hourly?.time || [];
  const precips = hourly?.precipitation || [];
  const probs = hourly?.precipitation_probability || [];
  const winds = hourly?.wind_speed_10m || [];
  const windDirs = hourly?.wind_direction_10m || [];

  const dayIndices = [];
  for (let i = 0; i < times.length; i++) {
    if (String(times[i]).startsWith(dateStr)) dayIndices.push(i);
  }
  if (!dayIndices.length) return [];

  let chosen = [];
  if (isToday) {
    const curHour = new Date().getHours();
    const startPos = Math.max(0, Math.min(dayIndices.length - 6, curHour));
    chosen = dayIndices.slice(startPos, startPos + 6);
  } else {
    const baseHours = [6, 9, 12, 15, 18, 21];
    let peakIdx = dayIndices[0];
    let peakScore = -1;
    dayIndices.forEach((idx) => {
      const score = (precips[idx] || 0) * 100 + (probs[idx] || 0);
      if (score > peakScore) {
        peakScore = score;
        peakIdx = idx;
      }
    });

    chosen = baseHours.map((h) => dayIndices[Math.min(dayIndices.length - 1, h)]);
    if (!chosen.includes(peakIdx)) {
      const peakHour = Number(String(times[peakIdx]).slice(11, 13)) || 12;
      let nearestSlot = 0;
      let minDiff = 99;
      baseHours.forEach((h, slotIdx) => {
        if (Math.abs(h - peakHour) < minDiff) {
          minDiff = Math.abs(h - peakHour);
          nearestSlot = slotIdx;
        }
      });
      chosen[nearestSlot] = peakIdx;
    }
  }

  return chosen.map((idx, pos) => {
    const hhmm = formatIsoTimeHHMM(times[idx]);
    return {
      label: isToday && pos === 0 ? "Bây giờ" : hhmm,
      time: hhmm,
      mm: Number((precips[idx] ?? 0).toFixed(1)),
      prob: Math.round(probs[idx] ?? 0),
      wind: Math.round(winds[idx] ?? 0),
      windDir: windDirs[idx] ?? 45
    };
  });
}

function renderWeatherContent(data, city) {
  const body = document.getElementById("weatherBody");
  const cur = data.current || {};
  const daily = data.daily || {};
  const hourly = data.hourly || {};

  const dayTimes = daily.time || [];
  const selIdx = Math.min(Math.max(0, weatherState.selectedDayIdx), Math.max(0, dayTimes.length - 1));
  const isToday = selIdx === 0;
  const selDate = dayTimes[selIdx] || "";

  const selCode = isToday ? (cur.weather_code ?? daily.weather_code?.[0] ?? 0) : (daily.weather_code?.[selIdx] ?? 0);
  const selTemp = isToday
    ? Math.round(cur.temperature_2m ?? daily.temperature_2m_max?.[0] ?? 26)
    : Math.round(((daily.temperature_2m_max?.[selIdx] ?? 28) + (daily.temperature_2m_min?.[selIdx] ?? 22)) / 2);
  const selHi = Math.round(daily.temperature_2m_max?.[selIdx] ?? selTemp);
  const selLo = Math.round(daily.temperature_2m_min?.[selIdx] ?? selTemp - 4);
  const selWind = Math.round(isToday ? (cur.wind_speed_10m ?? 10) : (daily.wind_speed_10m_max?.[selIdx] ?? 12));
  const selWindDeg = cur.wind_direction_10m ?? 45;
  const selHumidity = Math.round(cur.relative_humidity_2m ?? 78);
  const selSunrise = formatIsoTimeHHMM(daily.sunrise?.[selIdx]);
  const selSunset = formatIsoTimeHHMM(daily.sunset?.[selIdx]);
  const selRainProb = Math.round(daily.precipitation_probability_max?.[selIdx] ?? 0);
  const selRainSum = Number((daily.precipitation_sum?.[selIdx] ?? 0).toFixed(1));
  const isDayFlag = isToday ? (cur.is_day ?? 1) : 1;

  const rainDays = [];
  const dryDays = [];
  dayTimes.forEach((dt, i) => {
    const prob = Math.round(daily.precipitation_probability_max?.[i] ?? 0);
    const sum = Number(daily.precipitation_sum?.[i] ?? 0);
    const rainy = prob >= 45 || sum >= 1 || isRainWeatherCode(daily.weather_code?.[i]);
    const lbl = getVnWeekdayShort(dt, i);
    if (rainy) rainDays.push(lbl);
    else dryDays.push(lbl);
  });

  const summaryLine =
    `7 ngày tới tại ${city.name}: ` +
    (rainDays.length ? `Mưa ${rainDays.length} ngày (${rainDays.join(", ")})` : "Không có ngày mưa lớn") +
    ` • ` +
    (dryDays.length ? `Khô ráo ${dryDays.length} ngày (${dryDays.join(", ")})` : "Mưa rải rác cả tuần");

  const nowStr = new Date().toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

  const daysHtml = dayTimes
    .slice(0, 7)
    .map((dt, i) => {
      const code = daily.weather_code?.[i] ?? 0;
      const hi = Math.round(daily.temperature_2m_max?.[i] ?? 28);
      const lo = Math.round(daily.temperature_2m_min?.[i] ?? 22);
      const prob = Math.round(daily.precipitation_probability_max?.[i] ?? 0);
      const sum = Number(daily.precipitation_sum?.[i] ?? 0);
      const rainy = prob >= 45 || sum >= 1 || isRainWeatherCode(code);
      const dayShort = getVnWeekdayShort(dt, i);
      const dayLong = getVnWeekdayLong(dt, i);
      const active = i === selIdx;

      return `
        <button
          type="button"
          class="wx-day-btn"
          data-wx-day="${i}"
          aria-pressed="${active ? "true" : "false"}"
          aria-label="${dayLong}, cao ${hi} độ, thấp ${lo} độ, ${rainy ? `có mưa ${prob}%` : "không mưa"}"
        >
          <span class="wx-day-name">${dayShort}</span>
          <span class="wx-day-icon">${getWeatherIconSvg(code, 26, 1)}</span>
          <span class="wx-day-temps tabular-nums">
            <span class="wx-day-hi">${hi}°</span>
            <span class="wx-day-lo">${lo}°</span>
          </span>
          <span class="wx-day-rain-tag tabular-nums ${rainy ? "is-rain" : "is-dry"}">
            ${rainy ? `${prob}%` : "Khô"}
          </span>
        </button>
      `;
    })
    .join("");

  const slots = pickHourlyRainSlots(hourly, selDate, isToday);
  const svgW = 360;
  const svgH = 112;
  const baseY = 104;
  const topY = 34;

  const maxMm = slots.length ? Math.max(0, ...slots.map((s) => s.mm)) : 0;
  const useMmScale = maxMm >= 0.2;
  const scaleMax = useMmScale
    ? Math.max(maxMm, 1.5)
    : Math.max(100, ...(slots.length ? slots.map((s) => s.prob) : [100]));

  let peakSlotIdx = 0;
  let secondSlotIdx = -1;
  slots.forEach((s, i) => {
    const val = useMmScale ? s.mm : s.prob;
    const peakVal = useMmScale ? slots[peakSlotIdx].mm : slots[peakSlotIdx].prob;
    if (val > peakVal) peakSlotIdx = i;
  });

  if (slots.length >= 4) {
    let bestAltVal = 0;
    slots.forEach((s, i) => {
      if (Math.abs(i - peakSlotIdx) < 2) return;
      const val = useMmScale ? s.mm : s.prob;
      if (val > bestAltVal && (useMmScale ? s.mm >= 0.2 : s.prob >= 25)) {
        bestAltVal = val;
        secondSlotIdx = i;
      }
    });
  }

  const chartPoints = slots.map((s, i) => {
    const x = slots.length > 1 ? 14 + (i * (svgW - 28)) / (slots.length - 1) : svgW / 2;
    const rawVal = useMmScale ? s.mm : s.prob;
    const ratio = scaleMax > 0 ? Math.min(1, rawVal / scaleMax) : 0;
    const y = baseY - 12 - ratio * (baseY - 12 - topY);
    return { x, y, slot: s };
  });

  const { line: waveLine, area: waveArea } = buildSmoothWavePaths(chartPoints, baseY);

  const highlightIndices = slots.length ? [peakSlotIdx] : [];
  if (secondSlotIdx !== -1) highlightIndices.push(secondSlotIdx);

  const markersSvg = highlightIndices
    .map((idx) => {
      const pt = chartPoints[idx];
      if (!pt) return "";
      const isPeak = idx === peakSlotIdx;
      const labelText = useMmScale
        ? `${pt.slot.mm.toFixed(1).replace(".", ",")} mm`
        : `${pt.slot.prob}%`;
      const pillW = Math.max(48, labelText.length * 7.2 + 14);
      const pillX = Math.min(svgW - pillW - 4, Math.max(4, pt.x - pillW / 2));
      const pillY = Math.max(4, pt.y - 29);

      return `
        <g>
          <rect x="${pillX.toFixed(1)}" y="${pillY.toFixed(1)}" width="${pillW.toFixed(1)}" height="20" rx="6"
            fill="${isPeak ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.14)"}" />
          <text x="${(pillX + pillW / 2).toFixed(1)}" y="${(pillY + 13.5).toFixed(1)}"
            text-anchor="middle" fill="#FFFFFF" font-size="11" font-weight="${isPeak ? "700" : "500"}">
            ${labelText}
          </text>
          <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.5" fill="#141926" stroke="#7DD3FC" stroke-width="2.5"/>
        </g>
      `;
    })
    .join("");

  const peakSlot = slots[peakSlotIdx] || { time: "--:--", mm: 0, prob: selRainProb };
  const peakBannerText =
    peakSlot.mm > 0
      ? `Mưa cao nhất lúc ${peakSlot.time}: ${peakSlot.mm.toFixed(1).replace(".", ",")} mm (${peakSlot.prob}%)`
      : peakSlot.prob >= 35
      ? `Khả năng mưa cao nhất lúc ${peakSlot.time} (${peakSlot.prob}%)`
      : `Không có mưa đáng kể trong khung giờ này (${getVnWeekdayLong(selDate, selIdx)})`;

  const windDirText = getWindDirectionLabel(selWindDeg);

  let advice = `${getVnWeekdayLong(selDate, selIdx)} tại ${city.name} tỷ lệ mưa thấp (${selRainProb}%), rất thích hợp dạo phố cổ, đi biển và chụp ảnh ngoài trời.`;
  if (selRainProb >= 65 || selRainSum >= 8) {
    advice = `${getVnWeekdayLong(selDate, selIdx)} tại ${city.name} khả năng mưa cao (${selRainProb}%, tổng ~${selRainSum.toFixed(1).replace(".", ",")} mm). Nên ưu tiên quán cà phê, bảo tàng hoặc workshop trong nhà.`;
  } else if (selRainProb >= 35 || selRainSum >= 1) {
    advice = `${getVnWeekdayLong(selDate, selIdx)} tại ${city.name} có khả năng mưa rải rác (${selRainProb}%). Bạn nên mang theo dù hoặc áo mưa mỏng khi di chuyển.`;
  }

  body.innerHTML = `
    <div class="wx-stack">
      <section class="wx-hero-card" aria-label="Tổng quan và dự báo 7 ngày tại ${escapeHtml(city.name)}">
        <div class="wx-current-panel">
          <div class="wx-current-top">
            <div class="wx-main-icon">${getWeatherIconSvg(selCode, 60, isDayFlag)}</div>
            <div class="wx-temp-wrap">
              <div class="wx-temp-main tabular-nums">${selTemp}°C</div>
              <div class="wx-temp-hl tabular-nums">
                <span>C ${selHi}°</span>
                <span>•</span>
                <span>T ${selLo}°</span>
              </div>
            </div>
          </div>

          <div class="wx-current-mid">
            <div>
              <h3 class="wx-cond-title">${escapeHtml(interpretWeatherCode(selCode))}</h3>
              <p class="wx-cond-sub tabular-nums">${escapeHtml(getVnWeekdayLong(selDate, selIdx))} • Mưa ${selRainProb}%</p>
            </div>
            <div class="wx-sun-times tabular-nums">
              <div class="wx-sun-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2" aria-hidden="true"><path d="M12 2v4M4.93 10.93l1.41 1.41M2 18h20M19.07 10.93l-1.41 1.41M16 18a4 4 0 0 0-8 0"/></svg>
                <span>${selSunrise}</span>
              </div>
              <div class="wx-sun-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FB923C" stroke-width="2" aria-hidden="true"><path d="M12 10V2M4.93 10.93l1.41 1.41M2 18h20M19.07 10.93l-1.41 1.41M16 18a4 4 0 0 0-8 0"/></svg>
                <span>${selSunset}</span>
              </div>
            </div>
          </div>

          <div class="wx-current-metrics">
            <div class="wx-metric-item">
              <svg class="wx-metric-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>
              <div>
                <span class="wx-metric-label">Gió</span>
                <span class="wx-metric-val tabular-nums">${selWind} km/h</span>
              </div>
            </div>
            <div class="wx-metric-item">
              <svg class="wx-metric-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
              <div>
                <span class="wx-metric-label">Độ ẩm</span>
                <span class="wx-metric-val tabular-nums">${selHumidity}%</span>
              </div>
            </div>
          </div>
        </div>

        <div class="wx-forecast-panel">
          <div class="wx-forecast-head">
            <div class="wx-city-switch" role="group" aria-label="Chọn khu vực Đà Nẵng hoặc Hội An">
              <button type="button" class="wx-city-btn" data-wx-city="hoian" aria-pressed="${city.id === "hoian" ? "true" : "false"}">Hội An</button>
              <button type="button" class="wx-city-btn" data-wx-city="danang" aria-pressed="${city.id === "danang" ? "true" : "false"}">Đà Nẵng</button>
            </div>
            <span class="wx-updated-time tabular-nums">${nowStr}</span>
          </div>

          <p class="wx-rain-summary">${escapeHtml(summaryLine)}</p>

          <div class="wx-days-grid">
            ${daysHtml}
          </div>
        </div>
      </section>

      <section class="wx-rain-card" aria-label="Biểu đồ lượng mưa theo giờ tại ${escapeHtml(city.name)}">
        <div class="wx-rain-top">
          <div>
            <div class="wx-rain-loc">${escapeHtml(city.name)}</div>
            <div class="wx-rain-temp-row tabular-nums">
              <span class="wx-rain-temp">${selTemp}°</span>
              <span class="wx-rain-hl">
                <span>${selHi}°</span>
                <span>${selLo}°</span>
              </span>
            </div>
          </div>

          <div class="wx-rain-wind">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4ADE80" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
            </svg>
            <div class="wx-wind-meta tabular-nums">
              <span class="wx-wind-dir">
                ${windDirText}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="transform:rotate(${Math.round(selWindDeg)}deg)" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v8m0 0-3-3m3 3 3-3"/>
                </svg>
              </span>
              <span class="wx-wind-spd">${selWind} km/h</span>
            </div>
          </div>

          <div class="wx-rain-status-icon">${getWeatherIconSvg(selCode, 40, isDayFlag)}</div>
        </div>

        <div class="wx-peak-banner tabular-nums">
          <span>${escapeHtml(peakBannerText)}</span>
        </div>

        <div class="wx-chart-wrap">
          <svg class="wx-chart-svg" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${escapeHtml(peakBannerText)}">
            <defs>
              <linearGradient id="wxWaveFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#38BDF8" stop-opacity="0.02"/>
              </linearGradient>
            </defs>
            <path d="${waveArea}" fill="url(#wxWaveFill)" />
            <path d="${waveLine}" fill="none" stroke="#60A5FA" stroke-width="2.5" stroke-linecap="round" />
            ${markersSvg}
          </svg>
          <div class="wx-chart-times tabular-nums">
            ${slots.map((s) => `<span>${escapeHtml(s.label)}</span>`).join("")}
          </div>
        </div>
      </section>

      <div class="wx-advice-card">
        <strong>Gợi ý di chuyển:</strong> ${escapeHtml(advice)}
      </div>
    </div>
  `;

  body.querySelectorAll("[data-wx-city]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextCity = btn.dataset.wxCity;
      if (nextCity && WEATHER_CITIES[nextCity] && nextCity !== weatherState.cityId) {
        weatherState.cityId = nextCity;
        renderWeatherView(false);
      }
    });
  });

  body.querySelectorAll("[data-wx-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.wxDay);
      if (Number.isFinite(idx) && idx !== weatherState.selectedDayIdx) {
        weatherState.selectedDayIdx = idx;
        renderWeatherContent(data, city);
      }
    });
  });
}

async function renderWeatherView(forceRefresh = false) {
  const body = document.getElementById("weatherBody");
  const city = WEATHER_CITIES[weatherState.cityId] || WEATHER_CITIES.hoian;
  const cached = weatherState.cache[city.id];

  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
    renderWeatherContent(cached.data, city);
    return;
  }

  body.setAttribute("aria-busy", "true");
  body.innerHTML = `<div class="wx-stack"><div class="wx-skeleton"></div><div class="wx-skeleton" style="height:160px"></div></div>`;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lng}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day` +
      `&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,precipitation_sum,wind_speed_10m_max` +
      `&timezone=Asia%2FBangkok&forecast_days=7`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("Không tải được dữ liệu thời tiết.");
    const data = await res.json();

    weatherState.cache[city.id] = { data, fetchedAt: Date.now() };
    renderWeatherContent(data, city);
  } catch (err) {
    body.innerHTML = `
      <div class="error-panel">
        Không lấy được thời tiết ${escapeHtml(city.name)}: ${escapeHtml(err.message)}
        <div style="margin-top:10px">
          <button type="button" class="btn-pill btn-primary" id="wxRetryBtn">Thử tải lại</button>
        </div>
      </div>
    `;
    const retryBtn = document.getElementById("wxRetryBtn");
    if (retryBtn) retryBtn.addEventListener("click", () => renderWeatherView(true));
  } finally {
    body.setAttribute("aria-busy", "false");
  }
}
