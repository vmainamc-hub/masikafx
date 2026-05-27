// Advanced OVER 2 + UNDER 7 multi-market scanner.
// 500-tick analysis window, slope/acceleration buildup detection,
// exhaustion analysis, Over/Under-5 structural bias, manipulation filter,
// confidence engine, cooldown + duplicate prevention, signal history,
// and a live win-rate tracker (resolved against subsequent ticks).

import { useEffect, useRef, useState } from "react";
import { DERIV_SYMBOLS } from "./useDerivStream";
import { lastDigit, overUnderStats, marketIntel, type Tick } from "@/lib/analytics";

const APP_ID = 1089;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const WINDOW = 1000; // align with Digits 0–9 Live Distribution panel
const MAX_TICKS = 1020;
const SNAPSHOT_INTERVAL_MS = 1500; // sample digit % for slope analysis
const SNAPSHOT_KEEP = 12;          // ~18s of history per market
const COOLDOWN_MS = 45_000;
const RESOLUTION_TICKS = 5;        // win/loss resolved against next N ticks
const HISTORY_MAX = 25;
const WINRATE_MAX = 100;

const SCAN_SYMBOLS = DERIV_SYMBOLS.filter((s) => s.group === "Standard" || s.group === "1s");

export type ScanType = "OVER2" | "UNDER7";

export type AdvancedSignal = {
  id: string;
  type: ScanType;
  symbol: string;
  name: string;
  ts: number;
  conf: number;
  manipulation: number;
  pOver5: number;
  pUnder5: number;
  greenDigits: number[];   // dominant green-bar digits
  redDigits: number[];     // weak red-bar digits
  buildup: { digit: number; pct: number; slope: number }[]; // hidden buildup digits
  exhaustion: { digit: number; pct: number; flat: number }[]; // exhausting digits
  exhaustionStatus: "CONFIRMED" | "FORMING" | "NONE";
  momentum: "BULLISH" | "BEARISH" | "NEUTRAL";
  entryPrice: number;
  lastDigit: number;
};

type ResolvedSignal = AdvancedSignal & {
  outcome: "WIN" | "LOSS" | "PENDING";
  resolvedAt?: number;
};

type Snapshot = { t: number; pct: number[]; pOver5: number; pUnder5: number; pUnder4: number };

function freqPct(ticks: Tick[]): number[] {
  const f = new Array(10).fill(0);
  for (const tk of ticks) f[lastDigit(tk.price)]++;
  const total = Math.max(1, ticks.length);
  return f.map((v) => v / total);
}

// Linear regression slope (% per snapshot) for a digit across snapshots.
function slope(snapshots: Snapshot[], digit: number): number {
  if (snapshots.length < 3) return 0;
  const n = snapshots.length;
  const xs = snapshots.map((_, i) => i);
  const ys = snapshots.map((s) => s.pct[digit] ?? 0);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function ouSlope(snapshots: Snapshot[], key: "pOver5" | "pUnder5" | "pUnder4"): number {
  if (snapshots.length < 3) return 0;
  const n = snapshots.length;
  const xs = snapshots.map((_, i) => i);
  const ys = snapshots.map((s) => s[key]);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// Flatness (lower = more exhausted). Compares slope vs early growth.
function flatness(snapshots: Snapshot[], digit: number): number {
  if (snapshots.length < 4) return 0;
  const recent = snapshots.slice(-3).map((s) => s.pct[digit]);
  const early = snapshots.slice(0, 3).map((s) => s.pct[digit]);
  const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const earlyMean = early.reduce((a, b) => a + b, 0) / early.length;
  // 1 when fully flat/declining, 0 when still expanding fast
  return Math.max(0, Math.min(1, 1 - Math.max(0, recentMean - earlyMean) * 25));
}

export function useAdvancedOverUnderScan(enabled: boolean) {
  const [over2Signals, setOver2Signals] = useState<AdvancedSignal[]>([]);
  const [under7Signals, setUnder7Signals] = useState<AdvancedSignal[]>([]);
  const [over2History, setOver2History] = useState<ResolvedSignal[]>([]);
  const [under7History, setUnder7History] = useState<ResolvedSignal[]>([]);
  const [over2WinRate, setOver2WinRate] = useState<{ wins: number; losses: number }>({ wins: 0, losses: 0 });
  const [under7WinRate, setUnder7WinRate] = useState<{ wins: number; losses: number }>({ wins: 0, losses: 0 });
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");

  const ticksRef = useRef<Record<string, Tick[]>>({});
  const snapshotsRef = useRef<Record<string, Snapshot[]>>({});
  const lastSnapshotAt = useRef<Record<string, number>>({});
  const o2CooldownRef = useRef<Record<string, number>>({});
  const u7CooldownRef = useRef<Record<string, number>>({});
  const pendingRef = useRef<{ sig: ResolvedSignal; remaining: number; hadWin: boolean }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      wsRef.current = null;
      ticksRef.current = {};
      snapshotsRef.current = {};
      setOver2Signals([]);
      setUnder7Signals([]);
      setStatus("idle");
      return;
    }

    setStatus("connecting");
    ticksRef.current = {};
    snapshotsRef.current = {};
    lastSnapshotAt.current = {};
    pendingRef.current = [];

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      setStatus("error");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("live");
      for (const s of SCAN_SYMBOLS) {
        ws.send(
          JSON.stringify({
            ticks_history: s.symbol,
            adjust_start_time: 1,
            count: WINDOW,
            end: "latest",
            style: "ticks",
            subscribe: 1,
          }),
        );
      }
    };

    let raf: number | null = null;
    const scheduleRecompute = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const now = Date.now();
        const o2: AdvancedSignal[] = [];
        const u7: AdvancedSignal[] = [];
        const newO2History: ResolvedSignal[] = [];
        const newU7History: ResolvedSignal[] = [];

        for (const s of SCAN_SYMBOLS) {
          const allTicks = ticksRef.current[s.symbol];
          if (!allTicks || allTicks.length < 200) continue;
          const ticks = allTicks.slice(-WINDOW);

          const pct = freqPct(ticks);
          const ou5 = overUnderStats(ticks, 5);
          const intel = marketIntel(ticks);

          // ---- maintain snapshot history per symbol ----
          if (now - (lastSnapshotAt.current[s.symbol] ?? 0) >= SNAPSHOT_INTERVAL_MS) {
            const arr = snapshotsRef.current[s.symbol] ?? [];
            const pUnder4 = pct[0] + pct[1] + pct[2] + pct[3];
            arr.push({ t: now, pct, pOver5: ou5.pOver, pUnder5: ou5.pUnder, pUnder4 });
            while (arr.length > SNAPSHOT_KEEP) arr.shift();
            snapshotsRef.current[s.symbol] = arr;
            lastSnapshotAt.current[s.symbol] = now;
          }
          const snaps = snapshotsRef.current[s.symbol] ?? [];

          const lastTick = ticks[ticks.length - 1];
          const entryPrice = lastTick.price;
          const lastD = lastDigit(entryPrice);

          // Identify hot (highest %) and cold (lowest %) digits.
          let hotD = 0, coldD = 0;
          for (let i = 1; i < 10; i++) {
            if (pct[i] > pct[hotD]) hotD = i;
            if (pct[i] < pct[coldD]) coldD = i;
          }

          // ============ OVER 2 STRATEGY ============
          // Setup: low digits (0,1,2) dominated but exhausting; high digits
          // (7,8,9) suppressed but quietly rising → expect shift > 2.
          {
            const sl0 = slope(snaps, 0);
            const sl1 = slope(snaps, 1);
            const sl2 = slope(snaps, 2);
            const sl7 = slope(snaps, 7);
            const sl8 = slope(snaps, 8);
            const sl9 = slope(snaps, 9);
            const flat0 = flatness(snaps, 0);
            const flat1 = flatness(snaps, 1);
            const flat2 = flatness(snaps, 2);

            // Hot/cold placement gate (user-specified).
            const hotOk = hotD === 0 || hotD === 2 || hotD === 4;
            const coldOk = coldD === 5 || coldD === 7 || coldD === 9;

            // Digits 0,1,2 elevated above expected 10%.
            const lowsElevated = pct[0] > 0.11 && pct[1] > 0.11 && pct[2] > 0.11;
            // ...and exhausting (flat / not climbing).
            const lowsExhausting =
              (flat0 > 0.55 || sl0 <= 0) &&
              (flat1 > 0.55 || sl1 <= 0) &&
              (flat2 > 0.55 || sl2 <= 0);
            const exhaustConfirmed = lowsElevated && flat0 > 0.55 && flat1 > 0.55 && flat2 > 0.55;

            // Digits 7,8,9 suppressed AND rising (hidden buildup).
            const highsSuppressed = pct[7] < 0.10 && pct[8] < 0.10 && pct[9] < 0.10;
            const highsRising = sl7 > 0 && sl8 > 0 && sl9 > 0;

            const manipOk = intel.manipulation < 0.30;
            const allOk = hotOk && coldOk && lowsElevated && lowsExhausting &&
                          highsSuppressed && highsRising && manipOk && snaps.length >= 4;

            if (allOk) {
              const base = 65;
              const lowEdge = Math.min(15, ((pct[0] + pct[1] + pct[2]) - 0.33) * 100);
              const highBuild = Math.min(15, Math.max(0, (sl7 + sl8 + sl9)) * 400);
              const calm = Math.max(0, (0.30 - intel.manipulation)) * 30;
              const exh = exhaustConfirmed ? 8 : 4;
              const finalConf = Math.min(98, Math.max(65, Math.round(base + lowEdge + highBuild + calm + exh)));

              const sig: AdvancedSignal = {
                id: `o2-${s.symbol}-${now}`,
                type: "OVER2",
                symbol: s.symbol,
                name: s.name,
                ts: now,
                conf: finalConf,
                manipulation: intel.manipulation,
                pOver5: ou5.pOver,
                pUnder5: ou5.pUnder,
                greenDigits: [0, 2, 4],
                redDigits: [5, 7, 9],
                buildup: [
                  { digit: 7, pct: pct[7], slope: sl7 },
                  { digit: 8, pct: pct[8], slope: sl8 },
                  { digit: 9, pct: pct[9], slope: sl9 },
                ],
                exhaustion: [
                  { digit: 0, pct: pct[0], flat: flat0 },
                  { digit: 1, pct: pct[1], flat: flat1 },
                  { digit: 2, pct: pct[2], flat: flat2 },
                ],
                exhaustionStatus: exhaustConfirmed ? "CONFIRMED" : "FORMING",
                momentum: "BULLISH",
                entryPrice,
                lastDigit: lastD,
              };
              o2.push(sig);

              const lastTs = o2CooldownRef.current[s.symbol] ?? 0;
              if (finalConf >= 70 && now - lastTs > COOLDOWN_MS) {
                o2CooldownRef.current[s.symbol] = now;
                const resolved: ResolvedSignal = { ...sig, outcome: "PENDING" };
                newO2History.push(resolved);
                pendingRef.current.push({ sig: resolved, remaining: RESOLUTION_TICKS, hadWin: false });
              }
            }
          }

          // ============ UNDER 7 STRATEGY (mirror) ============
          // Setup: high digits (7,8,9) dominated but exhausting; low digits
          // (0,1,2) suppressed but quietly rising → expect shift < 7.
          {
            const sl0 = slope(snaps, 0);
            const sl1 = slope(snaps, 1);
            const sl2 = slope(snaps, 2);
            const sl7 = slope(snaps, 7);
            const sl8 = slope(snaps, 8);
            const sl9 = slope(snaps, 9);
            const flat7 = flatness(snaps, 7);
            const flat8 = flatness(snaps, 8);
            const flat9 = flatness(snaps, 9);

            const hotOk = hotD === 5 || hotD === 7 || hotD === 9;
            const coldOk = coldD === 0 || coldD === 2 || coldD === 4;

            const highsElevated = pct[7] > 0.11 && pct[8] > 0.11 && pct[9] > 0.11;
            const highsExhausting =
              (flat7 > 0.55 || sl7 <= 0) &&
              (flat8 > 0.55 || sl8 <= 0) &&
              (flat9 > 0.55 || sl9 <= 0);
            const exhaustConfirmed = highsElevated && flat7 > 0.55 && flat8 > 0.55 && flat9 > 0.55;

            const lowsSuppressed = pct[0] < 0.10 && pct[1] < 0.10 && pct[2] < 0.10;
            const lowsRising = sl0 > 0 && sl1 > 0 && sl2 > 0;

            const manipOk = intel.manipulation < 0.30;
            const allOk = hotOk && coldOk && highsElevated && highsExhausting &&
                          lowsSuppressed && lowsRising && manipOk && snaps.length >= 4;

            if (allOk) {
              const base = 65;
              const highEdge = Math.min(15, ((pct[7] + pct[8] + pct[9]) - 0.33) * 100);
              const lowBuild = Math.min(15, Math.max(0, (sl0 + sl1 + sl2)) * 400);
              const calm = Math.max(0, (0.30 - intel.manipulation)) * 30;
              const exh = exhaustConfirmed ? 8 : 4;
              const finalConf = Math.min(98, Math.max(65, Math.round(base + highEdge + lowBuild + calm + exh)));

              const sig: AdvancedSignal = {
                id: `u7-${s.symbol}-${now}`,
                type: "UNDER7",
                symbol: s.symbol,
                name: s.name,
                ts: now,
                conf: finalConf,
                manipulation: intel.manipulation,
                pOver5: ou5.pOver,
                pUnder5: ou5.pUnder,
                greenDigits: [5, 7, 9],
                redDigits: [0, 2, 4],
                buildup: [
                  { digit: 0, pct: pct[0], slope: sl0 },
                  { digit: 1, pct: pct[1], slope: sl1 },
                  { digit: 2, pct: pct[2], slope: sl2 },
                ],
                exhaustion: [
                  { digit: 7, pct: pct[7], flat: flat7 },
                  { digit: 8, pct: pct[8], flat: flat8 },
                  { digit: 9, pct: pct[9], flat: flat9 },
                ],
                exhaustionStatus: exhaustConfirmed ? "CONFIRMED" : "FORMING",
                momentum: "BEARISH",
                entryPrice,
                lastDigit: lastD,
              };
              u7.push(sig);

              const lastTs = u7CooldownRef.current[s.symbol] ?? 0;
              if (finalConf >= 70 && now - lastTs > COOLDOWN_MS) {
                u7CooldownRef.current[s.symbol] = now;
                const resolved: ResolvedSignal = { ...sig, outcome: "PENDING" };
                newU7History.push(resolved);
                pendingRef.current.push({ sig: resolved, remaining: RESOLUTION_TICKS, hadWin: false });
              }
            }
          }

        }



        setOver2Signals(o2);
        setUnder7Signals(u7);
        if (newO2History.length) {
          setOver2History((prev) => [...newO2History, ...prev].slice(0, HISTORY_MAX));
        }
        if (newU7History.length) {
          setUnder7History((prev) => [...newU7History, ...prev].slice(0, HISTORY_MAX));
        }
      });
    };

    const resolvePending = (sym: string, newPrice: number) => {
      if (!pendingRef.current.length) return;
      const d = lastDigit(newPrice);
      let o2W = 0, o2L = 0, u7W = 0, u7L = 0;
      const remaining: typeof pendingRef.current = [];
      const finalisedO2: ResolvedSignal[] = [];
      const finalisedU7: ResolvedSignal[] = [];
      for (const p of pendingRef.current) {
        if (p.sig.symbol !== sym) {
          remaining.push(p);
          continue;
        }
        // Win condition: OVER 2 => digit > 2 ; UNDER 7 => digit < 7
        const hit = p.sig.type === "OVER2" ? d > 2 : d < 7;
        if (hit) p.hadWin = true;
        p.remaining -= 1;
        if (p.remaining <= 0) {
          const outcome: "WIN" | "LOSS" = p.hadWin ? "WIN" : "LOSS";
          const finalised: ResolvedSignal = { ...p.sig, outcome, resolvedAt: Date.now() };
          if (p.sig.type === "OVER2") {
            finalisedO2.push(finalised);
            if (outcome === "WIN") o2W++; else o2L++;
          } else {
            finalisedU7.push(finalised);
            if (outcome === "WIN") u7W++; else u7L++;
          }
        } else {
          remaining.push(p);
        }
      }
      pendingRef.current = remaining;
      if (finalisedO2.length) {
        setOver2History((prev) => {
          const map = new Map(prev.map((h) => [h.id, h]));
          for (const f of finalisedO2) map.set(f.id, f);
          return [...map.values()].sort((a, b) => b.ts - a.ts).slice(0, HISTORY_MAX);
        });
      }
      if (finalisedU7.length) {
        setUnder7History((prev) => {
          const map = new Map(prev.map((h) => [h.id, h]));
          for (const f of finalisedU7) map.set(f.id, f);
          return [...map.values()].sort((a, b) => b.ts - a.ts).slice(0, HISTORY_MAX);
        });
      }
      if (o2W || o2L) {
        setOver2WinRate((p) => {
          const wins = p.wins + o2W, losses = p.losses + o2L;
          const total = wins + losses;
          if (total <= WINRATE_MAX) return { wins, losses };
          const ratio = WINRATE_MAX / total;
          return { wins: Math.round(wins * ratio), losses: Math.round(losses * ratio) };
        });
      }
      if (u7W || u7L) {
        setUnder7WinRate((p) => {
          const wins = p.wins + u7W, losses = p.losses + u7L;
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

  return {
    over2Signals,
    under7Signals,
    over2History,
    under7History,
    over2WinRate,
    under7WinRate,
    status,
    scannedCount: SCAN_SYMBOLS.length,
  };
}
