const form = document.getElementById("analyze-form");
const statusEl = document.getElementById("status");

const instrumentNameEl = document.getElementById("instrument-name");
const instrumentSymbolEl = document.getElementById("instrument-symbol");
const lastPriceEl = document.getElementById("last-price");
const currencyTagEl = document.getElementById("currency-tag");
const trendBadgeEl = document.getElementById("trend-badge");
const trendScoreEl = document.getElementById("trend-score");
const primaryForecastEl = document.getElementById("primary-forecast");
const primaryChangeEl = document.getElementById("primary-change");
const primaryRangeEl = document.getElementById("primary-range");
const probUpEl = document.getElementById("prob-up");
const multiScoreEl = document.getElementById("multi-score");
const multiConfidenceEl = document.getElementById("multi-confidence");
const multiBadgeEl = document.getElementById("multi-badge");
const multiDirectionEl = document.getElementById("multi-direction");
const multiExplainEl = document.getElementById("multi-explain");

const projectionsBody = document.querySelector("#projections-table tbody");
const indicatorsBody = document.querySelector("#indicators-table tbody");
const componentsBody = document.querySelector("#components-table tbody");
const chartWrapEl = document.getElementById("chart-wrap");
const reasonsEl = document.getElementById("trend-reasons");
const newsEl = document.getElementById("news-list");
const sourcesEl = document.getElementById("source-list");
const assumptionsEl = document.getElementById("assumptions");
const fundamentalListEl = document.getElementById("fundamental-list");
const optionsListEl = document.getElementById("options-list");
const macroListEl = document.getElementById("macro-list");
const onchainListEl = document.getElementById("onchain-list");
const vnlocalListEl = document.getElementById("vnlocal-list");
const companyInfoEl = document.getElementById("company-info");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const symbol = cleanText(document.getElementById("symbol").value).toUpperCase();
  const market = cleanText(document.getElementById("market").value).toUpperCase() || "AUTO";
  const horizonValue = Number.parseInt(document.getElementById("horizon-value").value, 10);
  const horizonUnit = cleanText(document.getElementById("horizon-unit").value).toLowerCase() || "d";
  const lookbackDays = Number.parseInt(document.getElementById("lookback").value, 10);
  const includeNews = document.getElementById("include-news").checked;

  if (!symbol) {
    updateStatus("Cần nhập mã tài sản.", true);
    return;
  }

  if (!Number.isFinite(horizonValue) || horizonValue < 1) {
    updateStatus("Giá trị mốc thời gian phải lớn hơn hoặc bằng 1.", true);
    return;
  }

  updateStatus("Đang thu thập dữ liệu và phân tích...");
  setLoadingState();

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        symbol,
        market,
        horizon_value: horizonValue,
        horizon_unit: horizonUnit,
        horizons: `${horizonValue}${horizonUnit}`,
        lookback_days: Number.isFinite(lookbackDays) ? lookbackDays : 365,
        include_news: includeNews
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Yêu cầu lỗi (HTTP ${res.status}).`);
    }

    renderDashboard(data);
    updateStatus("Hoàn tất.");
  } catch (error) {
    updateStatus(error && error.message ? error.message : "Có lỗi không xác định.", true);
    renderErrorState();
  }
});

function renderDashboard(data) {
  const instrument = data.instrument || {};
  const price = data.price || {};
  const analysis = data.analysis || {};
  const primary = analysis.primary || null;
  const trend = analysis.trend || {};
  const currency = resolveCurrency(instrument, price);

  instrumentNameEl.textContent = cleanText(instrument.name) || "-";
  instrumentSymbolEl.textContent = [
    cleanText(instrument.symbol),
    cleanText(instrument.exchange)
  ]
    .filter(Boolean)
    .join(" | ") || "-";

  lastPriceEl.textContent = formatCurrency(price.last, currency);
  currencyTagEl.textContent = [currency, cleanText(price.as_of)].filter(Boolean).join(" | ");

  if (primary) {
    primaryForecastEl.textContent = `${primary.label}: ${formatCurrency(
      primary.expected_price,
      currency
    )}`;
    primaryChangeEl.textContent = `${formatSignedCurrency(
      primary.expected_delta,
      currency
    )} (${formatSignedPercent(primary.expected_pct)})`;
    primaryRangeEl.textContent = `Biên độ: ${formatCurrency(
      primary.range_low,
      currency
    )} -> ${formatCurrency(primary.range_high, currency)}`;
    probUpEl.textContent = `Khả năng tăng: ${formatPercent(primary.probability_up)}`;

    const trendText = [
      primary.signal?.label || "-",
      mapDirectionVi(trend.direction)
    ].join(" | ");
    trendBadgeEl.textContent = trendText;
    applySignalClass(trendBadgeEl, primary.signal?.key || "flat");
  } else {
    primaryForecastEl.textContent = "-";
    primaryChangeEl.textContent = "-";
    primaryRangeEl.textContent = "-";
    probUpEl.textContent = "-";
    trendBadgeEl.textContent = "Không đủ dữ liệu";
    applySignalClass(trendBadgeEl, "flat");
  }

  trendScoreEl.textContent = `Điểm xu hướng: ${formatNumber(
    trend.score,
    2
  )} | cường độ: ${mapStrengthVi(trend.strength)}`;

  renderCompanyInfo(instrument, data.advanced?.fundamentals || {}, currency);
  renderProjections(analysis.projections || [], currency);
  renderIndicators(analysis.indicators || {}, currency);
  renderMultiSource(analysis.multi_source || {});
  renderReasons(trend.reasons || []);
  renderNews(data.news || []);
  renderAdvanced(data.advanced || {}, currency);
  renderSources(data.sources || {});
  renderChart(data.history || [], primary);

  const assumptions = Array.isArray(data.assumptions)
    ? data.assumptions.filter(Boolean)
    : [];
  assumptionsEl.textContent = assumptions.length
    ? `Lưu ý: ${assumptions.join(" | ")}`
    : "";
}

function renderCompanyInfo(instrument, fundamentals, currency) {
  const profile = fundamentals?.profile || {};
  const resolvedMarket = resolveMarketCode(instrument);
  const displayCurrency =
    cleanText(profile.currency || instrument.currency || currency).toUpperCase() || "USD";
  const rows = [
    metricLine("Tên công ty", profile.name || instrument.name || "-"),
    metricLine("Mã", instrument.symbol || instrument.requested_symbol || "-"),
    metricLine("Sàn", instrument.exchange || profile.exchange || "-"),
    metricLine("Thị trường", mapMarketVi(resolvedMarket)),
    metricLine("Đơn vị tiền tệ", displayCurrency),
    metricLine("Ngành", profile.industry || "-"),
    metricLine("Quốc gia", profile.country || "-"),
    metricLine("IPO", profile.ipo || "-"),
    metricLine("Vốn hóa", formatCurrency(profile.market_cap, displayCurrency))
  ];
  companyInfoEl.innerHTML = rows.join("");
}

function renderProjections(projections, currency) {
  if (!Array.isArray(projections) || projections.length === 0) {
    projectionsBody.innerHTML =
      '<tr><td colspan="6" class="empty">Không có dữ liệu dự báo.</td></tr>';
    return;
  }

  projectionsBody.innerHTML = projections
    .map((p) => {
      const signalKey = cleanText(p?.signal?.key) || "flat";
      return `
        <tr class="row-${escapeHtml(signalKey)}">
          <td>${escapeHtml(p.label || "-")}</td>
          <td>${escapeHtml(formatCurrency(p.expected_price, currency))}</td>
          <td>${escapeHtml(formatSignedCurrency(p.expected_delta, currency))} (${escapeHtml(
        formatSignedPercent(p.expected_pct)
      )})</td>
          <td>${escapeHtml(formatPercent(p.probability_up))}</td>
          <td>${escapeHtml(formatCurrency(p.range_low, currency))} -> ${escapeHtml(
        formatCurrency(p.range_high, currency)
      )}</td>
          <td><span class="signal-pill signal-${escapeHtml(signalKey)}">${escapeHtml(
        p?.signal?.label || "-"
      )}</span></td>
        </tr>
      `;
    })
    .join("");
}

function renderIndicators(indicators, currency) {
  const rows = [
    ["SMA20", indicators.sma20],
    ["SMA50", indicators.sma50],
    ["EMA20", indicators.ema20],
    ["RSI14", indicators.rsi14],
    ["MACD", indicators.macd],
    ["MACD Tín hiệu", indicators.macd_signal],
    ["MACD Histogram", indicators.macd_histogram],
    ["Bollinger Trên", indicators.bollinger_upper],
    ["Bollinger Giữa", indicators.bollinger_mid],
    ["Bollinger Dưới", indicators.bollinger_lower],
    ["ATR14", indicators.atr14],
    ["Động lượng 10", indicators.momentum10],
    ["Biến động năm", formatPercent(indicators.volatility_annual)],
    ["Độ trôi năm", formatSignedPercent(indicators.drift_annual)],
    ["Điểm xu hướng", formatNumber(indicators.trend_score, 4)]
  ];

  indicatorsBody.innerHTML = rows
    .map(([name, val]) => {
      const display =
        typeof val === "string"
          ? val
          : Number.isFinite(val)
          ? formatNumberSmart(name, val, currency)
          : "-";
      return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(display)}</td></tr>`;
    })
    .join("");
}

function renderMultiSource(multi) {
  const score = Number(multi.score);
  const confidence = Number(multi.confidence);
  const direction = cleanText(multi.direction || "");
  const signalKey = cleanText(multi?.signal?.key) || scoreToSignalKey(score);

  multiScoreEl.textContent = Number.isFinite(score) ? score.toFixed(3) : "-";
  multiConfidenceEl.textContent = `Độ tin cậy: ${
    Number.isFinite(confidence) ? `${(confidence * 100).toFixed(1)}%` : "-"
  }`;
  multiDirectionEl.textContent = [
    mapDirectionVi(direction),
    mapStrengthVi(multi.strength)
  ].join(" | ");
  multiBadgeEl.textContent = cleanText(multi?.signal?.label) || "Không có tín hiệu";
  applySignalClass(multiBadgeEl, signalKey);

  const explain = Array.isArray(multi.explanation)
    ? multi.explanation.filter(Boolean)
    : [];
  multiExplainEl.innerHTML = explain.length
    ? explain.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>Chưa có giải thích.</li>";

  const components = Array.isArray(multi.components)
    ? multi.components
    : [];
  if (components.length === 0) {
    componentsBody.innerHTML =
      '<tr><td colspan="5" class="empty">Không có thành phần điểm.</td></tr>';
    return;
  }

  componentsBody.innerHTML = components
    .map((c) => {
      const cKey = scoreToSignalKey(c.score);
      return `
        <tr class="row-${escapeHtml(cKey)}">
          <td>${escapeHtml(c.label || c.key || "-")}</td>
          <td>${escapeHtml(formatNumber(c.score, 3))}</td>
          <td>${escapeHtml(formatNumber(c.weight, 3))}</td>
          <td>${escapeHtml(formatNumber(c.contribution, 4))}</td>
          <td>${escapeHtml(String(c.raw ?? "-"))}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAdvanced(advanced, currency) {
  renderFundamentals(advanced.fundamentals || {}, currency);
  renderOptions(advanced.options || {});
  renderMacro(advanced.macro || {});
  renderOnchain(advanced.on_chain || {});
  renderVnLocal(advanced.vietnam_local || {});
}

function renderFundamentals(data, currency) {
  const profile = data.profile || {};
  const metrics = data.metrics || {};
  const signal = data.signal || {};
  const rows = [
    metricLine("Tín hiệu", signal.label || "Không có dữ liệu"),
    metricLine("Điểm", formatNumber(signal.score, 3)),
    metricLine("Tên", profile.name || "-"),
    metricLine("Ngành", profile.industry || "-"),
    metricLine("PE TTM", formatNumber(metrics.pe_ttm, 2)),
    metricLine("ROE TTM", formatSignedPercent(metrics.roe_ttm)),
    metricLine("Doanh thu YoY", formatSignedPercent(metrics.revenue_growth_yoy)),
    metricLine("Nợ/Vốn chủ", formatNumber(metrics.debt_to_equity, 2))
  ];
  fundamentalListEl.innerHTML = rows.join("");
}

function renderOptions(data) {
  const signal = data.signal || {};
  const rows = [
    metricLine("Tín hiệu", signal.label || "Không có dữ liệu"),
    metricLine("Điểm", formatNumber(signal.score, 3)),
    metricLine("Put/Call OI", formatNumber(signal.put_call_ratio_oi, 3)),
    metricLine("Put/Call Volume", formatNumber(signal.put_call_ratio_volume, 3)),
    metricLine("Call OI", formatNumber(signal.call_open_interest, 0)),
    metricLine("Put OI", formatNumber(signal.put_open_interest, 0))
  ];
  optionsListEl.innerHTML = rows.join("");
}

function renderMacro(data) {
  const signal = data.signal || {};
  const metrics = data.metrics || {};
  const rows = [
    metricLine("Tín hiệu", signal.label || "Không có dữ liệu"),
    metricLine("Điểm", formatNumber(signal.score, 3)),
    metricLine("Lãi suất điều hành", formatNumber(metrics.policy_rate, 2)),
    metricLine("Biến động lãi suất", formatSignedNumber(metrics.policy_rate_change, 2)),
    metricLine("Thất nghiệp", formatNumber(metrics.unemployment_rate, 2)),
    metricLine("Chênh lệch lợi suất 10Y2Y", formatNumber(metrics.yield_spread_10y2y, 2)),
    metricLine("VIX", formatNumber(metrics.vix, 2))
  ];
  macroListEl.innerHTML = rows.join("");
}

function renderOnchain(data) {
  const signal = data.signal || {};
  const metrics = data.metrics || {};
  const rows = [
    metricLine("Tín hiệu", signal.label || "Không có dữ liệu"),
    metricLine("Điểm", formatNumber(signal.score, 3)),
    metricLine("Coin", metrics.id || "-"),
    metricLine("Xếp hạng", formatNumber(metrics.market_cap_rank, 0)),
    metricLine("Thay đổi 7 ngày", formatSignedPercentRaw(metrics.price_change_7d_pct)),
    metricLine("Thay đổi 30 ngày", formatSignedPercentRaw(metrics.price_change_30d_pct)),
    metricLine("Vol/Cap", formatNumber(metrics.volume_to_market_cap, 3))
  ];
  onchainListEl.innerHTML = rows.join("");
}

function renderVnLocal(data) {
  const signal = data.signal || {};
  const gold = data.gold || {};
  const usdSjc = data.fx?.usd_sjc || {};
  const usdVcb = data.fx?.usd_vcb || {};

  const rows = [
    metricLine("Tín hiệu", signal.label || "Không có dữ liệu"),
    metricLine("Điểm", formatNumber(signal.score, 3)),
    metricLine("Vàng SJC", [gold.type_name, gold.branch_name].filter(Boolean).join(" | ") || "-"),
    metricLine("Giá mua vàng", formatCurrency(gold.buy, "VND")),
    metricLine("Giá bán vàng", formatCurrency(gold.sell, "VND")),
    metricLine("Spread vàng", formatSignedPercent(gold.spread_pct)),
    metricLine("USD VCB Mua/Bán", `${formatCurrency(usdVcb.buy, "VND")} / ${formatCurrency(usdVcb.sell, "VND")}`),
    metricLine("USD SJC Mua/Bán", `${formatCurrency(usdSjc.buy, "VND")} / ${formatCurrency(usdSjc.sell, "VND")}`)
  ];

  const notes = Array.isArray(signal.notes) ? signal.notes.filter(Boolean) : [];
  if (notes.length > 0) {
    rows.push(metricLine("Ghi chú", notes.join(" | ")));
  }

  vnlocalListEl.innerHTML = rows.join("");
}

function metricLine(label, value) {
  const display = value === null || value === undefined || value === "" ? "-" : value;
  return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(display)}</li>`;
}

function scoreToSignalKey(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return "flat";
  if (s >= 0.7) return "strong-up";
  if (s > 0.02) return "mild-up";
  if (s <= -0.7) return "strong-down";
  if (s < -0.02) return "mild-down";
  return "flat";
}

function mapDirectionVi(direction) {
  const raw = cleanText(direction).toLowerCase();
  if (raw === "bullish") return "TĂNG";
  if (raw === "bearish") return "GIẢM";
  return "ĐI NGANG";
}

function mapStrengthVi(strength) {
  const raw = cleanText(strength).toLowerCase();
  if (raw === "high") return "mạnh";
  if (raw === "medium") return "trung bình";
  if (raw === "low") return "thấp";
  return "-";
}

function mapMarketVi(market) {
  const raw = cleanText(market).toUpperCase();
  if (raw === "VN") return "Việt Nam";
  if (raw === "US") return "Mỹ";
  if (raw === "FX") return "Ngoại hối";
  if (raw === "CRYPTO") return "Tiền mã hóa";
  return "Tự động";
}

function formatNumberSmart(name, value, currency) {
  if (name.startsWith("RSI")) return formatNumber(value, 2);
  if (name.startsWith("Biến động") || name.startsWith("Độ trôi")) {
    return formatSignedPercent(value);
  }
  if (
    name.startsWith("SMA") ||
    name.startsWith("EMA") ||
    name.startsWith("Bollinger") ||
    name.startsWith("ATR") ||
    name.startsWith("Động lượng")
  ) {
    return formatCurrency(value, currency);
  }
  return formatNumber(value, 6);
}

function renderReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    reasonsEl.innerHTML = "<li>Không có lý do được trả về.</li>";
    return;
  }

  reasonsEl.innerHTML = reasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");
}

function renderNews(newsItems) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    newsEl.innerHTML = "<li>Không có tin tức bổ sung.</li>";
    return;
  }

  newsEl.innerHTML = newsItems
    .map((item) => {
      const title = escapeHtml(item.title || item.url || "Không tiêu đề");
      const source = escapeHtml(item.source || "Không rõ nguồn");
      const when = escapeHtml(item.published_at || "");
      const snippet = escapeHtml(item.snippet || "");
      const url = escapeHtml(item.url || "");
      return `<li>
        <a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
        <p>${source}${when ? ` | ${when}` : ""}</p>
        <p>${snippet}</p>
      </li>`;
    })
    .join("");
}

function renderSources(sources) {
  const rows = [];

  const priceSources = Array.isArray(sources.price) ? sources.price : [];
  for (const src of priceSources) {
    const label = [src.provider, src.symbol].filter(Boolean).join(" - ");
    rows.push(renderSourceRow(label, src.url));
  }

  const newsSources = Array.isArray(sources.news) ? sources.news : [];
  for (const src of newsSources) {
    const label = [src.provider, src.query].filter(Boolean).join(" - ");
    rows.push(renderSourceRow(label, src.url));
  }

  const advancedBuckets = ["fundamentals", "options", "macro", "on_chain", "vietnam_local"];
  for (const bucket of advancedBuckets) {
    const list = Array.isArray(sources[bucket]) ? sources[bucket] : [];
    for (const src of list) {
      const label = [src.provider, src.symbol || src.series || src.query]
        .filter(Boolean)
        .join(" - ");
      rows.push(renderSourceRow(label, src.url));
    }
  }

  const technical = Array.isArray(sources.technical) ? sources.technical : [];
  if (technical.length > 0) {
    rows.push(`<li>Bộ chỉ báo kỹ thuật: ${escapeHtml(technical.join(", "))}</li>`);
  }

  sourcesEl.innerHTML = rows.length > 0 ? rows.join("") : "<li>Không có nguồn.</li>";
}

function renderSourceRow(label, url) {
  const safeLabel = escapeHtml(label || "Nguồn");
  const safeUrl = cleanText(url);
  if (safeUrl && safeUrl.startsWith("http") && !safeUrl.includes("api_key=")) {
    return `<li><a href="${escapeHtml(
      safeUrl
    )}" target="_blank" rel="noopener noreferrer">${safeLabel}</a></li>`;
  }
  return `<li>${safeLabel}</li>`;
}

function renderChart(history, primary) {
  if (!Array.isArray(history) || history.length < 2) {
    chartWrapEl.textContent = "Không đủ dữ liệu để vẽ biểu đồ.";
    return;
  }

  const closes = history.map((p) => Number(p.close)).filter(Number.isFinite);
  if (closes.length < 2) {
    chartWrapEl.textContent = "Không đủ dữ liệu để vẽ biểu đồ.";
    return;
  }

  const leftPad = 24;
  const rightPad = 24;
  const width = 940;
  const height = 280;
  const totalWidth = 1080;

  const currentMin = Math.min(...closes);
  const currentMax = Math.max(...closes);
  const futurePrice = Number(primary?.expected_price);
  const minPrice = Number.isFinite(futurePrice) ? Math.min(currentMin, futurePrice) : currentMin;
  const maxPrice = Number.isFinite(futurePrice) ? Math.max(currentMax, futurePrice) : currentMax;
  const min = minPrice === maxPrice ? minPrice * 0.98 : minPrice;
  const max = minPrice === maxPrice ? maxPrice * 1.02 : maxPrice;

  const toX = (index) => {
    if (history.length === 1) return leftPad;
    return leftPad + (index / (history.length - 1)) * (width - leftPad - rightPad);
  };

  const toY = (price) => {
    const ratio = (price - min) / (max - min || 1);
    return height - 18 - ratio * (height - 40);
  };

  const points = history
    .map((p, idx) => `${toX(idx).toFixed(2)},${toY(Number(p.close)).toFixed(2)}`)
    .join(" ");

  let forecastLine = "";
  let futureLabel = "";
  if (Number.isFinite(futurePrice)) {
    const lastX = toX(history.length - 1);
    const lastY = toY(Number(history[history.length - 1].close));
    const futureX = totalWidth - rightPad;
    const futureY = toY(futurePrice);
    const signalKey = cleanText(primary?.signal?.key) || "flat";

    forecastLine = `
      <line class="forecast-line signal-${escapeHtml(
        signalKey
      )}" x1="${lastX}" y1="${lastY}" x2="${futureX}" y2="${futureY}"></line>
      <circle class="forecast-point signal-${escapeHtml(
        signalKey
      )}" cx="${futureX}" cy="${futureY}" r="5"></circle>
      <text class="chart-annotation" x="${futureX - 4}" y="${futureY - 10}">${escapeHtml(
      primary?.label || "Dự báo"
    )}</text>
    `;

    futureLabel = `
      <text class="chart-label" x="${futureX - 34}" y="${height - 4}">${escapeHtml(
      primary?.label || "Dự báo"
    )}</text>
    `;
  }

  const firstDate = escapeHtml(history[0].date || "");
  const lastDate = escapeHtml(history[history.length - 1].date || "");

  chartWrapEl.innerHTML = `
    <svg viewBox="0 0 ${totalWidth} ${height}" role="img" aria-label="biểu đồ giá">
      <rect x="0" y="0" width="${totalWidth}" height="${height}" fill="transparent"></rect>
      <line class="chart-grid" x1="${leftPad}" y1="${height - 18}" x2="${totalWidth - rightPad}" y2="${height - 18}"></line>
      <line class="chart-grid" x1="${leftPad}" y1="20" x2="${totalWidth - rightPad}" y2="20"></line>
      <polyline class="chart-line" points="${points}"></polyline>
      ${forecastLine}
      <text class="chart-label" x="${leftPad}" y="${height - 4}">${firstDate}</text>
      <text class="chart-label" x="${width - 110}" y="${height - 4}">${lastDate}</text>
      ${futureLabel}
    </svg>
  `;
}

function setLoadingState() {
  projectionsBody.innerHTML =
    '<tr><td colspan="6" class="empty">Đang tính toán dự báo...</td></tr>';
  indicatorsBody.innerHTML =
    '<tr><td colspan="2" class="empty">Đang tính toán chỉ báo...</td></tr>';
  componentsBody.innerHTML =
    '<tr><td colspan="5" class="empty">Đang tính điểm đa nguồn...</td></tr>';
  multiScoreEl.textContent = "-";
  multiConfidenceEl.textContent = "Độ tin cậy: -";
  multiBadgeEl.textContent = "Đang tính toán";
  applySignalClass(multiBadgeEl, "flat");
  multiDirectionEl.textContent = "-";
  multiExplainEl.innerHTML = "<li>Đang tổng hợp...</li>";
  fundamentalListEl.innerHTML = "<li>Đang tải dữ liệu cơ bản...</li>";
  optionsListEl.innerHTML = "<li>Đang tải dòng tiền quyền chọn...</li>";
  macroListEl.innerHTML = "<li>Đang tải dữ liệu vĩ mô...</li>";
  onchainListEl.innerHTML = "<li>Đang tải on-chain...</li>";
  vnlocalListEl.innerHTML = "<li>Đang tải thị trường nội địa VN...</li>";
  companyInfoEl.innerHTML = "<li>Đang tải thông tin công ty...</li>";
  chartWrapEl.textContent = "Đang vẽ biểu đồ...";
  reasonsEl.innerHTML = "<li>Đang phân tích...</li>";
  newsEl.innerHTML = "<li>Đang tải tin tức...</li>";
  sourcesEl.innerHTML = "<li>Đang tổng hợp nguồn...</li>";
  assumptionsEl.textContent = "";
}

function renderErrorState() {
  projectionsBody.innerHTML =
    '<tr><td colspan="6" class="empty">Không lấy được dữ liệu.</td></tr>';
  indicatorsBody.innerHTML =
    '<tr><td colspan="2" class="empty">Không lấy được dữ liệu.</td></tr>';
  componentsBody.innerHTML =
    '<tr><td colspan="5" class="empty">Không lấy được dữ liệu.</td></tr>';
  multiScoreEl.textContent = "-";
  multiConfidenceEl.textContent = "Độ tin cậy: -";
  multiBadgeEl.textContent = "Không có dữ liệu";
  applySignalClass(multiBadgeEl, "flat");
  multiDirectionEl.textContent = "-";
  multiExplainEl.innerHTML = "<li>Không có dữ liệu.</li>";
  fundamentalListEl.innerHTML = "<li>Không có dữ liệu.</li>";
  optionsListEl.innerHTML = "<li>Không có dữ liệu.</li>";
  macroListEl.innerHTML = "<li>Không có dữ liệu.</li>";
  onchainListEl.innerHTML = "<li>Không có dữ liệu.</li>";
  vnlocalListEl.innerHTML = "<li>Không có dữ liệu.</li>";
  companyInfoEl.innerHTML = "<li>Không có dữ liệu.</li>";
  chartWrapEl.textContent = "Không thể vẽ biểu đồ.";
  reasonsEl.innerHTML = "<li>Không có dữ liệu.</li>";
  newsEl.innerHTML = "<li>Không có dữ liệu.</li>";
  sourcesEl.innerHTML = "<li>Không có dữ liệu.</li>";
}

function applySignalClass(element, signalKey) {
  for (const className of Array.from(element.classList)) {
    if (className.startsWith("signal-") && className !== "signal-pill") {
      element.classList.remove(className);
    }
  }
  element.classList.add(`signal-${signalKey || "flat"}`);
}

function formatCurrency(value, currency) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";

  const upperCurrency = cleanText(currency || "USD").toUpperCase();
  const decimal = upperCurrency === "VND" ? 0 : 2;

  try {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: upperCurrency,
      maximumFractionDigits: decimal,
      minimumFractionDigits: decimal
    }).format(num);
  } catch {
    return `${num.toFixed(decimal)} ${upperCurrency}`;
  }
}

function formatNumber(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${(num * 100).toFixed(2)}%`;
}

function formatSignedPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const abs = Math.abs(num) * 100;
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  return `${sign}${abs.toFixed(2)}%`;
}

function formatSignedPercentRaw(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  return `${sign}${Math.abs(num).toFixed(2)}%`;
}

function formatSignedCurrency(value, currency) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  return `${sign}${formatCurrency(Math.abs(num), currency)}`;
}

function formatSignedNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  return `${sign}${Math.abs(num).toFixed(digits)}`;
}

function resolveMarketCode(instrument) {
  const resolvedSymbol = cleanText(instrument?.symbol).toUpperCase();
  const requestedSymbol = cleanText(instrument?.requested_symbol).toUpperCase();
  const explicit = cleanText(instrument?.market).toUpperCase();

  if (
    resolvedSymbol.endsWith(".VN") ||
    resolvedSymbol.endsWith(".HN") ||
    requestedSymbol.endsWith(".VN") ||
    requestedSymbol.endsWith(".HN")
  ) {
    return "VN";
  }
  if (resolvedSymbol.endsWith("=X")) return "FX";
  if (resolvedSymbol.includes("-USD")) return "CRYPTO";
  if (explicit === "VN" || explicit === "US" || explicit === "FX" || explicit === "CRYPTO") return explicit;
  return explicit || "AUTO";
}

function resolveCurrency(instrument, price) {
  const explicit = cleanText(instrument?.currency || price?.currency).toUpperCase();
  const resolvedSymbol = cleanText(instrument?.symbol).toUpperCase();
  const requestedSymbol = cleanText(instrument?.requested_symbol).toUpperCase();
  if (
    resolvedSymbol.endsWith(".VN") ||
    resolvedSymbol.endsWith(".HN") ||
    requestedSymbol.endsWith(".VN") ||
    requestedSymbol.endsWith(".HN")
  ) {
    return "VND";
  }
  if (explicit) return explicit;
  return "USD";
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateStatus(message, isError = false) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", Boolean(isError));
}
