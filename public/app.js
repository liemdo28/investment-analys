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

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const symbol = cleanText(document.getElementById("symbol").value).toUpperCase();
  const market = cleanText(document.getElementById("market").value).toUpperCase() || "AUTO";
  const horizons = cleanText(document.getElementById("horizons").value);
  const lookbackDays = Number.parseInt(document.getElementById("lookback").value, 10);
  const includeNews = document.getElementById("include-news").checked;

  if (!symbol) {
    updateStatus("Can nhap ma tai san.", true);
    return;
  }

  if (!horizons) {
    updateStatus("Can nhap it nhat 1 moc du bao (vd: 5d,1w,1m).", true);
    return;
  }

  updateStatus("Dang thu thap du lieu va phan tich...");
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
        horizons,
        lookback_days: Number.isFinite(lookbackDays) ? lookbackDays : 365,
        include_news: includeNews
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Request loi (HTTP ${res.status}).`);
    }

    renderDashboard(data);
    updateStatus("Hoan tat.");
  } catch (error) {
    updateStatus(error && error.message ? error.message : "Co loi khong xac dinh.", true);
    renderErrorState();
  }
});

function renderDashboard(data) {
  const instrument = data.instrument || {};
  const price = data.price || {};
  const analysis = data.analysis || {};
  const primary = analysis.primary || null;
  const trend = analysis.trend || {};
  const currency = cleanText(instrument.currency || price.currency) || "USD";

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
    primaryRangeEl.textContent = `Range: ${formatCurrency(
      primary.range_low,
      currency
    )} -> ${formatCurrency(primary.range_high, currency)}`;
    probUpEl.textContent = `Kha nang tang: ${formatPercent(primary.probability_up)}`;

    const trendText = [
      primary.signal?.label || "-",
      trend.direction ? trend.direction.toUpperCase() : "N/A"
    ].join(" | ");
    trendBadgeEl.textContent = trendText;
    applySignalClass(trendBadgeEl, primary.signal?.key || "flat");
  } else {
    primaryForecastEl.textContent = "-";
    primaryChangeEl.textContent = "-";
    primaryRangeEl.textContent = "-";
    probUpEl.textContent = "-";
    trendBadgeEl.textContent = "Khong du du lieu";
    applySignalClass(trendBadgeEl, "flat");
  }

  trendScoreEl.textContent = `Trend score: ${formatNumber(
    trend.score,
    2
  )} | strength: ${cleanText(trend.strength) || "-"}`;

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
    ? `Luu y: ${assumptions.join(" | ")}`
    : "";
}

function renderProjections(projections, currency) {
  if (!Array.isArray(projections) || projections.length === 0) {
    projectionsBody.innerHTML =
      '<tr><td colspan="6" class="empty">Khong co du lieu du bao.</td></tr>';
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
    ["MACD Signal", indicators.macd_signal],
    ["MACD Histogram", indicators.macd_histogram],
    ["Bollinger Upper", indicators.bollinger_upper],
    ["Bollinger Mid", indicators.bollinger_mid],
    ["Bollinger Lower", indicators.bollinger_lower],
    ["ATR14", indicators.atr14],
    ["Momentum 10", indicators.momentum10],
    ["Volatility (Annual)", formatPercent(indicators.volatility_annual)],
    ["Drift (Annual)", formatSignedPercent(indicators.drift_annual)],
    ["Trend Score", formatNumber(indicators.trend_score, 4)]
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
  multiConfidenceEl.textContent = `Confidence: ${
    Number.isFinite(confidence) ? `${(confidence * 100).toFixed(1)}%` : "-"
  }`;
  multiDirectionEl.textContent = [
    direction ? direction.toUpperCase() : "SIDEWAYS",
    cleanText(multi.strength || "-")
  ].join(" | ");
  multiBadgeEl.textContent = cleanText(multi?.signal?.label) || "No signal";
  applySignalClass(multiBadgeEl, signalKey);

  const explain = Array.isArray(multi.explanation)
    ? multi.explanation.filter(Boolean)
    : [];
  multiExplainEl.innerHTML = explain.length
    ? explain.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "<li>Chua co giai thich.</li>";

  const components = Array.isArray(multi.components)
    ? multi.components
    : [];
  if (components.length === 0) {
    componentsBody.innerHTML =
      '<tr><td colspan="5" class="empty">Khong co thanh phan score.</td></tr>';
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
    metricLine("Signal", signal.label || "No data"),
    metricLine("Score", formatNumber(signal.score, 3)),
    metricLine("Name", profile.name || "-"),
    metricLine("Industry", profile.industry || "-"),
    metricLine("PE TTM", formatNumber(metrics.pe_ttm, 2)),
    metricLine("ROE TTM", formatSignedPercent(metrics.roe_ttm)),
    metricLine("Revenue YoY", formatSignedPercent(metrics.revenue_growth_yoy)),
    metricLine("Debt/Equity", formatNumber(metrics.debt_to_equity, 2))
  ];
  fundamentalListEl.innerHTML = rows.join("");
}

function renderOptions(data) {
  const signal = data.signal || {};
  const rows = [
    metricLine("Signal", signal.label || "No data"),
    metricLine("Score", formatNumber(signal.score, 3)),
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
    metricLine("Signal", signal.label || "No data"),
    metricLine("Score", formatNumber(signal.score, 3)),
    metricLine("Policy Rate", formatNumber(metrics.policy_rate, 2)),
    metricLine("Policy Delta", formatSignedNumber(metrics.policy_rate_change, 2)),
    metricLine("Unemployment", formatNumber(metrics.unemployment_rate, 2)),
    metricLine("Yield 10Y2Y", formatNumber(metrics.yield_spread_10y2y, 2)),
    metricLine("VIX", formatNumber(metrics.vix, 2))
  ];
  macroListEl.innerHTML = rows.join("");
}

function renderOnchain(data) {
  const signal = data.signal || {};
  const metrics = data.metrics || {};
  const rows = [
    metricLine("Signal", signal.label || "No data"),
    metricLine("Score", formatNumber(signal.score, 3)),
    metricLine("Coin", metrics.id || "-"),
    metricLine("Rank", formatNumber(metrics.market_cap_rank, 0)),
    metricLine("7D Change", formatSignedPercentRaw(metrics.price_change_7d_pct)),
    metricLine("30D Change", formatSignedPercentRaw(metrics.price_change_30d_pct)),
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
    metricLine("Signal", signal.label || "No data"),
    metricLine("Score", formatNumber(signal.score, 3)),
    metricLine("SJC Gold", [gold.type_name, gold.branch_name].filter(Boolean).join(" | ") || "-"),
    metricLine("Gold Buy", formatCurrency(gold.buy, "VND")),
    metricLine("Gold Sell", formatCurrency(gold.sell, "VND")),
    metricLine("Gold Spread", formatSignedPercent(gold.spread_pct)),
    metricLine("USD VCB Buy/Sell", `${formatCurrency(usdVcb.buy, "VND")} / ${formatCurrency(usdVcb.sell, "VND")}`),
    metricLine("USD SJC Buy/Sell", `${formatCurrency(usdSjc.buy, "VND")} / ${formatCurrency(usdSjc.sell, "VND")}`)
  ];

  const notes = Array.isArray(signal.notes) ? signal.notes.filter(Boolean) : [];
  if (notes.length > 0) {
    rows.push(metricLine("Note", notes.join(" | ")));
  }

  vnlocalListEl.innerHTML = rows.join("");
}

function metricLine(label, value) {
  return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value || "-")}</li>`;
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

function formatNumberSmart(name, value, currency) {
  if (name.startsWith("RSI")) return formatNumber(value, 2);
  if (name.startsWith("Volatility") || name.startsWith("Drift")) {
    return formatSignedPercent(value);
  }
  if (
    name.startsWith("SMA") ||
    name.startsWith("EMA") ||
    name.startsWith("Bollinger") ||
    name.startsWith("ATR") ||
    name.startsWith("Momentum")
  ) {
    return formatCurrency(value, currency);
  }
  return formatNumber(value, 6);
}

function renderReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    reasonsEl.innerHTML = "<li>Khong co ly do duoc tra ve.</li>";
    return;
  }

  reasonsEl.innerHTML = reasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");
}

function renderNews(newsItems) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    newsEl.innerHTML = "<li>Khong co tin tuc bo sung.</li>";
    return;
  }

  newsEl.innerHTML = newsItems
    .map((item) => {
      const title = escapeHtml(item.title || item.url || "Khong tieu de");
      const source = escapeHtml(item.source || "Unknown");
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
    rows.push(`<li>Technical toolkit: ${escapeHtml(technical.join(", "))}</li>`);
  }

  sourcesEl.innerHTML = rows.length > 0 ? rows.join("") : "<li>Khong co nguon.</li>";
}

function renderSourceRow(label, url) {
  const safeLabel = escapeHtml(label || "Nguon");
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
    chartWrapEl.textContent = "Khong du du lieu de ve chart.";
    return;
  }

  const closes = history.map((p) => Number(p.close)).filter(Number.isFinite);
  if (closes.length < 2) {
    chartWrapEl.textContent = "Khong du du lieu de ve chart.";
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
      primary?.label || "Forecast"
    )}</text>
    `;

    futureLabel = `
      <text class="chart-label" x="${futureX - 34}" y="${height - 4}">${escapeHtml(
      primary?.label || "Forecast"
    )}</text>
    `;
  }

  const firstDate = escapeHtml(history[0].date || "");
  const lastDate = escapeHtml(history[history.length - 1].date || "");

  chartWrapEl.innerHTML = `
    <svg viewBox="0 0 ${totalWidth} ${height}" role="img" aria-label="price chart">
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
    '<tr><td colspan="6" class="empty">Dang tinh toan du bao...</td></tr>';
  indicatorsBody.innerHTML =
    '<tr><td colspan="2" class="empty">Dang tinh toan chi bao...</td></tr>';
  componentsBody.innerHTML =
    '<tr><td colspan="5" class="empty">Dang tinh multi-source score...</td></tr>';
  multiScoreEl.textContent = "-";
  multiConfidenceEl.textContent = "Confidence: -";
  multiBadgeEl.textContent = "Dang tinh toan";
  applySignalClass(multiBadgeEl, "flat");
  multiDirectionEl.textContent = "-";
  multiExplainEl.innerHTML = "<li>Dang tong hop...</li>";
  fundamentalListEl.innerHTML = "<li>Dang tai fundamentals...</li>";
  optionsListEl.innerHTML = "<li>Dang tai options flow...</li>";
  macroListEl.innerHTML = "<li>Dang tai macro...</li>";
  onchainListEl.innerHTML = "<li>Dang tai on-chain...</li>";
  vnlocalListEl.innerHTML = "<li>Dang tai VN local market...</li>";
  chartWrapEl.textContent = "Dang ve chart...";
  reasonsEl.innerHTML = "<li>Dang phan tich...</li>";
  newsEl.innerHTML = "<li>Dang tai tin tuc...</li>";
  sourcesEl.innerHTML = "<li>Dang tong hop nguon...</li>";
  assumptionsEl.textContent = "";
}

function renderErrorState() {
  projectionsBody.innerHTML =
    '<tr><td colspan="6" class="empty">Khong lay duoc du lieu.</td></tr>';
  indicatorsBody.innerHTML =
    '<tr><td colspan="2" class="empty">Khong lay duoc du lieu.</td></tr>';
  componentsBody.innerHTML =
    '<tr><td colspan="5" class="empty">Khong lay duoc du lieu.</td></tr>';
  multiScoreEl.textContent = "-";
  multiConfidenceEl.textContent = "Confidence: -";
  multiBadgeEl.textContent = "Khong co du lieu";
  applySignalClass(multiBadgeEl, "flat");
  multiDirectionEl.textContent = "-";
  multiExplainEl.innerHTML = "<li>Khong co du lieu.</li>";
  fundamentalListEl.innerHTML = "<li>Khong co du lieu.</li>";
  optionsListEl.innerHTML = "<li>Khong co du lieu.</li>";
  macroListEl.innerHTML = "<li>Khong co du lieu.</li>";
  onchainListEl.innerHTML = "<li>Khong co du lieu.</li>";
  vnlocalListEl.innerHTML = "<li>Khong co du lieu.</li>";
  chartWrapEl.textContent = "Khong the ve chart.";
  reasonsEl.innerHTML = "<li>Khong co du lieu.</li>";
  newsEl.innerHTML = "<li>Khong co du lieu.</li>";
  sourcesEl.innerHTML = "<li>Khong co du lieu.</li>";
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
