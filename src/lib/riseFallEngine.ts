// AI Rise/Fall probability engine — multi-indicator confluence scoring.
// Returns a weighted probability + explainable reasons + risk band.
import type { Tick } from "./analytics";
import { ema, rsi, macd, volatility, sma } from "./analytics";

export type IndicatorVote = {
  name: string;
  signal: "RISE" | "FALL" | "NEUTRAL";
  weight: number;
  value: string;
  reason: string;
};

export type RiseFallScan = {
  pRise: number;
  pFall: number;
  confidence: number;
  signal: "RISE" | "FALL" | "NO TRADE";
  strength: "Strong Signal" | "Moderate Signal" | "No Trade";
  risk: "LOW" | "MEDIUM" | "HIGH";
  votes: IndicatorVote[];
  health: {
    trendStrength: number;   // -1..1
    volatilityScore: number; // 0..100
    stability: number;       // 0..100
    momentumDir: "UP" | "DOWN" | "FLAT";
    quality: number;         // 0..100
    manipulation: number;    // 0..1
  };
  stakes: { conservative: number; moderate: number; aggressive: number };
  reasoning: string[];
  scannedAt: number;
  ticks: number;
};

// ---- helpers ----
function stdev(arr: number[]) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}
function atr(ticks: Tick[], n = 14) {
  if (ticks.length < n + 1) return 0;
  const trs: number[] = [];
  for (let i = ticks.length - n; i < ticks.length; i++) {
    trs.push(Math.abs(ticks[i].price - ticks[i - 1].price));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}
function bollinger(prices: number[], n = 20, k = 2) {
  const s = prices.slice(-n);
  const mid = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = stdev(s);
  return { mid, upper: mid + k * sd, lower: mid - k * sd, bandwidth: (2 * k * sd) / (mid || 1) };
}
function stochRsi(prices: number[], n = 14) {
  const rs: number[] = [];
  for (let i = n; i < prices.length; i++) {
    rs.push(rsi(prices.slice(0, i + 1), n));
  }
  if (rs.length < n) return 50;
  const last = rs.slice(-n);
  const min = Math.min(...last), max = Math.max(...last);
  const cur = rs[rs.length - 1];
  return max === min ? 50 : ((cur - min) / (max - min)) * 100;
}
function adx(ticks: Tick[], n = 14) {
  if (ticks.length < n + 2) return 0;
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = ticks.length - n; i < ticks.length; i++) {
    const up = ticks[i].price - ticks[i - 1].price;
    if (up > 0) plusDM += up; else minusDM += -up;
    tr += Math.abs(up);
  }
  const pDI = (plusDM / (tr || 1)) * 100;
  const mDI = (minusDM / (tr || 1)) * 100;
  const dx = (Math.abs(pDI - mDI) / ((pDI + mDI) || 1)) * 100;
  return dx;
}
function momentum(prices: number[], n = 10) {
  if (prices.length < n + 1) return 0;
  const cur = prices[prices.length - 1];
  const past = prices[prices.length - 1 - n];
  return ((cur - past) / past) * 100;
}

export function scanRiseFall(ticks: Tick[], minConfidence = 65): RiseFallScan {
  const prices = ticks.map((t) => t.price);
  const now = Date.now();

  if (prices.length < 60) {
    return {
      pRise: 50, pFall: 50, confidence: 0,
      signal: "NO TRADE", strength: "No Trade", risk: "HIGH",
      votes: [],
      health: { trendStrength: 0, volatilityScore: 0, stability: 0, momentumDir: "FLAT", quality: 0, manipulation: 0 },
      stakes: { conservative: 0, moderate: 0, aggressive: 0 },
      reasoning: ["Insufficient ticks (need 60+)."],
      scannedAt: now,
      ticks: prices.length,
    };
  }

  const e10 = ema(prices.slice(-50), 10);
  const e20 = ema(prices.slice(-100), 20);
  const e50 = ema(prices, 50);
  const r = rsi(prices, 14);
  const m = macd(prices);
  const sr = stochRsi(prices, 14);
  const a = atr(ticks, 14);
  const adxV = adx(ticks, 14);
  const bb = bollinger(prices, 20, 2);
  const mom = momentum(prices, 10);
  const vol = volatility(prices, 30);
  const last = prices[prices.length - 1];
  const sma10 = sma(prices, 10), sma50 = sma(prices, 50);
  const trendStrength = ((sma10 - sma50) / sma50);

  const votes: IndicatorVote[] = [];

  // EMA stack (10>20>50 bullish, opposite bearish)
  if (e10 > e20 && e20 > e50) votes.push({ name: "EMA Stack", signal: "RISE", weight: 1.4, value: "10>20>50", reason: "Bullish EMA alignment" });
  else if (e10 < e20 && e20 < e50) votes.push({ name: "EMA Stack", signal: "FALL", weight: 1.4, value: "10<20<50", reason: "Bearish EMA alignment" });
  else votes.push({ name: "EMA Stack", signal: "NEUTRAL", weight: 0.4, value: "mixed", reason: "EMAs not aligned" });

  // RSI
  if (r > 55 && r < 70) votes.push({ name: "RSI", signal: "RISE", weight: 1.0, value: r.toFixed(1), reason: "Bullish momentum, not overbought" });
  else if (r < 45 && r > 30) votes.push({ name: "RSI", signal: "FALL", weight: 1.0, value: r.toFixed(1), reason: "Bearish momentum, not oversold" });
  else if (r >= 70) votes.push({ name: "RSI", signal: "FALL", weight: 0.7, value: r.toFixed(1), reason: "Overbought — reversal risk" });
  else if (r <= 30) votes.push({ name: "RSI", signal: "RISE", weight: 0.7, value: r.toFixed(1), reason: "Oversold — reversal potential" });
  else votes.push({ name: "RSI", signal: "NEUTRAL", weight: 0.3, value: r.toFixed(1), reason: "Mid-zone, no edge" });

  // MACD histogram
  if (m.hist > 0) votes.push({ name: "MACD", signal: "RISE", weight: 1.1, value: m.hist.toExponential(2), reason: "Positive histogram" });
  else if (m.hist < 0) votes.push({ name: "MACD", signal: "FALL", weight: 1.1, value: m.hist.toExponential(2), reason: "Negative histogram" });
  else votes.push({ name: "MACD", signal: "NEUTRAL", weight: 0.3, value: "0", reason: "Flat MACD" });

  // Stoch RSI
  if (sr > 80) votes.push({ name: "StochRSI", signal: "FALL", weight: 0.8, value: sr.toFixed(0), reason: "Stoch overbought" });
  else if (sr < 20) votes.push({ name: "StochRSI", signal: "RISE", weight: 0.8, value: sr.toFixed(0), reason: "Stoch oversold" });
  else if (sr > 55) votes.push({ name: "StochRSI", signal: "RISE", weight: 0.5, value: sr.toFixed(0), reason: "Stoch tilting up" });
  else if (sr < 45) votes.push({ name: "StochRSI", signal: "FALL", weight: 0.5, value: sr.toFixed(0), reason: "Stoch tilting down" });
  else votes.push({ name: "StochRSI", signal: "NEUTRAL", weight: 0.3, value: sr.toFixed(0), reason: "Mid" });

  // ADX (trend strength gate)
  if (adxV > 25) {
    votes.push({ name: "ADX", signal: trendStrength > 0 ? "RISE" : "FALL", weight: 1.0, value: adxV.toFixed(1), reason: "Strong trend" });
  } else {
    votes.push({ name: "ADX", signal: "NEUTRAL", weight: 0.6, value: adxV.toFixed(1), reason: "Weak / ranging" });
  }

  // Bollinger
  if (last < bb.lower) votes.push({ name: "Bollinger", signal: "RISE", weight: 0.9, value: "below band", reason: "Mean-reversion bid" });
  else if (last > bb.upper) votes.push({ name: "Bollinger", signal: "FALL", weight: 0.9, value: "above band", reason: "Mean-reversion offer" });
  else if (last > bb.mid) votes.push({ name: "Bollinger", signal: "RISE", weight: 0.4, value: "upper half", reason: "Above mid-band" });
  else votes.push({ name: "Bollinger", signal: "FALL", weight: 0.4, value: "lower half", reason: "Below mid-band" });

  // Momentum
  if (mom > 0.05) votes.push({ name: "Momentum", signal: "RISE", weight: 0.9, value: `${mom.toFixed(3)}%`, reason: "Positive 10t momentum" });
  else if (mom < -0.05) votes.push({ name: "Momentum", signal: "FALL", weight: 0.9, value: `${mom.toFixed(3)}%`, reason: "Negative 10t momentum" });
  else votes.push({ name: "Momentum", signal: "NEUTRAL", weight: 0.3, value: `${mom.toFixed(3)}%`, reason: "Flat" });

  // ATR / volatility regime
  const volScore = Math.min(100, vol * 50);
  votes.push({
    name: "ATR / Vol",
    signal: "NEUTRAL",
    weight: 0.2,
    value: `${a.toFixed(5)} · ${vol.toFixed(2)}%`,
    reason: vol > 1.5 ? "High volatility — caution" : vol < 0.3 ? "Very calm — low edge" : "Normal regime",
  });

  // Weighted tally
  let riseW = 0, fallW = 0, total = 0;
  for (const v of votes) {
    total += v.weight;
    if (v.signal === "RISE") riseW += v.weight;
    else if (v.signal === "FALL") fallW += v.weight;
  }
  const pRise = (riseW + 0.5 * (total - riseW - fallW)) / (total || 1);
  const pFall = 1 - pRise;

  const dominance = Math.abs(pRise - 0.5) * 2; // 0..1
  const trendConf = Math.min(1, adxV / 40);
  const volPenalty = vol > 1.8 ? 0.85 : vol < 0.15 ? 0.8 : 1;
  const confidence = Math.round(Math.min(99, (50 + dominance * 50 * trendConf) * volPenalty));

  // Manipulation heuristic — fast spikes vs ATR
  let spikes = 0;
  for (let i = ticks.length - 30; i < ticks.length; i++) {
    if (i < 1) continue;
    if (Math.abs(ticks[i].price - ticks[i - 1].price) > a * 3) spikes++;
  }
  const manipulation = Math.min(1, spikes / 10);

  const stability = Math.max(0, 100 - volScore - manipulation * 30);
  const momentumDir: "UP" | "DOWN" | "FLAT" = mom > 0.05 ? "UP" : mom < -0.05 ? "DOWN" : "FLAT";
  const quality = Math.round(Math.max(0, Math.min(100, confidence * (1 - manipulation * 0.5))));

  let risk: "LOW" | "MEDIUM" | "HIGH" = "HIGH";
  if (confidence >= 80 && manipulation < 0.2 && vol < 1.5) risk = "LOW";
  else if (confidence >= 70 && manipulation < 0.35) risk = "MEDIUM";

  let strength: RiseFallScan["strength"] = "No Trade";
  let signal: RiseFallScan["signal"] = "NO TRADE";
  if (confidence >= minConfidence) {
    signal = pRise > pFall ? "RISE" : "FALL";
    strength = confidence >= 75 ? "Strong Signal" : "Moderate Signal";
  }
  if (manipulation > 0.5) { signal = "NO TRADE"; strength = "No Trade"; }

  const stakes = {
    conservative: risk === "LOW" ? 1 : 0.5,
    moderate: risk === "LOW" ? 2 : risk === "MEDIUM" ? 1 : 0.5,
    aggressive: risk === "LOW" ? 4 : risk === "MEDIUM" ? 2 : 1,
  };

  const reasoning = votes
    .filter((v) => v.signal !== "NEUTRAL")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((v) => `${v.name}: ${v.signal} — ${v.reason} (${v.value})`);

  if (signal === "NO TRADE") reasoning.unshift("Confluence below threshold — staying flat.");

  return {
    pRise, pFall, confidence, signal, strength, risk, votes,
    health: { trendStrength, volatilityScore: volScore, stability, momentumDir, quality, manipulation },
    stakes,
    reasoning,
    scannedAt: now,
    ticks: prices.length,
  };
}

// ---- Backtester ----
export type BacktestResult = {
  window: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
};

export function backtestRiseFall(ticks: Tick[], window: number, minConfidence = 65): BacktestResult {
  const slice = ticks.slice(-window);
  let wins = 0, losses = 0, equity = 0, peak = 0, dd = 0, grossWin = 0, grossLoss = 0;
  const STEP = 5;
  for (let i = 60; i < slice.length - 1; i += STEP) {
    const sub = slice.slice(0, i + 1);
    const s = scanRiseFall(sub, minConfidence);
    if (s.signal === "NO TRADE") continue;
    const next = slice[i + 1].price - slice[i].price;
    const won = (s.signal === "RISE" && next > 0) || (s.signal === "FALL" && next < 0);
    if (won) { wins++; grossWin += 1; equity += 0.95; }
    else { losses++; grossLoss += 1; equity -= 1; }
    peak = Math.max(peak, equity);
    dd = Math.min(dd, equity - peak);
  }
  const trades = wins + losses;
  return {
    window,
    trades,
    wins,
    losses,
    winRate: trades ? wins / trades : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin,
    maxDrawdown: Math.abs(dd),
  };
}
