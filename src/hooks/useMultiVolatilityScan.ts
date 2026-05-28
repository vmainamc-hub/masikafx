import { useEffect, useRef, useState } from "react";
import { DERIV_SYMBOLS } from "./useDerivStream";
import { overUnderStats, marketIntel, evenOddStats, riseFallStats, lastDigit, type Tick } from "@/lib/analytics";

const APP_ID = 1089;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const MAX_TICKS = 1000; // align with Digits 0–9 Live Distribution panel

// Scan all standard + 1s volatility markets
const SCAN_SYMBOLS = DERIV_SYMBOLS.filter((s) => s.group === "Standard" || s.group === "1s");

export type Under7Match = {
  symbol: string;
  name: string;
  pUnder: number;
  manipulation: number;
  p0: number;
  p1: number;
  p9: number;
  entryPrice: number;
  lastDigit: number;
  stakePct: number;
  conf: number;
};

export type EvenOddMatch = {
  symbol: string;
  name: string;
  side: "EVEN" | "ODD";
  mode: "TREND" | "REVERSAL";
  dominance: number;
  continuation: number;
  manipulation: number;
  altRate: number;
  streak: number;
  ev50: number;
  ev200: number;
  shift: number;
  entryPrice: number;
  lastDigit: number;
  conf: number;
};

export type Over2Match = {
  symbol: string;
  name: string;
  pOver: number;
  manipulation: number;
  p0: number;
  p7: number;
  p8: number;
  p9: number;
  freq: number[];
  entryPrice: number;
  lastDigit: number;
  conf: number;
  ts: number;
};

// Combined signal for a dbot running BOTH Over 2 AND Under 7 contracts
export type BotMatch = {
  symbol: string;
  name: string;
  pOver2: number;
  pUnder7: number;
  manipulation: number;
  p0: number;
  p1: number;
  p7: number;
  p8: number;
  p9: number;
  entryPrice: number;
  lastDigit: number;
  conf: number;
  ts: number;
};

export function useMultiVolatilityScan(enabled: boolean) {
  const [matches, setMatches] = useState<Under7Match[]>([]);
  const [evenOddMatches, setEvenOddMatches] = useState<EvenOddMatch[]>([]);
  const [over2Matches, setOver2Matches] = useState<Over2Match[]>([]);
  const [over2History, setOver2History] = useState<Over2Match[]>([]);
  const [botMatches, setBotMatches] = useState<BotMatch[]>([]);
  const [botHistory, setBotHistory] = useState<BotMatch[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const ticksRef = useRef<Record<string, Tick[]>>({});
  const snapshotsRef = useRef<Record<string, { t: number; pct: number[] }[]>>({});
  const lastSnapAt = useRef<Record<string, number>>({});
  const cooldownRef = useRef<Record<string, number>>({});
  const botCooldownRef = useRef<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      wsRef.current = null;
      ticksRef.current = {};
      setMatches([]);
      setEvenOddMatches([]);
      setOver2Matches([]);
      setBotMatches([]);
      setStatus("idle");
      return;
    }

    setStatus("connecting");
    ticksRef.current = {};

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
            count: MAX_TICKS,
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
        const out: Under7Match[] = [];
        const eoOut: EvenOddMatch[] = [];
        const o2Out: Over2Match[] = [];
        const newHistory: Over2Match[] = [];
        const botOut: BotMatch[] = [];
        const newBotHistory: BotMatch[] = [];
        const COOLDOWN_MS = 60_000;
        const now = Date.now();
        for (const s of SCAN_SYMBOLS) {
          const ticks = ticksRef.current[s.symbol];
          if (!ticks || ticks.length < 200) continue;
          const ou7 = overUnderStats(ticks, 7);
          const m = marketIntel(ticks);

          // --- maintain digit-distribution snapshots for slope analysis ---
          const total0 = Math.max(1, ticks.length);
          const pctNow = new Array(10).fill(0);
          for (const tk of ticks) pctNow[lastDigit(tk.price)]++;
          for (let i = 0; i < 10; i++) pctNow[i] = pctNow[i] / total0;
          if (now - (lastSnapAt.current[s.symbol] ?? 0) >= 1500) {
            const arr = snapshotsRef.current[s.symbol] ?? [];
            arr.push({ t: now, pct: pctNow });
            while (arr.length > 12) arr.shift();
            snapshotsRef.current[s.symbol] = arr;
            lastSnapAt.current[s.symbol] = now;
          }
          const snaps = snapshotsRef.current[s.symbol] ?? [];
          const slopeOf = (d: number) => {
            if (snaps.length < 3) return 0;
            const n = snaps.length;
            const mx = (n - 1) / 2;
            const ys = snaps.map((sn) => sn.pct[d]);
            const my = ys.reduce((a, b) => a + b, 0) / n;
            let num = 0, den = 0;
            for (let i = 0; i < n; i++) {
              num += (i - mx) * (ys[i] - my);
              den += (i - mx) ** 2;
            }
            return den === 0 ? 0 : num / den;
          };

          // ============ UNDER 7 ============
          // Hot digit ∈ {5,7,9}, Cold digit ∈ {0,2,4}.
          // p7/p8/p9 elevated and decreasing (exhausting);
          // p0/p1/p2 suppressed and increasing (building).
          {
            let hotD = 0, coldD = 0;
            for (let i = 1; i < 10; i++) {
              if (pctNow[i] > pctNow[hotD]) hotD = i;
              if (pctNow[i] < pctNow[coldD]) coldD = i;
            }
            const hotOk = hotD === 5 || hotD === 7 || hotD === 9;
            const coldOk = coldD === 0 || coldD === 2 || coldD === 4;
            const sl0 = slopeOf(0), sl1 = slopeOf(1), sl2 = slopeOf(2);
            const sl7 = slopeOf(7), sl8 = slopeOf(8), sl9 = slopeOf(9);
            const highsHigh = pctNow[7] > 0.11 && pctNow[8] > 0.11 && pctNow[9] > 0.11;
            const highsDecreasing = sl7 <= 0 && sl8 <= 0 && sl9 <= 0;
            const lowsLow = pctNow[0] < 0.10 && pctNow[1] < 0.10 && pctNow[2] < 0.10;
            const lowsRising = sl0 > 0 && sl1 > 0 && sl2 > 0;
            const manipOk = m.manipulation < 0.20;
            if (
              hotOk && coldOk && highsHigh && highsDecreasing &&
              lowsLow && lowsRising && manipOk && snaps.length >= 4 &&
              ou7.pUnder > 0.70
            ) {
              const lastTick = ticks[ticks.length - 1];
              const entryPrice = lastTick?.price ?? 0;
              const stakePct = Math.min(5, Math.max(1, Math.round((ou7.pUnder - 0.70) * 100 / 2 + 1)));
              out.push({
                symbol: s.symbol,
                name: s.name,
                pUnder: ou7.pUnder,
                manipulation: m.manipulation,
                p0: pctNow[0],
                p1: pctNow[1],
                p9: pctNow[9],
                entryPrice,
                lastDigit: lastDigit(entryPrice),
                stakePct,
                conf: Math.min(98, Math.max(70, Math.round(ou7.pUnder * 100 + 18))),
              });
            }
          }

          // ---- EVEN/ODD scan: high-quality signals only ----
          const eo = evenOddStats(ticks);
          const rf = riseFallStats(ticks);
          if (ticks.length >= 150 && m.manipulation < 0.12) {
            const digAll = ticks.map((t) => Math.abs(Math.round(t.price * 100)) % 10);
            const d200 = digAll.slice(-200);
            const d100 = digAll.slice(-100);
            const d50 = digAll.slice(-50);
            const d20 = digAll.slice(-20);
            const ev200 = d200.filter((d) => d % 2 === 0).length / d200.length;
            const ev100 = d100.filter((d) => d % 2 === 0).length / d100.length;
            const ev50 = d50.filter((d) => d % 2 === 0).length / d50.length;
            const ev20 = d20.filter((d) => d % 2 === 0).length / d20.length;
            const shift = ev50 - ev200;
            let flips = 0;
            for (let i = 1; i < d50.length; i++) if ((d50[i] % 2) !== (d50[i - 1] % 2)) flips++;
            const altRate = flips / (d50.length - 1);
            let flips20 = 0;
            for (let i = 1; i < d20.length; i++) if ((d20[i] % 2) !== (d20[i - 1] % 2)) flips20++;
            const altRate20 = flips20 / (d20.length - 1);
            let curStreak = 1;
            const lastPar = d50[d50.length - 1] % 2;
            for (let i = d50.length - 2; i >= 0; i--) {
              if ((d50[i] % 2) === lastPar) curStreak++; else break;
            }
            const dominance = Math.max(ev50, 1 - ev50);

            let side: "EVEN" | "ODD" | null = null;
            let mode: "TREND" | "REVERSAL" = "TREND";
            let confBase = 0;

            // REVERSAL: extreme streak (>=8) with neutral baseline AND recent window confirms imbalance
            const extremeEven20 = ev20 >= 0.75;
            const extremeOdd20 = ev20 <= 0.25;
            if (
              curStreak >= 8 &&
              Math.abs(ev200 - 0.5) < 0.04 &&
              altRate >= 0.35 && altRate <= 0.55 &&
              (lastPar === 0 ? extremeEven20 : extremeOdd20)
            ) {
              side = lastPar === 0 ? "ODD" : "EVEN";
              mode = "REVERSAL";
              confBase = 62 + Math.min(20, (curStreak - 8) * 5) + Math.round((0.5 - Math.abs(ev200 - 0.5)) * 40);
            } else {
              // TREND: strong sustained dominance across 50/100 + agreeing shift + baseline + momentum
              const recentEven = ev50 >= 0.62 && ev100 >= 0.58 && ev20 >= 0.60;
              const recentOdd = (1 - ev50) >= 0.62 && (1 - ev100) >= 0.58 && (1 - ev20) >= 0.60;
              if (recentEven && shift > 0.05 && ev200 >= 0.50 && eo.continuation >= 0.58) {
                side = "EVEN";
                mode = "TREND";
                confBase = Math.round(ev50 * 50 + shift * 140 + eo.continuation * 30);
              } else if (recentOdd && shift < -0.05 && ev200 <= 0.50 && eo.continuation >= 0.58) {
                side = "ODD";
                mode = "TREND";
                confBase = Math.round((1 - ev50) * 50 + (-shift) * 140 + eo.continuation * 30);
              }
            }

            if (side && altRate >= 0.32 && altRate <= 0.58 && altRate20 <= 0.65) {
              const stableMomentum = !rf.exhaustion && rf.volatility < 1.2;
              const conf = Math.min(96, confBase + (stableMomentum ? 8 : 0));
              if (conf >= 75 && stableMomentum) {
                const lastTick = ticks[ticks.length - 1];
                const entryPrice = lastTick?.price ?? 0;
                eoOut.push({
                  symbol: s.symbol,
                  name: s.name,
                  side,
                  mode,
                  dominance,
                  continuation: eo.continuation,
                  manipulation: m.manipulation,
                  altRate,
                  streak: curStreak,
                  ev50,
                  ev200,
                  shift,
                  entryPrice,
                  lastDigit: lastDigit(entryPrice),
                  conf,
                });
              }
            }
          }

          // ---- OVER 2 strategy scan ----
          {
            const ou2 = overUnderStats(ticks, 2);
            const total = Math.max(1, ticks.length);
            const p0 = ou2.freq[0] / total;
            const p7 = ou2.freq[7] / total;
            const p8 = ou2.freq[8] / total;
            const p9 = ou2.freq[9] / total;
            if (
              p7 < 0.10 && p8 < 0.10 && p9 < 0.10 &&
              p0 > 0.115 && m.manipulation < 0.20
            ) {
              const lastTick = ticks[ticks.length - 1];
              const entryPrice = lastTick?.price ?? 0;
              // Confidence: rises with d0 dominance, low d7-9, low manipulation
              const tailWeak = Math.max(0, 0.30 - (p7 + p8 + p9));   // 0..0.30
              const d0Edge = Math.max(0, p0 - 0.115);                // 0..~0.20
              const manipCalm = Math.max(0, 0.20 - m.manipulation);  // 0..0.20
              const base = 60
                + d0Edge * 140
                + tailWeak * 80
                + manipCalm * 60;
              const conf = Math.min(98, Math.round(base));
              const lastTs = cooldownRef.current[s.symbol] ?? 0;
              const fresh = now - lastTs > COOLDOWN_MS;
              const match: Over2Match = {
                symbol: s.symbol,
                name: s.name,
                pOver: ou2.pOver,
                manipulation: m.manipulation,
                p0, p7, p8, p9,
                freq: ou2.freq,
                entryPrice,
                lastDigit: lastDigit(entryPrice),
                conf,
                ts: now,
              };
              o2Out.push(match);
              if (fresh && conf >= 70) {
                cooldownRef.current[s.symbol] = now;
                newHistory.push(match);
              }
            }
          }

          // ---- DBOT: Over 2 + Under 7 combined scanner ----
          // Fires only when the same market satisfies BOTH contract edges simultaneously.
          {
            const ou2b = overUnderStats(ticks, 2);
            const ou7b = overUnderStats(ticks, 7);
            const total = Math.max(1, ticks.length);
            const p0 = ou2b.freq[0] / total;
            const p1 = ou2b.freq[1] / total;
            const p7 = ou2b.freq[7] / total;
            const p8 = ou2b.freq[8] / total;
            const p9 = ou2b.freq[9] / total;
            const over2Ok = p0 > 0.115 && p7 < 0.10 && p8 < 0.10 && p9 < 0.10 && ou2b.pOver >= 0.70;
            const under7Ok = ou7b.pUnder > 0.70 && p0 < 0.095 && p1 < 0.095 && p9 >= 0.105;
            // Both share the manipulation < 0.10 floor (tighter of the two)
            if (over2Ok && under7Ok && m.manipulation < 0.20 && ticks.length >= 120) {
              const lastTick = ticks[ticks.length - 1];
              const entryPrice = lastTick?.price ?? 0;
              const overEdge = Math.max(0, ou2b.pOver - 0.70);   // 0..0.30
              const underEdge = Math.max(0, ou7b.pUnder - 0.70); // 0..0.30
              const manipCalm = Math.max(0, 0.10 - m.manipulation); // 0..0.10
              const conf = Math.min(98, Math.round(70 + overEdge * 60 + underEdge * 60 + manipCalm * 100));
              const lastTs = botCooldownRef.current[s.symbol] ?? 0;
              const fresh = now - lastTs > COOLDOWN_MS;
              const bm: BotMatch = {
                symbol: s.symbol,
                name: s.name,
                pOver2: ou2b.pOver,
                pUnder7: ou7b.pUnder,
                manipulation: m.manipulation,
                p0, p1, p7, p8, p9,
                entryPrice,
                lastDigit: lastDigit(entryPrice),
                conf,
                ts: now,
              };
              botOut.push(bm);
              if (fresh && conf >= 78) {
                botCooldownRef.current[s.symbol] = now;
                newBotHistory.push(bm);
              }
            }
          }
        }
        setMatches(out);
        setEvenOddMatches(eoOut);
        setOver2Matches(o2Out);
        setBotMatches(botOut);
        if (newHistory.length) {
          setOver2History((prev) => [...newHistory, ...prev].slice(0, 20));
        }
        if (newBotHistory.length) {
          setBotHistory((prev) => [...newBotHistory, ...prev].slice(0, 20));
        }
      });
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
          arr.push({ t: msg.tick.epoch * 1000, price: Number(msg.tick.quote) });
          if (arr.length > MAX_TICKS) arr.splice(0, arr.length - MAX_TICKS);
          ticksRef.current[sym] = arr;
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

  return { matches, evenOddMatches, over2Matches, over2History, botMatches, botHistory, status, scannedCount: SCAN_SYMBOLS.length };
}
