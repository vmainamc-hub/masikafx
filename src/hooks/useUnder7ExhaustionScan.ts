// UNDER 7 Exhaustion Scanner — streak-based AI scanner across all Deriv synthetic markets.
// Strategy:
//   1) Detect >=3 consecutive OVER 5 digits (digit in 6..9).
//   2) Wait for at least 1 confirmation digit UNDER 4 (digit in 0..3) afterwards.
//   3) Emit an UNDER 7 signal (with quality filters).
//   4) If the UNDER 7 loses, queue a UNDER 5 recovery signal that only fires when
//      low-digit (0-4) dominance is rising and high-digit (7-9) dominance is weakening
//      and manipulation score is acceptable.
// Continuously scans ALL Deriv synthetic indices on a 500-tick window.

import { useEffect, useRef, useState } from "react";
import { DERIV_SYMBOLS } from "./useDerivStream";
import { lastDigit, marketIntel, type Tick } from "@/lib/analytics";

const APP_ID = 1089;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const WINDOW = 1000; // align with Digits 0–9 Live Distribution panel
const MAX_TICKS = 1020;
const SNAPSHOT_INTERVAL_MS = 1500;
const SNAPSHOT_KEEP = 14;
const COOLDOWN_MS = 45_000;
const RESOLUTION_TICKS = 5;
const HISTORY_MAX = 30;
const WINRATE_MAX = 100;
const RECOVERY_TTL_MS = 60_000;

const SCAN_SYMBOLS = DERIV_SYMBOLS.filter((s) => s.group === "Standard" || s.group === "1s");

export type U7Kind = "UNDER7" | "UNDER5_RECOVERY";

export type U7Signal = {
  id: string;
  kind: U7Kind;
  symbol: string;
  name: string;
  ts: number;
  conf: number;
  manipulation: number;
  over5Streak: number;        // consecutive OVER 5 digits detected before confirmation
  under4Confirmed: boolean;
  lowDom: number;             // % digits 0..4 in 500-tick window
  midDom: number;             // % digits 5..6
  highDom: number;            // % digits 7..9
  lowMomentum: "RISING" | "FALLING" | "FLAT";
  highMomentum: "RISING" | "FALLING" | "FLAT";
  stability: number;          // 0..1 (1 = very stable)
  rank: number;               // 0..100 safety rank
  entryPrice: number;
  lastDigit: number;
  status: string;             // "SAFE ENTRY" | "CAUTION"
};

export type U7Resolved = U7Signal & { outcome: "WIN" | "LOSS" | "PENDING"; resolvedAt?: number };

type Snapshot = { t: number; low: number; mid: number; high: number };

function group(ticks: Tick[]) {
  let low = 0, mid = 0, high = 0;
  for (const tk of ticks) {
    const d = lastDigit(tk.price);
    if (d <= 4) low++;
    else if (d <= 6) mid++;
    else high++;
  }
  const tot = Math.max(1, ticks.length);
  return { low: low / tot, mid: mid / tot, high: high / tot };
}

function momentum(snaps: Snapshot[], key: "low" | "mid" | "high"): "RISING" | "FALLING" | "FLAT" {
  if (snaps.length < 4) return "FLAT";
  const recent = snaps.slice(-3).reduce((a, s) => a + s[key], 0) / 3;
  const earlier = snaps.slice(0, 3).reduce((a, s) => a + s[key], 0) / 3;
  const d = recent - earlier;
  if (d > 0.015) return "RISING";
  if (d < -0.015) return "FALLING";
  return "FLAT";
}

function detectOver5Streak(ticks: Tick[]): { streak: number; under4After: boolean; lastIdx: number } {
  // Walk recent window, find the most recent maximal consecutive OVER 5 run, then check
  // whether any UNDER 4 digit appeared after it.
  const recent = ticks.slice(-60);
  let bestStreak = 0;
  let bestEndIdx = -1;
  let cur = 0;
  for (let i = 0; i < recent.length; i++) {
    const d = lastDigit(recent[i].price);
    if (d > 5) {
      cur++;
      if (cur >= bestStreak) { bestStreak = cur; bestEndIdx = i; }
    } else {
      cur = 0;
    }
  }
  if (bestStreak < 3) return { streak: bestStreak, under4After: false, lastIdx: bestEndIdx };
  let under4After = false;
  for (let i = bestEndIdx + 1; i < recent.length; i++) {
    const d = lastDigit(recent[i].price);
    if (d <= 3) { under4After = true; break; }
  }
  return { streak: bestStreak, under4After, lastIdx: bestEndIdx };
}

function chaosScore(ticks: Tick[]): number {
  // Violent alternation = many sign changes between low/high. 0 = calm, 1 = chaotic.
  const recent = ticks.slice(-40);
  if (recent.length < 5) return 0;
  let flips = 0;
  let prev: "L" | "H" | null = null;
  for (const tk of recent) {
    const d = lastDigit(tk.price);
    const tag: "L" | "H" | null = d <= 4 ? "L" : d >= 7 ? "H" : null;
    if (tag && prev && tag !== prev) flips++;
    if (tag) prev = tag;
  }
  return Math.min(1, flips / (recent.length * 0.6));
}

export type U7Thresholds = {
  minStreak: number;
  lowDomMin: number;
  highDomMax: number;
  midDomMax: number;
  manipMax: number;
  stabilityMin: number;
  emitConfMin: number;
};

const DEFAULT_THRESHOLDS: U7Thresholds = {
  minStreak: 3,
  lowDomMin: 0.40,
  highDomMax: 0.38,
  midDomMax: 0.32,
  manipMax: 0.18,
  stabilityMin: 0.55,
  emitConfMin: 74,
};

// Tuning bounds: when "tightening" we move toward stricter values; when "loosening" toward laxer.
const STRICT: U7Thresholds = {
  minStreak: 5, lowDomMin: 0.50, highDomMax: 0.30, midDomMax: 0.26,
  manipMax: 0.10, stabilityMin: 0.78, emitConfMin: 86,
};
const LAX: U7Thresholds = {
  minStreak: 3, lowDomMin: 0.34, highDomMax: 0.44, midDomMax: 0.36,
  manipMax: 0.24, stabilityMin: 0.45, emitConfMin: 68,
};

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function tuneThresholds(prev: U7Thresholds, recent: U7Resolved[]): U7Thresholds {
  const resolved = recent.filter((r) => r.outcome === "WIN" || r.outcome === "LOSS").slice(0, 20);
  if (resolved.length < 6) return prev;
  const wins = resolved.filter((r) => r.outcome === "WIN").length;
  const rate = wins / resolved.length;
  // target ~70% win rate; t>0 → tighten toward STRICT; t<0 → loosen toward LAX
  const t = Math.max(-1, Math.min(1, (0.70 - rate) * 2));
  const step = 0.15; // smoothness
  const target: U7Thresholds = t >= 0
    ? {
        minStreak: lerp(prev.minStreak, STRICT.minStreak, t),
        lowDomMin: lerp(prev.lowDomMin, STRICT.lowDomMin, t),
        highDomMax: lerp(prev.highDomMax, STRICT.highDomMax, t),
        midDomMax: lerp(prev.midDomMax, STRICT.midDomMax, t),
        manipMax: lerp(prev.manipMax, STRICT.manipMax, t),
        stabilityMin: lerp(prev.stabilityMin, STRICT.stabilityMin, t),
        emitConfMin: lerp(prev.emitConfMin, STRICT.emitConfMin, t),
      }
    : {
        minStreak: lerp(prev.minStreak, LAX.minStreak, -t),
        lowDomMin: lerp(prev.lowDomMin, LAX.lowDomMin, -t),
        highDomMax: lerp(prev.highDomMax, LAX.highDomMax, -t),
        midDomMax: lerp(prev.midDomMax, LAX.midDomMax, -t),
        manipMax: lerp(prev.manipMax, LAX.manipMax, -t),
        stabilityMin: lerp(prev.stabilityMin, LAX.stabilityMin, -t),
        emitConfMin: lerp(prev.emitConfMin, LAX.emitConfMin, -t),
      };
  return {
    minStreak: Math.round(lerp(prev.minStreak, target.minStreak, step)),
    lowDomMin: +lerp(prev.lowDomMin, target.lowDomMin, step).toFixed(3),
    highDomMax: +lerp(prev.highDomMax, target.highDomMax, step).toFixed(3),
    midDomMax: +lerp(prev.midDomMax, target.midDomMax, step).toFixed(3),
    manipMax: +lerp(prev.manipMax, target.manipMax, step).toFixed(3),
    stabilityMin: +lerp(prev.stabilityMin, target.stabilityMin, step).toFixed(3),
    emitConfMin: Math.round(lerp(prev.emitConfMin, target.emitConfMin, step)),
  };
}

export function useUnder7ExhaustionScan(enabled: boolean) {
  const [signals, setSignals] = useState<U7Signal[]>([]);
  const [history, setHistory] = useState<U7Resolved[]>([]);
  const [winRate, setWinRate] = useState({ wins: 0, losses: 0 });
  const [ranking, setRanking] = useState<{ symbol: string; name: string; rank: number; stability: number; lowDom: number; highDom: number; manipulation: number }[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [thresholds, setThresholds] = useState<U7Thresholds>(DEFAULT_THRESHOLDS);

  const thresholdsRef = useRef<U7Thresholds>(DEFAULT_THRESHOLDS);
  const ticksRef = useRef<Record<string, Tick[]>>({});
  const snapshotsRef = useRef<Record<string, Snapshot[]>>({});
  const lastSnapshotAt = useRef<Record<string, number>>({});
  const cooldownRef = useRef<Record<string, number>>({});
  const recoveryQueueRef = useRef<Record<string, { ts: number }>>({}); // pending recovery per symbol
  const pendingRef = useRef<{ sig: U7Resolved; remaining: number; hadWin: boolean }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      wsRef.current = null;
      ticksRef.current = {};
      snapshotsRef.current = {};
      setSignals([]);
      setRanking([]);
      setStatus("idle");
      return;
    }

    setStatus("connecting");
    ticksRef.current = {};
    snapshotsRef.current = {};
    lastSnapshotAt.current = {};
    pendingRef.current = [];
    recoveryQueueRef.current = {};

    let ws: WebSocket;
    try { ws = new WebSocket(WS_URL); } catch { setStatus("error"); return; }
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("live");
      for (const s of SCAN_SYMBOLS) {
        ws.send(JSON.stringify({
          ticks_history: s.symbol, adjust_start_time: 1, count: WINDOW,
          end: "latest", style: "ticks", subscribe: 1,
        }));
      }
    };

    let raf: number | null = null;
    const scheduleRecompute = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const now = Date.now();
        const out: U7Signal[] = [];
        const newHistory: U7Resolved[] = [];
        const rankArr: typeof ranking = [];

        for (const s of SCAN_SYMBOLS) {
          const allTicks = ticksRef.current[s.symbol];
          if (!allTicks || allTicks.length < 150) continue;
          const ticks = allTicks.slice(-WINDOW);
          const g = group(ticks);
          const intel = marketIntel(ticks);
          const chaos = chaosScore(ticks);
          const stability = Math.max(0, 1 - chaos);

          if (now - (lastSnapshotAt.current[s.symbol] ?? 0) >= SNAPSHOT_INTERVAL_MS) {
            const arr = snapshotsRef.current[s.symbol] ?? [];
            arr.push({ t: now, low: g.low, mid: g.mid, high: g.high });
            while (arr.length > SNAPSHOT_KEEP) arr.shift();
            snapshotsRef.current[s.symbol] = arr;
            lastSnapshotAt.current[s.symbol] = now;
          }
          const snaps = snapshotsRef.current[s.symbol] ?? [];
          const lowMom = momentum(snaps, "low");
          const highMom = momentum(snaps, "high");

          const lastTick = ticks[ticks.length - 1];
          const entryPrice = lastTick.price;
          const lastD = lastDigit(entryPrice);

          // Safety/quality rank for the dashboard market-ranking panel
          const rank = Math.round(Math.max(0, Math.min(100,
            g.low * 60 + stability * 30 + (1 - intel.manipulation) * 10 - g.high * 25,
          )));
          rankArr.push({
            symbol: s.symbol, name: s.name, rank, stability,
            lowDom: g.low, highDom: g.high, manipulation: intel.manipulation,
          });

          // -------- UNDER 5 RECOVERY check (only if queued by prior loss) --------
          const rec = recoveryQueueRef.current[s.symbol];
          if (rec && now - rec.ts < RECOVERY_TTL_MS) {
            const lowRising = lowMom === "RISING";
            const highWeak = highMom === "FALLING";
            const manipOk = intel.manipulation < 0.12;
            if (lowRising && highWeak && manipOk && stability > 0.7 && g.low > 0.46 && g.high < 0.30) {
              const conf = Math.round(Math.min(96,
                72 + (g.low - 0.46) * 100 + stability * 12 + (0.12 - intel.manipulation) * 40,
              ));
              const sig: U7Signal = {
                id: `u5r-${s.symbol}-${now}`, kind: "UNDER5_RECOVERY",
                symbol: s.symbol, name: s.name, ts: now,
                conf: Math.max(60, conf), manipulation: intel.manipulation,
                over5Streak: 0, under4Confirmed: true,
                lowDom: g.low, midDom: g.mid, highDom: g.high,
                lowMomentum: lowMom, highMomentum: highMom,
                stability, rank, entryPrice, lastDigit: lastD,
                status: stability > 0.7 ? "SAFE ENTRY" : "CAUTION",
              };
              out.push(sig);
              const lastTs = cooldownRef.current[s.symbol] ?? 0;
              if (now - lastTs > COOLDOWN_MS) {
                cooldownRef.current[s.symbol] = now;
                delete recoveryQueueRef.current[s.symbol];
                const resolved: U7Resolved = { ...sig, outcome: "PENDING" };
                newHistory.push(resolved);
                pendingRef.current.push({ sig: resolved, remaining: RESOLUTION_TICKS, hadWin: false });
              }
            }
          } else if (rec && now - rec.ts >= RECOVERY_TTL_MS) {
            delete recoveryQueueRef.current[s.symbol];
          }

          // -------- PRIMARY UNDER 7 entry (DYNAMIC THRESHOLDS) --------
          const TH = thresholdsRef.current;
          const { streak, under4After } = detectOver5Streak(ticks);
          const manipOk = intel.manipulation < TH.manipMax;
          const calmOk = stability > TH.stabilityMin;
          const tailWeak = g.high < TH.highDomMax;
          const lowOk = g.low > TH.lowDomMin;
          const midOk = g.mid < TH.midDomMax;
          const momOk = lowMom !== "FALLING" && highMom !== "RISING";
          const ready =
            streak >= TH.minStreak && under4After && manipOk && calmOk &&
            tailWeak && lowOk && midOk && momOk && snaps.length >= 3;

          if (ready) {
            const base = 64;
            const streakBonus = Math.min(16, (streak - TH.minStreak) * 5 + 5);
            const lowBonus = Math.min(14, (g.low - TH.lowDomMin) * 70);
            const highSuppress = Math.min(12, (TH.highDomMax - g.high) * 55);
            const calm = stability * 12;
            const manipBonus = (TH.manipMax - intel.manipulation) * 40;
            const momBoost = lowMom === "RISING" ? 8 : 4;
            const conf = Math.max(70, Math.min(98, Math.round(base + streakBonus + lowBonus + highSuppress + calm + manipBonus + momBoost)));

            const sig: U7Signal = {
              id: `u7-${s.symbol}-${now}`, kind: "UNDER7",
              symbol: s.symbol, name: s.name, ts: now,
              conf, manipulation: intel.manipulation,
              over5Streak: streak, under4Confirmed: true,
              lowDom: g.low, midDom: g.mid, highDom: g.high,
              lowMomentum: lowMom, highMomentum: highMom,
              stability, rank, entryPrice, lastDigit: lastD,
              status: stability > 0.70 && intel.manipulation < 0.10 ? "SAFE ENTRY" : "CAUTION",
            };
            out.push(sig);

            const lastTs = cooldownRef.current[s.symbol] ?? 0;
            if (conf >= TH.emitConfMin && now - lastTs > COOLDOWN_MS) {

              cooldownRef.current[s.symbol] = now;
              const resolved: U7Resolved = { ...sig, outcome: "PENDING" };
              newHistory.push(resolved);
              pendingRef.current.push({ sig: resolved, remaining: RESOLUTION_TICKS, hadWin: false });
            }
          }
        }

        rankArr.sort((a, b) => b.rank - a.rank);
        setRanking(rankArr);
        setSignals(out);
        if (newHistory.length) {
          setHistory((prev) => [...newHistory, ...prev].slice(0, HISTORY_MAX));
        }
      });
    };

    const resolvePending = (sym: string, newPrice: number) => {
      if (!pendingRef.current.length) return;
      const d = lastDigit(newPrice);
      let w = 0, l = 0;
      const remaining: typeof pendingRef.current = [];
      const finalised: U7Resolved[] = [];
      for (const p of pendingRef.current) {
        if (p.sig.symbol !== sym) { remaining.push(p); continue; }
        const target = p.sig.kind === "UNDER7" ? 7 : 5;
        const hit = d < target;
        if (hit) p.hadWin = true;
        p.remaining -= 1;
        if (p.remaining <= 0) {
          const outcome: "WIN" | "LOSS" = p.hadWin ? "WIN" : "LOSS";
          finalised.push({ ...p.sig, outcome, resolvedAt: Date.now() });
          if (outcome === "WIN") w++; else {
            l++;
            // Queue UNDER 5 recovery if the primary UNDER 7 lost.
            if (p.sig.kind === "UNDER7") {
              recoveryQueueRef.current[p.sig.symbol] = { ts: Date.now() };
            }
          }
        } else {
          remaining.push(p);
        }
      }
      pendingRef.current = remaining;
      if (finalised.length) {
        setHistory((prev) => {
          const map = new Map(prev.map((h) => [h.id, h]));
          for (const f of finalised) map.set(f.id, f);
          const next = [...map.values()].sort((a, b) => b.ts - a.ts).slice(0, HISTORY_MAX);
          // Dynamic threshold tuning based on the latest resolved outcomes
          const tuned = tuneThresholds(thresholdsRef.current, next);
          if (JSON.stringify(tuned) !== JSON.stringify(thresholdsRef.current)) {
            thresholdsRef.current = tuned;
            setThresholds(tuned);
          }
          return next;
        });
      }
      if (w || l) {
        setWinRate((p) => {
          const wins = p.wins + w, losses = p.losses + l;
          const total = wins + losses;
          if (total <= WINRATE_MAX) return { wins, losses };
          const ratio = WINRATE_MAX / total;
          return { wins: Math.round(wins * ratio), losses: Math.round(losses * ratio) };
        });
      }
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.error) return;
        if (msg.msg_type === "history" && msg.history && msg.echo_req?.ticks_history) {
          const sym = msg.echo_req.ticks_history as string;
          const { prices, times } = msg.history as { prices: number[]; times: number[] };
          ticksRef.current[sym] = prices.map((p, i) => ({ t: times[i] * 1000, price: p }));
          scheduleRecompute();
        } else if (msg.msg_type === "tick" && msg.tick) {
          const sym = msg.tick.symbol as string;
          const arr = ticksRef.current[sym] ?? [];
          const price = Number(msg.tick.quote);
          arr.push({ t: msg.tick.epoch * 1000, price });
          if (arr.length > MAX_TICKS) arr.splice(0, arr.length - MAX_TICKS);
          ticksRef.current[sym] = arr;
          resolvePending(sym, price);
          scheduleRecompute();
        }
      } catch {}
    };

    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus((s) => (s === "error" ? s : "idle"));

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ forget_all: "ticks" }));
        ws.close();
      } catch {}
    };
  }, [enabled]);

  return { signals, history, winRate, ranking, status, scannedCount: SCAN_SYMBOLS.length };
}
