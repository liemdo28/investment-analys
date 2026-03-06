const DAY_MS = 24 * 60 * 60 * 1000;
const EPSILON = 1e-9;

const SIGNAL_META = {
  "strong-up": { label: "Tăng mạnh", color: "purple" },
  "mild-up": { label: "Tăng nhẹ", color: "green" },
  flat: { label: "Đi ngang", color: "yellow" },
  "mild-down": { label: "Giảm nhẹ", color: "red" },
  "strong-down": { label: "Giảm mạnh", color: "teal" }
};

const POSITIVE_NEWS_WORDS = [
  "beat", "growth", "record", "upgrade", "profit", "surge", "rally", "tang truong", "dot pha", "ky luc"
];
const NEGATIVE_NEWS_WORDS = [
  "downgrade", "miss", "drop", "decline", "lawsuit", "risk", "warning", "giam", "thua lo", "suy thoai"
];

const WEIGHT_CONFIG = {
  technical: 0.35,
  projection: 0.2,
  news: 0.12,
  fundamentals: 0.14,
  options: 0.08,
  macro: 0.06,
  on_chain: 0.05,
  vn_local: 0.06
};

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const symbol = cleanString(body.symbol || body.ticker || body.query).toUpperCase();
    if (!symbol) return json({ ok: false, error: "Can nhap ma tai san." }, 400);

    const market = normalizeMarket(body.market);
    const lookbackDays = clampInt(body.lookback_days, 90, 3000, 365);
    const horizons = parseHorizonList(body.horizons, body.horizon_value, body.horizon_unit);
    const includeNews = body.include_news !== false;
    const includeVnLocal = body.include_vn_local !== false;
    const newsLimit = clampInt(body.news_limit, 3, 30, 10);

    const priceBundle = await fetchPriceBundle({ symbol, market, lookbackDays, env });
    if (!priceBundle || priceBundle.history.length < 40) {
      return json(
        {
          ok: false,
          error: "Khong lay duoc du lieu gia/historical.",
          assumptions: priceBundle ? priceBundle.notes : []
        },
        502
      );
    }

    const indicators = computeIndicators(priceBundle.history);
    const projections = horizons
      .map((h) => buildProjection({ horizon: h, history: priceBundle.history, lastPrice: priceBundle.lastPrice }))
      .filter(Boolean);

    const primary = projections[0] || null;
    const trend = summarizeTrend(indicators, primary, priceBundle.lastPrice);

    const newsMeta = includeNews
      ? await fetchNewsSignals({ symbol, name: priceBundle.name, market, limit: newsLimit, env })
      : { items: [], sources: [], notes: ["Nguoi dung tat module tin tuc."] };

    const newsSentiment = scoreNewsSentiment(newsMeta.items);

    const [fundamentals, options, macro, onChain, vietnamLocal] = await Promise.all([
      fetchFundamentals({ symbol, resolvedSymbol: priceBundle.resolvedSymbol, market, env }),
      fetchOptionsSignal({ symbol, resolvedSymbol: priceBundle.resolvedSymbol, env }),
      fetchMacroSignal({ market, env }),
      fetchOnChainSignal({ symbol }),
      includeVnLocal ? fetchVietnamLocalMarket({ env }) : Promise.resolve(emptyVietnamLocalMarket("Nguoi dung tat module VN local."))
    ]);

    const multiSource = buildMultiSourceScore({
      indicators,
      primaryProjection: primary,
      newsSentiment,
      fundamentals,
      options,
      macro,
      onChain,
      vietnamLocal,
      historySize: priceBundle.history.length
    });

    const assumptions = []
      .concat(priceBundle.notes || [])
      .concat(newsMeta.notes || [])
      .concat(fundamentals.notes || [])
      .concat(options.notes || [])
      .concat(macro.notes || [])
      .concat(onChain.notes || [])
      .concat(vietnamLocal.notes || [])
      .concat(requiredApiHints(env))
      .filter(Boolean)
      .slice(0, 20);

    return json({
      ok: true,
      request: {
        symbol,
        market,
        lookback_days: lookbackDays,
        horizons: horizons.map((h) => h.label),
        include_news: includeNews,
        include_vn_local: includeVnLocal
      },
      instrument: {
        symbol: priceBundle.resolvedSymbol,
        requested_symbol: symbol,
        name: priceBundle.name,
        exchange: priceBundle.exchange,
        market,
        currency: priceBundle.currency,
        asset_type: detectAssetType(symbol)
      },
      price: {
        last: round(priceBundle.lastPrice, 8),
        as_of: priceBundle.asOf,
        currency: priceBundle.currency
      },
      analysis: {
        primary,
        projections,
        trend,
        indicators,
        news_sentiment: newsSentiment,
        multi_source: multiSource
      },
      advanced: {
        fundamentals,
        options,
        macro,
        on_chain: onChain,
        vietnam_local: vietnamLocal
      },
      history: priceBundle.history.map((p) => ({ date: p.date, close: round(p.close, 8) })),
      news: newsMeta.items,
      sources: {
        price: priceBundle.sources,
        news: newsMeta.sources,
        fundamentals: fundamentals.sources,
        options: options.sources,
        macro: macro.sources,
        on_chain: onChain.sources,
        vietnam_local: vietnamLocal.sources,
        technical: ["SMA20", "SMA50", "EMA20", "RSI14", "MACD(12,26,9)", "Bollinger(20,2)", "ATR14", "Log-return expectation"]
      },
      assumptions
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Loi server khi phan tich.",
        detail: String(error && error.message ? error.message : error)
      },
      500
    );
  }
}

function requiredApiHints(env) {
  const notes = [];
  if (!env.SERPAPI_API_KEY) notes.push("Thieu SERPAPI_API_KEY: kenh tin tuc/chinh tri se bi gioi han.");
  if (!env.ALPHA_VANTAGE_API_KEY) notes.push("Khuyen nghi ALPHA_VANTAGE_API_KEY lam kenh du phong du lieu gia.");
  if (!env.FINNHUB_API_KEY) notes.push("Khuyen nghi FINNHUB_API_KEY de mo rong fundamentals.");
  if (!env.POLYGON_API_KEY) notes.push("Khuyen nghi POLYGON_API_KEY de lay option flow put-call.");
  if (!env.TWELVEDATA_API_KEY) notes.push("Khuyen nghi TWELVEDATA_API_KEY de bo sung fallback data.");
  if (!env.FRED_API_KEY) notes.push("Khuyen nghi FRED_API_KEY de mo hinh macro regime.");
  if (!env.NEWSAPI_API_KEY) notes.push("Khuyen nghi NEWSAPI_API_KEY cho kenh news fallback.");
  if (!env.SJC_PRICE_API_URL) notes.push("Dang dung SJC endpoint mac dinh cho vang noi dia va exchange rate.");
  if (!env.VCB_EXRATE_XML_URL) notes.push("Dang dung VCB XML endpoint mac dinh cho ty gia ngan hang.");
  return notes;
}
async function fetchPriceBundle({ symbol, market, lookbackDays, env }) {
  const candidates = buildSymbolCandidates(symbol, market);
  const notes = [];

  for (const candidate of candidates) {
    const yahoo = await fetchYahooHistory(candidate, lookbackDays);
    if (yahoo && yahoo.history.length >= 40) {
      return {
        ...yahoo,
        notes,
        sources: [
          {
            provider: "Yahoo Finance Chart",
            symbol: yahoo.resolvedSymbol,
            url: `https://finance.yahoo.com/quote/${encodeURIComponent(yahoo.resolvedSymbol)}`
          }
        ]
      };
    }
  }

  notes.push("Yahoo Finance khong tra ve du lieu hop le.");

  if (env.ALPHA_VANTAGE_API_KEY) {
    for (const candidate of candidates) {
      const alpha = await fetchAlphaVantageHistory({
        symbol: candidate,
        lookbackDays,
        apiKey: env.ALPHA_VANTAGE_API_KEY,
        market
      });
      if (alpha && alpha.history.length >= 40) {
        notes.push("Dang dung du lieu du phong tu Alpha Vantage.");
        return {
          ...alpha,
          notes,
          sources: [{ provider: "Alpha Vantage Daily", symbol: alpha.resolvedSymbol, url: "https://www.alphavantage.co/documentation/" }]
        };
      }
    }
  }

  if (env.TWELVEDATA_API_KEY) {
    for (const candidate of candidates) {
      const td = await fetchTwelveDataHistory({
        symbol: candidate,
        lookbackDays,
        apiKey: env.TWELVEDATA_API_KEY,
        market
      });
      if (td && td.history.length >= 40) {
        notes.push("Dang dung du lieu du phong tu TwelveData.");
        return {
          ...td,
          notes,
          sources: [{ provider: "TwelveData time_series", symbol: td.resolvedSymbol, url: "https://twelvedata.com/docs" }]
        };
      }
    }
  }

  notes.push("Khong tim thay kenh gia du phong hop le.");
  return { history: [], notes, sources: [] };
}

function buildSymbolCandidates(symbol, market) {
  const base = cleanString(symbol).toUpperCase();
  if (!base) return [];
  if (/[.=]/.test(base)) return [base];

  const out = new Set();
  if (market === "VN") {
    out.add(`${base}.VN`);
    out.add(base);
  } else if (market === "US") {
    out.add(base);
  } else {
    if (isLikelyVietnamTicker(base)) {
      out.add(`${base}.VN`);
      out.add(base);
    } else {
      out.add(base);
      out.add(`${base}.VN`);
    }
  }
  return Array.from(out);
}

function isLikelyVietnamTicker(symbol) {
  const raw = cleanString(symbol).toUpperCase();
  return /^[A-Z]{3,4}$/.test(raw);
}

async function fetchYahooHistory(symbol, lookbackDays) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", toYahooRange(lookbackDays));
  url.searchParams.set("events", "div,splits");

  const res = await fetchWithTimeout(url.toString(), { method: "GET" }, 22000);
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const result = Array.isArray(data?.chart?.result) ? data.chart.result[0] : null;
  if (!result) return null;

  const meta = result.meta || {};
  const quote = Array.isArray(result?.indicators?.quote) ? result.indicators.quote[0] : null;
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  if (!quote || timestamps.length === 0) return null;

  const minTs = Date.now() - lookbackDays * DAY_MS;
  const history = [];

  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = Number(timestamps[i]) * 1000;
    if (!Number.isFinite(ts) || ts < minTs) continue;

    const close = toNum(quote.close?.[i]);
    if (!Number.isFinite(close) || close <= 0) continue;

    history.push({
      date: new Date(ts).toISOString().slice(0, 10),
      open: finiteOr(quote.open?.[i], close),
      high: finiteOr(quote.high?.[i], close),
      low: finiteOr(quote.low?.[i], close),
      close,
      volume: finiteOr(quote.volume?.[i], 0)
    });
  }

  history.sort((a, b) => a.date.localeCompare(b.date));
  if (history.length < 2) return null;

  const lastClose = history[history.length - 1].close;
  const asOf = Number.isFinite(meta.regularMarketTime)
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : `${history[history.length - 1].date}T00:00:00.000Z`;

  return {
    resolvedSymbol: cleanString(meta.symbol) || symbol,
    name: cleanString(meta.longName || meta.shortName) || symbol,
    exchange: cleanString(meta.exchangeName || meta.fullExchangeName) || "",
    currency: cleanString(meta.currency) || inferCurrency(symbol, "AUTO"),
    lastPrice: finiteOr(meta.regularMarketPrice, lastClose),
    asOf,
    history
  };
}

async function fetchAlphaVantageHistory({ symbol, lookbackDays, apiKey, market }) {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "TIME_SERIES_DAILY_ADJUSTED");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("outputsize", "full");
  url.searchParams.set("apikey", apiKey);

  const res = await fetchWithTimeout(url.toString(), { method: "GET" }, 26000);
  if (!res.ok) return null;

  const data = await res.json().catch(() => ({}));
  const series = data?.["Time Series (Daily)"];
  if (!series || typeof series !== "object") return null;

  const minDate = new Date(Date.now() - lookbackDays * DAY_MS).toISOString().slice(0, 10);
  const history = Object.entries(series)
    .map(([date, val]) => ({
      date,
      open: toNum(val?.["1. open"]),
      high: toNum(val?.["2. high"]),
      low: toNum(val?.["3. low"]),
      close: toNum(val?.["4. close"]),
      volume: toNum(val?.["6. volume"])
    }))
    .filter((x) => x.date >= minDate && Number.isFinite(x.close) && x.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (history.length < 2) return null;
  const meta = data?.["Meta Data"] || {};
  const latest = history[history.length - 1];

  return {
    resolvedSymbol: cleanString(meta["2. Symbol"]) || symbol,
    name: cleanString(meta["2. Symbol"]) || symbol,
    exchange: "",
    currency: cleanString(meta["8. Currency"]) || inferCurrency(symbol, market),
    lastPrice: latest.close,
    asOf: `${latest.date}T00:00:00.000Z`,
    history
  };
}

async function fetchTwelveDataHistory({ symbol, lookbackDays, apiKey, market }) {
  const outputSize = clampInt(Math.ceil(lookbackDays * 1.5), 120, 5000, 500);
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", String(outputSize));
  url.searchParams.set("apikey", apiKey);

  const res = await fetchWithTimeout(url.toString(), { method: "GET" }, 24000);
  if (!res.ok) return null;

  const data = await res.json().catch(() => ({}));
  const values = Array.isArray(data.values) ? data.values : [];
  if (values.length === 0) return null;

  const minDate = new Date(Date.now() - lookbackDays * DAY_MS).toISOString().slice(0, 10);
  const history = values
    .map((row) => ({
      date: cleanString(row.datetime).slice(0, 10),
      open: toNum(row.open),
      high: toNum(row.high),
      low: toNum(row.low),
      close: toNum(row.close),
      volume: toNum(row.volume)
    }))
    .filter((x) => x.date && x.date >= minDate && Number.isFinite(x.close) && x.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (history.length < 2) return null;
  const latest = history[history.length - 1];

  return {
    resolvedSymbol: cleanString(data.symbol) || symbol,
    name: cleanString(data.meta?.symbol) || symbol,
    exchange: cleanString(data.meta?.exchange) || "",
    currency: cleanString(data.meta?.currency) || inferCurrency(symbol, market),
    lastPrice: latest.close,
    asOf: `${latest.date}T00:00:00.000Z`,
    history
  };
}
function computeIndicators(history) {
  const closes = history.map((p) => p.close);
  const highs = history.map((p) => p.high);
  const lows = history.map((p) => p.low);

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const ema20 = ema(closes, 20);
  const rsi14 = rsi(closes, 14);
  const macdRes = macd(closes);
  const boll = bollinger(closes, 20, 2);
  const atr14 = atr(highs, lows, closes, 14);
  const momentum10 = closes.length > 10 ? closes[closes.length - 1] - closes[closes.length - 11] : 0;

  const returns = logReturns(closes);
  const sigmaDaily = std(returns);
  const muDaily = mean(returns);

  const trendScore = indicatorScore({
    last: closes[closes.length - 1],
    sma20,
    sma50,
    rsi14,
    macdHist: macdRes.histogram,
    momentum10
  });

  return {
    sma20: round(sma20, 8),
    sma50: round(sma50, 8),
    ema20: round(ema20, 8),
    rsi14: round(rsi14, 4),
    macd: round(macdRes.macd, 8),
    macd_signal: round(macdRes.signal, 8),
    macd_histogram: round(macdRes.histogram, 8),
    bollinger_upper: round(boll.upper, 8),
    bollinger_mid: round(boll.mid, 8),
    bollinger_lower: round(boll.lower, 8),
    atr14: round(atr14, 8),
    momentum10: round(momentum10, 8),
    volatility_annual: round(sigmaDaily * Math.sqrt(252), 8),
    drift_annual: round(muDaily * 252, 8),
    trend_score: round(trendScore, 4)
  };
}

function buildProjection({ horizon, history, lastPrice }) {
  const closes = history.map((p) => p.close);
  const returns = logReturns(closes).slice(-240);
  if (returns.length < 5) return null;

  const mu = mean(returns);
  const sigma = Math.max(std(returns), EPSILON);
  const days = Math.max(1, horizon.tradingDays);

  const expectedLog = mu * days;
  const sigmaH = sigma * Math.sqrt(days);
  const expectedPrice = lastPrice * Math.exp(expectedLog);
  const low = lastPrice * Math.exp(expectedLog - sigmaH);
  const high = lastPrice * Math.exp(expectedLog + sigmaH);

  const delta = expectedPrice - lastPrice;
  const pct = delta / lastPrice;

  const probUp = sigmaH < EPSILON ? (expectedLog > 0 ? 1 : expectedLog < 0 ? 0 : 0.5) : 1 - normalCdf((-expectedLog) / sigmaH);

  return {
    label: horizon.label,
    text: horizon.text,
    trading_days: days,
    expected_price: round(expectedPrice, 8),
    expected_delta: round(delta, 8),
    expected_pct: round(pct, 8),
    probability_up: round(probUp, 6),
    range_low: round(low, 8),
    range_high: round(high, 8),
    signal: signalFromPct(pct)
  };
}

function summarizeTrend(indicators, projection, lastPrice) {
  const score = toNum(indicators.trend_score);
  const reasons = [];

  if (Number.isFinite(indicators.sma20) && Number.isFinite(indicators.sma50)) {
    reasons.push(indicators.sma20 >= indicators.sma50 ? "SMA20 đang trên SMA50." : "SMA20 đang dưới SMA50.");
  }
  if (Number.isFinite(indicators.rsi14)) {
    if (indicators.rsi14 >= 70) reasons.push("RSI14 trong vùng quá mua.");
    else if (indicators.rsi14 <= 30) reasons.push("RSI14 trong vùng quá bán.");
    else reasons.push("RSI14 trung tính.");
  }
  if (Number.isFinite(indicators.macd_histogram)) {
    reasons.push(indicators.macd_histogram >= 0 ? "MACD histogram dương." : "MACD histogram âm.");
  }
  if (projection) {
    reasons.push(`Dự báo ${projection.label}: ${round(projection.expected_pct * 100, 2)}%.`);
  }

  return {
    direction: score >= 2 ? "bullish" : score <= -2 ? "bearish" : "sideways",
    strength: Math.abs(score) >= 3 ? "high" : Math.abs(score) >= 1.5 ? "medium" : "low",
    score: round(score, 4),
    last_price: round(lastPrice, 8),
    reasons: reasons.slice(0, 10)
  };
}

function indicatorScore({ last, sma20, sma50, rsi14, macdHist, momentum10 }) {
  let score = 0;
  if (Number.isFinite(last) && Number.isFinite(sma20)) score += last >= sma20 ? 1 : -1;
  if (Number.isFinite(sma20) && Number.isFinite(sma50)) score += sma20 >= sma50 ? 1 : -1;
  if (Number.isFinite(rsi14)) {
    if (rsi14 >= 55 && rsi14 < 70) score += 0.8;
    else if (rsi14 >= 70) score -= 0.4;
    else if (rsi14 <= 45) score -= 0.8;
  }
  if (Number.isFinite(macdHist)) score += macdHist >= 0 ? 1 : -1;
  if (Number.isFinite(momentum10)) score += momentum10 >= 0 ? 0.8 : -0.8;
  return score;
}

function sma(values, period) {
  return !Array.isArray(values) || values.length < period ? Number.NaN : mean(values.slice(values.length - period));
}

function ema(values, period) {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i += 1) prev = values[i] * k + prev * (1 - k);
  return prev;
}

function rsi(closes, period) {
  if (!Array.isArray(closes) || closes.length <= period) return Number.NaN;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const up = diff > 0 ? diff : 0;
    const down = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }
  if (avgLoss <= EPSILON) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes) {
  if (!Array.isArray(closes) || closes.length < 35) return { macd: Number.NaN, signal: Number.NaN, histogram: Number.NaN };
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const series = closes.map((_, i) => ema12[i] - ema26[i]);
  const signalSeries = emaSeries(series, 9);
  const i = series.length - 1;
  return { macd: series[i], signal: signalSeries[i], histogram: series[i] - signalSeries[i] };
}

function emaSeries(values, period) {
  const out = [];
  const k = 2 / (period + 1);
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function bollinger(closes, period, mult) {
  if (!Array.isArray(closes) || closes.length < period) return { upper: Number.NaN, mid: Number.NaN, lower: Number.NaN };
  const window = closes.slice(closes.length - period);
  const mid = mean(window);
  const sigma = std(window);
  return { upper: mid + mult * sigma, mid, lower: mid - mult * sigma };
}

function atr(highs, lows, closes, period) {
  if (!highs || !lows || !closes || closes.length < period + 1) return Number.NaN;
  const trs = [];
  for (let i = 1; i < closes.length; i += 1) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return trs.length < period ? Number.NaN : mean(trs.slice(trs.length - period));
}

function logReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0 && closes[i] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}
async function fetchNewsSignals({ symbol, name, market, limit, env }) {
  const allItems = [];
  const sources = [];
  const notes = [];
  const gl = market === "VN" ? "vn" : "us";
  const hl = market === "VN" ? "vi" : "en";

  const marketQuery = market === "VN" ? "Viet Nam stock market policy trend" : "US stock market policy trend";
  const assetQuery = `${name || symbol} stock outlook politics trend`;

  if (env.SERPAPI_API_KEY) {
    const [a, m] = await Promise.all([
      searchSerpNews({ query: assetQuery, num: limit, apiKey: env.SERPAPI_API_KEY, gl, hl }),
      searchSerpNews({ query: marketQuery, num: Math.max(4, Math.floor(limit / 2)), apiKey: env.SERPAPI_API_KEY, gl, hl })
    ]);
    allItems.push(...a.items, ...m.items);
    sources.push(...a.sources, ...m.sources);
  } else {
    notes.push("Thieu SERPAPI_API_KEY nen bo qua SerpAPI news.");
  }

  if (env.NEWSAPI_API_KEY) {
    const n = await searchNewsApi({
      query: `${name || symbol} market`,
      limit,
      apiKey: env.NEWSAPI_API_KEY,
      language: market === "VN" ? "vi" : "en"
    });
    allItems.push(...n.items);
    sources.push(...n.sources);
  } else {
    notes.push("Thieu NEWSAPI_API_KEY nen bo qua NewsAPI fallback.");
  }

  const dedup = new Map();
  for (const item of allItems) {
    if (!item.url || dedup.has(item.url)) continue;
    dedup.set(item.url, item);
    if (dedup.size >= limit) break;
  }

  return { items: Array.from(dedup.values()), sources, notes };
}

async function searchSerpNews({ query, num, apiKey, gl, hl }) {
  const requestUrl = new URL("https://serpapi.com/search.json");
  requestUrl.searchParams.set("engine", "google_news");
  requestUrl.searchParams.set("q", query);
  requestUrl.searchParams.set("num", String(num));
  requestUrl.searchParams.set("api_key", apiKey);
  requestUrl.searchParams.set("gl", gl);
  requestUrl.searchParams.set("hl", hl);

  const safeUrl = new URL("https://serpapi.com/search.json");
  safeUrl.searchParams.set("engine", "google_news");
  safeUrl.searchParams.set("q", query);
  safeUrl.searchParams.set("num", String(num));
  safeUrl.searchParams.set("gl", gl);
  safeUrl.searchParams.set("hl", hl);

  const res = await fetchWithTimeout(requestUrl.toString(), { method: "GET" }, 22000);
  if (!res.ok) {
    return { items: [], sources: [{ provider: "SerpAPI Google News", query, status: `HTTP ${res.status}` }] };
  }

  const data = await res.json().catch(() => ({}));
  const news = Array.isArray(data.news_results) ? data.news_results : [];

  const items = news
    .map((item) => ({
      title: cleanString(item.title),
      url: cleanString(item.link),
      snippet: cleanString(item.snippet),
      source: cleanString(item?.source?.name || item.source),
      published_at: cleanString(item.date)
    }))
    .filter((x) => x.title && x.url);

  return { items, sources: [{ provider: "SerpAPI Google News", query, url: safeUrl.toString() }] };
}

async function searchNewsApi({ query, limit, apiKey, language }) {
  const req = new URL("https://newsapi.org/v2/everything");
  req.searchParams.set("q", query);
  req.searchParams.set("sortBy", "publishedAt");
  req.searchParams.set("pageSize", String(limit));
  req.searchParams.set("language", language);

  const safe = new URL("https://newsapi.org/v2/everything");
  safe.searchParams.set("q", query);
  safe.searchParams.set("sortBy", "publishedAt");
  safe.searchParams.set("pageSize", String(limit));
  safe.searchParams.set("language", language);

  const res = await fetchWithTimeout(
    req.toString(),
    { method: "GET", headers: { "x-api-key": apiKey } },
    22000
  );

  if (!res.ok) {
    return { items: [], sources: [{ provider: "NewsAPI", query, status: `HTTP ${res.status}` }] };
  }

  const data = await res.json().catch(() => ({}));
  const articles = Array.isArray(data.articles) ? data.articles : [];
  const items = articles
    .map((item) => ({
      title: cleanString(item.title),
      url: cleanString(item.url),
      snippet: cleanString(item.description || item.content),
      source: cleanString(item?.source?.name),
      published_at: cleanString(item.publishedAt)
    }))
    .filter((x) => x.title && x.url);

  return { items, sources: [{ provider: "NewsAPI", query, url: safe.toString() }] };
}

function scoreNewsSentiment(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      available: false,
      score: null,
      label: "Không có tin",
      positive_hits: 0,
      negative_hits: 0,
      confidence: 0,
      notes: ["Khong co tin tuc de tinh sentiment."]
    };
  }

  let positiveHits = 0;
  let negativeHits = 0;

  for (const item of items) {
    const content = normalizeText(`${item.title || ""} ${item.snippet || ""}`);
    let localPos = 0;
    let localNeg = 0;

    for (const token of POSITIVE_NEWS_WORDS) if (content.includes(token)) localPos += 1;
    for (const token of NEGATIVE_NEWS_WORDS) if (content.includes(token)) localNeg += 1;

    if (localPos > localNeg) positiveHits += 1;
    else if (localNeg > localPos) negativeHits += 1;
  }

  const score = clamp((positiveHits - negativeHits) / Math.max(items.length, 1), -1, 1);
  return {
    available: true,
    score: round(score, 6),
    label: score > 0.2 ? "Tích cực" : score < -0.2 ? "Tiêu cực" : "Trung tính",
    positive_hits: positiveHits,
    negative_hits: negativeHits,
    confidence: round(clamp(items.length / 12, 0.15, 1), 4),
    notes: []
  };
}
async function fetchFundamentals({ symbol, resolvedSymbol, market, env }) {
  const notes = [];
  const sources = [];
  const candidates = buildSymbolCandidates(symbol, market);
  if (resolvedSymbol && !candidates.includes(resolvedSymbol)) candidates.unshift(resolvedSymbol);

  let profile = null;
  let metricsRaw = null;

  if (env.FINNHUB_API_KEY) {
    for (const cand of candidates) {
      const profileUrl = new URL("https://finnhub.io/api/v1/stock/profile2");
      profileUrl.searchParams.set("symbol", cand);
      profileUrl.searchParams.set("token", env.FINNHUB_API_KEY);

      const metricUrl = new URL("https://finnhub.io/api/v1/stock/metric");
      metricUrl.searchParams.set("symbol", cand);
      metricUrl.searchParams.set("metric", "all");
      metricUrl.searchParams.set("token", env.FINNHUB_API_KEY);

      const [profileRes, metricRes] = await Promise.all([
        fetchWithTimeout(profileUrl.toString(), { method: "GET" }, 18000),
        fetchWithTimeout(metricUrl.toString(), { method: "GET" }, 18000)
      ]);

      const pData = profileRes.ok ? await profileRes.json().catch(() => ({})) : {};
      const mData = metricRes.ok ? await metricRes.json().catch(() => ({})) : {};
      const metric = mData && typeof mData.metric === "object" ? mData.metric : {};

      if (!cleanString(pData.name) && Object.keys(metric).length === 0) continue;

      profile = {
        name: cleanString(pData.name),
        ticker: cleanString(pData.ticker) || cand,
        exchange: cleanString(pData.exchange),
        country: cleanString(pData.country),
        currency: cleanString(pData.currency),
        industry: cleanString(pData.finnhubIndustry),
        market_cap: toNum(pData.marketCapitalization),
        ipo: cleanString(pData.ipo)
      };
      metricsRaw = metric;
      sources.push(
        { provider: "Finnhub profile2", symbol: cand, url: "https://finnhub.io/docs/api/company-profile2" },
        { provider: "Finnhub metric", symbol: cand, url: "https://finnhub.io/docs/api/company-basic-financials" }
      );
      break;
    }
  } else {
    notes.push("Thieu FINNHUB_API_KEY.");
  }

  if (!profile && env.POLYGON_API_KEY) {
    const us = optionUnderlyingSymbol(resolvedSymbol || symbol);
    if (/^[A-Z]{1,6}$/.test(us)) {
      const req = new URL(`https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(us)}`);
      req.searchParams.set("apiKey", env.POLYGON_API_KEY);
      const res = await fetchWithTimeout(req.toString(), { method: "GET" }, 18000);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const r = data?.results;
        if (r && typeof r === "object") {
          profile = {
            name: cleanString(r.name),
            ticker: cleanString(r.ticker) || us,
            exchange: cleanString(r.primary_exchange),
            country: cleanString(r.locale),
            currency: cleanString(r.currency_name),
            industry: cleanString(r.sic_description),
            market_cap: toNum(r.market_cap),
            ipo: cleanString(r.list_date)
          };
          sources.push({ provider: "Polygon ticker details", symbol: us, url: "https://polygon.io/docs/stocks/get_v3_reference_tickers__ticker" });
        }
      }
    }
  }

  const metrics = {
    pe_ttm: pickNumber(metricsRaw, ["peTTM", "priceToEarningsTTM"]),
    pb_ttm: pickNumber(metricsRaw, ["pbAnnual", "priceToBookAnnual"]),
    roe_ttm: pickNumber(metricsRaw, ["roeTTM", "roeRfy"]),
    net_margin_ttm: pickNumber(metricsRaw, ["netMarginTTM", "netMarginAnnual"]),
    revenue_growth_yoy: pickNumber(metricsRaw, ["revenueGrowthTTMYoy", "revenueGrowth3Y"]),
    debt_to_equity: pickNumber(metricsRaw, ["totalDebtToEquityQuarterly", "totalDebtToEquityAnnual"]),
    beta: pickNumber(metricsRaw, ["beta", "beta1Y"])
  };

  const signal = scoreFundamentals(metrics);

  return {
    available: Boolean(profile || signal.available),
    profile: profile || {},
    metrics,
    signal,
    notes,
    sources
  };
}

function scoreFundamentals(metrics) {
  let score = 0;
  let used = 0;
  const reasons = [];

  if (Number.isFinite(metrics.pe_ttm)) {
    used += 1;
    if (metrics.pe_ttm >= 5 && metrics.pe_ttm <= 25) {
      score += 0.28;
      reasons.push("PE nam trong vung on dinh.");
    } else if (metrics.pe_ttm > 40) {
      score -= 0.24;
      reasons.push("PE cao > 40.");
    }
  }

  if (Number.isFinite(metrics.roe_ttm)) {
    used += 1;
    if (metrics.roe_ttm >= 0.15) score += 0.24;
    else if (metrics.roe_ttm <= 0.05) score -= 0.2;
  }

  if (Number.isFinite(metrics.revenue_growth_yoy)) {
    used += 1;
    if (metrics.revenue_growth_yoy >= 0.08) score += 0.2;
    else if (metrics.revenue_growth_yoy <= -0.03) score -= 0.2;
  }

  if (Number.isFinite(metrics.debt_to_equity)) {
    used += 1;
    if (metrics.debt_to_equity <= 1) score += 0.1;
    else if (metrics.debt_to_equity >= 2) score -= 0.2;
  }

  score = clamp(score, -1, 1);
  return {
    available: used > 0,
    score: used > 0 ? round(score, 6) : null,
    label: used === 0 ? "Không có dữ liệu" : score > 0.2 ? "Tích cực" : score < -0.2 ? "Tiêu cực" : "Trung tính",
    metrics_used: used,
    reasons: reasons.slice(0, 6)
  };
}

async function fetchOptionsSignal({ symbol, resolvedSymbol, env }) {
  if (!env.POLYGON_API_KEY) {
    return {
      available: false,
      signal: { score: null, label: "Không có dữ liệu", put_call_ratio_oi: null, put_call_ratio_volume: null },
      notes: ["Thieu POLYGON_API_KEY nen bo qua option flow."],
      sources: []
    };
  }

  const underlying = optionUnderlyingSymbol(resolvedSymbol || symbol);
  if (!/^[A-Z]{1,6}$/.test(underlying)) {
    return {
      available: false,
      signal: { score: null, label: "Không hỗ trợ" },
      notes: ["Option flow hien uu tien ticker US."],
      sources: []
    };
  }

  const req = new URL(`https://api.polygon.io/v3/snapshot/options/${encodeURIComponent(underlying)}`);
  req.searchParams.set("limit", "250");
  req.searchParams.set("apiKey", env.POLYGON_API_KEY);

  const res = await fetchWithTimeout(req.toString(), { method: "GET" }, 22000);
  if (!res.ok) {
    return {
      available: false,
      signal: { score: null, label: "Không có dữ liệu" },
      notes: [`Polygon option snapshot HTTP ${res.status}.`],
      sources: []
    };
  }

  const data = await res.json().catch(() => ({}));
  const list = Array.isArray(data.results) ? data.results : [];
  if (list.length === 0) {
    return {
      available: false,
      signal: { score: null, label: "Không có dữ liệu" },
      notes: ["Polygon khong tra ve option chain."],
      sources: []
    };
  }

  let callOI = 0;
  let putOI = 0;
  let callVol = 0;
  let putVol = 0;

  for (const row of list) {
    const type = cleanString(row?.details?.contract_type).toLowerCase();
    const oi = finiteOr(row.open_interest, 0);
    const vol = finiteOr(row?.day?.volume, 0);
    if (type === "call") {
      callOI += oi;
      callVol += vol;
    } else if (type === "put") {
      putOI += oi;
      putVol += vol;
    }
  }

  const oiRatio = callOI > 0 ? putOI / callOI : Number.NaN;
  const volRatio = callVol > 0 ? putVol / callVol : Number.NaN;

  let score = 0;
  if (Number.isFinite(oiRatio)) {
    if (oiRatio <= 0.8) score += 0.35;
    else if (oiRatio >= 1.2) score -= 0.35;
  }
  if (Number.isFinite(volRatio)) {
    if (volRatio <= 0.9) score += 0.25;
    else if (volRatio >= 1.15) score -= 0.25;
  }

  return {
    available: true,
    signal: {
      score: round(clamp(score, -1, 1), 6),
      label: score > 0.2 ? "Tăng" : score < -0.2 ? "Giảm" : "Trung tính",
      put_call_ratio_oi: round(oiRatio, 6),
      put_call_ratio_volume: round(volRatio, 6),
      call_open_interest: round(callOI, 2),
      put_open_interest: round(putOI, 2),
      call_volume: round(callVol, 2),
      put_volume: round(putVol, 2)
    },
    notes: [],
    sources: [{ provider: "Polygon options snapshot", symbol: underlying, url: "https://polygon.io/docs/options/get_v3_snapshot_options__underlyingasset" }]
  };
}

async function fetchMacroSignal({ market, env }) {
  if (!env.FRED_API_KEY) {
    return {
      available: false,
      signal: { score: null, label: "Không có dữ liệu" },
      metrics: {},
      notes: ["Thieu FRED_API_KEY nen bo qua macro model."],
      sources: []
    };
  }

  const [dff, unrate, spread, vix] = await Promise.all([
    fetchFredSeries({ apiKey: env.FRED_API_KEY, seriesId: "DFF", limit: 4 }),
    fetchFredSeries({ apiKey: env.FRED_API_KEY, seriesId: "UNRATE", limit: 4 }),
    fetchFredSeries({ apiKey: env.FRED_API_KEY, seriesId: "T10Y2Y", limit: 4 }),
    fetchFredSeries({ apiKey: env.FRED_API_KEY, seriesId: "VIXCLS", limit: 4 })
  ]);

  const metrics = {
    policy_rate: dff.current,
    policy_rate_change: subtract(dff.current, dff.prev),
    unemployment_rate: unrate.current,
    unemployment_change: subtract(unrate.current, unrate.prev),
    yield_spread_10y2y: spread.current,
    vix: vix.current
  };

  let score = 0;
  if (Number.isFinite(metrics.policy_rate)) {
    if (metrics.policy_rate <= 2.5) score += 0.12;
    else if (metrics.policy_rate >= 5) score -= 0.18;
  }
  if (Number.isFinite(metrics.policy_rate_change)) {
    if (metrics.policy_rate_change < 0) score += 0.15;
    else if (metrics.policy_rate_change > 0) score -= 0.15;
  }
  if (Number.isFinite(metrics.unemployment_change)) {
    if (metrics.unemployment_change >= 0.2) score -= 0.14;
    else if (metrics.unemployment_change <= -0.2) score += 0.08;
  }
  if (Number.isFinite(metrics.yield_spread_10y2y)) {
    if (metrics.yield_spread_10y2y < 0) score -= 0.12;
    else score += 0.08;
  }
  if (Number.isFinite(metrics.vix)) {
    if (metrics.vix >= 25) score -= 0.18;
    else if (metrics.vix <= 16) score += 0.1;
  }

  return {
    available: true,
    signal: {
      score: round(clamp(score, -1, 1), 6),
      label: score > 0.15 ? "Ưa rủi ro" : score < -0.15 ? "Né rủi ro" : "Trung tính"
    },
    metrics,
    market_scope: market === "VN" ? "Global macro proxy (US-led)" : "US macro regime",
    notes: [],
    sources: [
      { provider: "FRED DFF", series: "DFF", url: "https://fred.stlouisfed.org/series/DFF" },
      { provider: "FRED UNRATE", series: "UNRATE", url: "https://fred.stlouisfed.org/series/UNRATE" },
      { provider: "FRED T10Y2Y", series: "T10Y2Y", url: "https://fred.stlouisfed.org/series/T10Y2Y" },
      { provider: "FRED VIXCLS", series: "VIXCLS", url: "https://fred.stlouisfed.org/series/VIXCLS" }
    ]
  };
}

async function fetchFredSeries({ apiKey, seriesId, limit }) {
  const req = new URL("https://api.stlouisfed.org/fred/series/observations");
  req.searchParams.set("series_id", seriesId);
  req.searchParams.set("api_key", apiKey);
  req.searchParams.set("file_type", "json");
  req.searchParams.set("sort_order", "desc");
  req.searchParams.set("limit", String(limit));

  const res = await fetchWithTimeout(req.toString(), { method: "GET" }, 22000);
  if (!res.ok) return { points: [], current: Number.NaN, prev: Number.NaN };

  const data = await res.json().catch(() => ({}));
  const points = (Array.isArray(data.observations) ? data.observations : [])
    .map((o) => ({ date: cleanString(o.date), value: toNum(o.value) }))
    .filter((x) => Number.isFinite(x.value));

  return { points, current: points[0]?.value, prev: points[1]?.value };
}

async function fetchOnChainSignal({ symbol }) {
  if (detectAssetType(symbol) !== "crypto") {
    return {
      available: false,
      signal: { score: null, label: "Không phải crypto" },
      metrics: {},
      notes: ["On-chain snapshot chi ap dung cho crypto."],
      sources: []
    };
  }

  const coinId = mapCryptoToCoingeckoId(symbol);
  if (!coinId) {
    return {
      available: false,
      signal: { score: null, label: "Không hỗ trợ" },
      metrics: {},
      notes: ["Chua map duoc ma crypto sang Coingecko id."],
      sources: []
    };
  }

  const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("ids", coinId);
  url.searchParams.set("price_change_percentage", "24h,7d,30d");

  const res = await fetchWithTimeout(url.toString(), { method: "GET" }, 22000);
  if (!res.ok) {
    return {
      available: false,
      signal: { score: null, label: "Không có dữ liệu" },
      metrics: {},
      notes: [`Coingecko HTTP ${res.status}.`],
      sources: []
    };
  }

  const data = await res.json().catch(() => []);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    return {
      available: false,
      signal: { score: null, label: "Không có dữ liệu" },
      metrics: {},
      notes: ["Coingecko khong tra ve du lieu coin."],
      sources: []
    };
  }

  const metrics = {
    id: coinId,
    market_cap_rank: toNum(row.market_cap_rank),
    market_cap_usd: toNum(row.market_cap),
    total_volume_usd: toNum(row.total_volume),
    price_change_24h_pct: toNum(row.price_change_percentage_24h_in_currency),
    price_change_7d_pct: toNum(row.price_change_percentage_7d_in_currency),
    price_change_30d_pct: toNum(row.price_change_percentage_30d_in_currency)
  };

  const vtoc = Number.isFinite(metrics.total_volume_usd) && Number.isFinite(metrics.market_cap_usd)
    ? metrics.total_volume_usd / Math.max(metrics.market_cap_usd, EPSILON)
    : Number.NaN;
  metrics.volume_to_market_cap = vtoc;

  let score = 0;
  if (Number.isFinite(metrics.price_change_7d_pct)) {
    if (metrics.price_change_7d_pct >= 5) score += 0.28;
    else if (metrics.price_change_7d_pct <= -5) score -= 0.28;
  }
  if (Number.isFinite(metrics.price_change_30d_pct)) {
    if (metrics.price_change_30d_pct >= 12) score += 0.24;
    else if (metrics.price_change_30d_pct <= -12) score -= 0.24;
  }
  if (Number.isFinite(vtoc)) {
    if (vtoc >= 0.08) score += 0.12;
    else if (vtoc <= 0.02) score -= 0.08;
  }
  if (Number.isFinite(metrics.market_cap_rank) && metrics.market_cap_rank <= 10) score += 0.05;

  return {
    available: true,
    signal: { score: round(clamp(score, -1, 1), 6), label: score > 0.2 ? "Tích cực" : score < -0.2 ? "Tiêu cực" : "Trung tính" },
    metrics,
    notes: [],
    sources: [{ provider: "Coingecko markets", symbol: coinId, url: "https://www.coingecko.com/en/api/documentation" }]
  };
}

function emptyVietnamLocalMarket(note = "Không có dữ liệu VN local.") {
  return {
    available: false,
    signal: { score: null, label: "Không có dữ liệu" },
    gold: {},
    fx: {},
    notes: [note],
    sources: []
  };
}

async function fetchVietnamLocalMarket({ env }) {
  const notes = [];
  const sources = [];

  const sjcUrl = cleanString(env.SJC_PRICE_API_URL) || "https://sjc.com.vn/GoldPrice/Services/PriceService.ashx";
  const vcbXmlUrl =
    cleanString(env.VCB_EXRATE_XML_URL) ||
    "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx?b=10";

  let sjcGold = null;
  let sjcFx = null;
  let vcbFx = null;

  try {
    const sjcCurrentRes = await fetchWithTimeout(
      sjcUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
        }
      },
      18000
    );
    if (sjcCurrentRes.ok) {
      const data = await sjcCurrentRes.json().catch(() => ({}));
      sjcGold = normalizeSjcGoldPayload(data);
      sources.push({ provider: "SJC current gold", url: "https://sjc.com.vn/" });
    } else {
      notes.push(`SJC current gold HTTP ${sjcCurrentRes.status}.`);
    }
  } catch (error) {
    notes.push(`SJC current gold loi: ${cleanString(String(error?.message || error))}.`);
  }

  try {
    const body = new URLSearchParams();
    body.set("method", "GetExchangeRate");
    const sjcFxRes = await fetchWithTimeout(
      sjcUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: body.toString()
      },
      18000
    );
    if (sjcFxRes.ok) {
      const data = await sjcFxRes.json().catch(() => ({}));
      sjcFx = normalizeSjcFxPayload(data);
      sources.push({ provider: "SJC exchange rate", url: "https://sjc.com.vn/" });
    } else {
      notes.push(`SJC exchange rate HTTP ${sjcFxRes.status}.`);
    }
  } catch (error) {
    notes.push(`SJC exchange rate loi: ${cleanString(String(error?.message || error))}.`);
  }

  try {
    const vcbRes = await fetchWithTimeout(vcbXmlUrl, { method: "GET" }, 18000);
    if (vcbRes.ok) {
      const xml = await vcbRes.text();
      vcbFx = parseVcbUsdFromXml(xml);
      sources.push({ provider: "Vietcombank XML rates", url: "https://portal.vietcombank.com.vn/" });
    } else {
      notes.push(`VCB XML HTTP ${vcbRes.status}.`);
    }
  } catch (error) {
    notes.push(`VCB XML loi: ${cleanString(String(error?.message || error))}.`);
  }

  const gold = sjcGold || {};
  const fx = {
    usd_sjc: sjcFx || null,
    usd_vcb: vcbFx || null
  };

  const available = Boolean(
    (sjcGold && Number.isFinite(sjcGold.buy) && Number.isFinite(sjcGold.sell)) ||
      (sjcFx && Number.isFinite(sjcFx.buy) && Number.isFinite(sjcFx.sell)) ||
      (vcbFx && Number.isFinite(vcbFx.buy) && Number.isFinite(vcbFx.sell))
  );

  const signal = scoreVietnamLocalMarket({
    gold,
    usdSjc: fx.usd_sjc,
    usdVcb: fx.usd_vcb
  });

  if (!available && notes.length === 0) {
    notes.push("Khong lay duoc du lieu VN local tu cac nguon cong khai.");
  }

  return {
    available,
    signal,
    gold,
    fx,
    notes: notes.slice(0, 8),
    sources
  };
}

function normalizeSjcGoldPayload(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (rows.length === 0) return null;

  const target =
    rows.find((row) => normalizeText(row.TypeName || "").includes("1l")) ||
    rows.find((row) => normalizeText(row.TypeName || "").includes("sjc")) ||
    rows[0];

  return {
    type_name: cleanString(target?.TypeName),
    branch_name: cleanString(target?.BranchName),
    buy: parseLocaleNumber(target?.BuyValue ?? target?.Buy),
    sell: parseLocaleNumber(target?.SellValue ?? target?.Sell),
    spread: null,
    spread_pct: null,
    updated_at: cleanString(payload?.latestDate)
  };
}

function normalizeSjcFxPayload(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const usd = rows.find((row) => cleanString(row.CurrencyCode).toUpperCase() === "USD");
  if (!usd) return null;
  return {
    source: "SJC",
    buy: parseLocaleNumber(usd.Buy),
    transfer: parseLocaleNumber(usd.Transfer),
    sell: parseLocaleNumber(usd.Sell),
    updated_at: cleanString(payload?.latestDate)
  };
}

function parseVcbUsdFromXml(xml) {
  const content = String(xml || "");
  const usdTag = content.match(/<Exrate[^>]*CurrencyCode=\"USD\"[^>]*>/i);
  if (!usdTag) return null;
  const tag = usdTag[0];
  return {
    source: "Vietcombank",
    buy: parseLocaleNumber(readXmlAttr(tag, "Buy")),
    transfer: parseLocaleNumber(readXmlAttr(tag, "Transfer")),
    sell: parseLocaleNumber(readXmlAttr(tag, "Sell")),
    updated_at: extractXmlNodeText(content, "DateTime")
  };
}

function readXmlAttr(tag, attrName) {
  const regex = new RegExp(`${attrName}=\"([^\"]*)\"`, "i");
  const match = String(tag || "").match(regex);
  return match ? match[1] : "";
}

function extractXmlNodeText(xml, nodeName) {
  const regex = new RegExp(`<${nodeName}>([\\s\\S]*?)<\\/${nodeName}>`, "i");
  const match = String(xml || "").match(regex);
  return match ? cleanString(match[1]) : "";
}

function parseLocaleNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  const raw = cleanString(String(value || ""));
  if (!raw || raw === "-") return Number.NaN;
  const normalized = raw.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function scoreVietnamLocalMarket({ gold, usdSjc, usdVcb }) {
  let score = 0;
  const notes = [];

  if (Number.isFinite(gold.buy) && Number.isFinite(gold.sell) && gold.sell > 0) {
    const spread = gold.sell - gold.buy;
    const spreadPct = spread / gold.sell;
    gold.spread = round(spread, 2);
    gold.spread_pct = round(spreadPct, 6);
    if (spreadPct <= 0.015) score += 0.06;
    else if (spreadPct >= 0.03) score -= 0.08;
    notes.push(`Spread vang SJC ${round(spreadPct * 100, 2)}%.`);
  }

  const usdRef = chooseUsdRef(usdVcb, usdSjc);
  if (usdRef && Number.isFinite(usdRef.buy) && Number.isFinite(usdRef.sell) && usdRef.sell > 0) {
    const spread = usdRef.sell - usdRef.buy;
    const spreadPct = spread / usdRef.sell;
    if (spreadPct <= 0.008) score += 0.04;
    else if (spreadPct >= 0.02) score -= 0.05;
    if (usdRef.sell >= 26500) score -= 0.03;
    else if (usdRef.sell <= 24500) score += 0.03;
    notes.push(`Spread USD ${usdRef.source} ${round(spreadPct * 100, 2)}%.`);
  }

  const normalized = clamp(score, -1, 1);
  return {
    score: round(normalized, 6),
    label: normalized > 0.15 ? "Ổn định tích cực" : normalized < -0.15 ? "Áp lực rủi ro" : "Trung tính",
    notes
  };
}

function chooseUsdRef(vcb, sjc) {
  if (vcb && Number.isFinite(vcb.sell)) return vcb;
  if (sjc && Number.isFinite(sjc.sell)) return sjc;
  return null;
}

function buildMultiSourceScore({
  indicators,
  primaryProjection,
  newsSentiment,
  fundamentals,
  options,
  macro,
  onChain,
  vietnamLocal,
  historySize
}) {
  const components = [];

  const technicalScore = clamp((toNum(indicators.trend_score) || 0) / 4, -1, 1);
  const projectionScore = Number.isFinite(primaryProjection?.expected_pct) ? clamp(primaryProjection.expected_pct / 0.07, -1, 1) : null;

  components.push(componentNode("technical", "Kỹ thuật", technicalScore, indicators.trend_score));
  components.push(componentNode("projection", "Dự báo", projectionScore, primaryProjection?.expected_pct));
  components.push(componentNode("news", "Tin tức", newsSentiment?.available ? toNum(newsSentiment.score) : null, newsSentiment?.label));
  components.push(componentNode("fundamentals", "Cơ bản doanh nghiệp", fundamentals?.signal?.available ? toNum(fundamentals.signal.score) : null, fundamentals?.signal?.label));
  components.push(componentNode("options", "Dòng tiền quyền chọn", options?.available ? toNum(options.signal?.score) : null, options?.signal?.label));
  components.push(componentNode("macro", "Vĩ mô", macro?.available ? toNum(macro.signal?.score) : null, macro?.signal?.label));
  components.push(componentNode("on_chain", "On-chain", onChain?.available ? toNum(onChain.signal?.score) : null, onChain?.signal?.label));
  components.push(componentNode("vn_local", "Thị trường nội địa VN", vietnamLocal?.available ? toNum(vietnamLocal.signal?.score) : null, vietnamLocal?.signal?.label));

  let weighted = 0;
  let totalWeight = 0;
  let activeCount = 0;

  for (const c of components) {
    c.weight = WEIGHT_CONFIG[c.key] || 0;
    if (Number.isFinite(c.score)) {
      c.contribution = round(c.score * c.weight, 6);
      weighted += c.score * c.weight;
      totalWeight += c.weight;
      activeCount += 1;
    } else {
      c.contribution = null;
    }
  }

  const composite = totalWeight > 0 ? weighted / totalWeight : 0;
  const normalized = clamp(composite, -1, 1);
  const confidence = clamp((0.3 + activeCount * 0.08 + (historySize >= 240 ? 0.12 : 0.04)) * (totalWeight / sumWeights()), 0.2, 0.96);

  const sorted = components
    .filter((x) => Number.isFinite(x.contribution))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return {
    score: round(normalized, 6),
    confidence: round(confidence, 6),
    direction: normalized > 0.16 ? "bullish" : normalized < -0.16 ? "bearish" : "sideways",
    strength: Math.abs(normalized) >= 0.5 ? "high" : Math.abs(normalized) >= 0.25 ? "medium" : "low",
    signal: signalFromPct(normalized * 0.1),
    components,
    explanation: sorted
      .slice(0, 3)
      .map((x) => `${x.label} ${x.contribution >= 0 ? "hỗ trợ tăng" : "kéo giảm"} (${round(x.contribution, 4)}).`)
  };
}

function componentNode(key, label, score, raw) {
  return {
    key,
    label,
    score: Number.isFinite(score) ? round(score, 6) : null,
    raw: Number.isFinite(raw) ? round(raw, 8) : raw ?? null,
    weight: null,
    contribution: null
  };
}

function sumWeights() {
  return Object.values(WEIGHT_CONFIG).reduce((acc, n) => acc + n, 0);
}
function parseHorizonList(rawHorizons, horizonValue, horizonUnit) {
  const tokens = [];
  if (typeof rawHorizons === "string" && rawHorizons.trim()) {
    tokens.push(...rawHorizons.split(/[,;\n|]+/).map((x) => x.trim()));
  }
  if (tokens.length === 0 && Number.isFinite(Number(horizonValue))) {
    tokens.push(`${Number(horizonValue)}${unitChar(horizonUnit)}`);
  }
  if (tokens.length === 0) tokens.push("5d");

  const out = [];
  const dedup = new Set();

  for (const token of tokens) {
    const m = cleanString(token).toLowerCase().match(/^(\d{1,3})\s*([dwmy])$/);
    if (!m) continue;
    const value = clampInt(m[1], 1, 260, 1);
    const unit = m[2];
    const key = `${value}${unit}`;
    if (dedup.has(key)) continue;
    dedup.add(key);
    out.push(toHorizon(value, unit));
    if (out.length >= 8) break;
  }

  return out.length > 0 ? out : [toHorizon(5, "d")];
}

function toHorizon(value, unit) {
  const u = unitChar(unit);
  const tradingDays =
    u === "d" ? value : u === "w" ? value * 5 : u === "m" ? value * 21 : value * 252;
  const text =
    u === "d"
      ? `${value} ngày`
      : u === "w"
      ? `${value} tuần`
      : u === "m"
      ? `${value} tháng`
      : `${value} năm`;
  return {
    value,
    unit: u,
    label: `${value}${u.toUpperCase()}`,
    tradingDays,
    text
  };
}

function unitChar(value) {
  const x = cleanString(String(value || "")).toLowerCase();
  if (x.startsWith("w") || x.startsWith("t")) return "w";
  if (x.startsWith("y") || x.startsWith("n")) return "y";
  if (x.startsWith("m")) return "m";
  return "d";
}

function signalFromPct(pct) {
  if (!Number.isFinite(pct)) return withSignalMeta("flat");
  if (Math.abs(pct) < 0.002) return withSignalMeta("flat");
  if (pct >= 0.07) return withSignalMeta("strong-up");
  if (pct > 0) return withSignalMeta("mild-up");
  if (pct <= -0.07) return withSignalMeta("strong-down");
  return withSignalMeta("mild-down");
}

function withSignalMeta(key) {
  return { key, ...(SIGNAL_META[key] || SIGNAL_META.flat) };
}

function normalizeMarket(input) {
  const raw = cleanString(input).toUpperCase();
  if (raw === "VN" || raw === "US") return raw;
  return "AUTO";
}

function inferCurrency(symbol, market) {
  if (market === "VN" || /\.VN$/i.test(symbol)) return "VND";
  return "USD";
}

function detectAssetType(symbol) {
  const raw = cleanString(symbol).toUpperCase();
  if (raw.includes("-USD") || raw === "BTC" || raw === "ETH" || raw === "SOL") return "crypto";
  if (raw.endsWith("=X")) return "fx";
  return "equity";
}

function mapCryptoToCoingeckoId(symbol) {
  const base = cleanString(symbol).toUpperCase().replace(/-USD$/, "");
  const map = {
    BTC: "bitcoin",
    ETH: "ethereum",
    BNB: "binancecoin",
    SOL: "solana",
    XRP: "ripple",
    ADA: "cardano",
    DOGE: "dogecoin",
    TON: "the-open-network",
    AVAX: "avalanche-2",
    DOT: "polkadot",
    MATIC: "matic-network",
    LTC: "litecoin",
    BCH: "bitcoin-cash",
    TRX: "tron"
  };
  return map[base] || null;
}

function optionUnderlyingSymbol(symbol) {
  const clean = cleanString(symbol).toUpperCase();
  if (clean.includes(".")) return clean.split(".")[0];
  if (clean.includes("-")) return clean.split("-")[0];
  return clean;
}

function toYahooRange(days) {
  if (days <= 30) return "1mo";
  if (days <= 90) return "3mo";
  if (days <= 180) return "6mo";
  if (days <= 365) return "1y";
  if (days <= 730) return "2y";
  if (days <= 1825) return "5y";
  return "10y";
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function std(values) {
  if (!Array.isArray(values) || values.length === 0) return Number.NaN;
  const m = mean(values);
  let acc = 0;
  for (const value of values) acc += (value - m) ** 2;
  return Math.sqrt(acc / values.length);
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function normalizeText(text) {
  return cleanString(String(text || "")).toLowerCase();
}

function subtract(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : Number.NaN;
}

function pickNumber(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const n = toNum(obj[key]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function finiteOr(value, fallback) {
  const n = toNum(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanString(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

