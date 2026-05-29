// OVER 5 + UNDER 4 multi-market scanner.
// OVER 5 fires when pOver5 > 42% AND pUnder5 < 47.5% (digit 5 mass elevated).
// UNDER 4 fires when pUnder4 > 42% AND pOver4 < 47.5%.

import { useEffect, useRef, useState } from "react";
import { DERIV_SYMBOLS } from "./useDerivStream";
import { lastDigit, overUnderStats, marketIntel, type Tick } from "@/lib/analytics";

const APP_ID = 1089;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const WINDOW = 1000;
const MAX_TICKS = 1020;
const COOLDOWN_MS = 45_000;
const HISTORY_MAX = 20;

const SCAN_SYMBOLS = DERIV_SYMBOLS.filter((s) => s.group === "Standard" || s.group === "1s");

export type OUMatch = {
  id: string;
  type: "OVER5" | "UNDER4";
  symbol: string;
  name: string;
  ts: number;
  conf: number;
  manipulation: number;
  pOver: number;     // for OVER5 = pOver5 ; for UNDER4 = pOver4
  pUnder: number;    // for OVER5 = pUnder5 ; for UNDER4 = pUnder4
  entryPrice: number;
  lastDigit: number;
};

export function useOver5Under4Scan(enabled: boolean) {
  const [over5Signals, setOver5Signals] = useState<OUMatch[]>([]);
  const [under4Signals, setUnder4Signals] = useState<OUMatch[]>([]);
  const [over5History, setOver5History] = useState<OUMatch[]>([]);
  const [under4History, setUnder4History] = useState<OUMatch[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");

  const ticksRef = useRef<Record<string, Tick[]>>({});
  const o5Cooldown = useRef<Record<string, number>>({});
  const u4Cooldown = useRef<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      wsRef.current = null;
      ticksRef.current = {};
      setOver5Signals([]);
      setUnder4Signals([]);
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
        ws.send(JSON.stringify({
          ticks_history: s.symbol,
          adjust_start_time: 1,
          count: WINDOW,
          end: "latest",
          style: "ticks",
          subscribe: 1,
        }));
      }
    };

    let raf: number | null = null;
    const recompute = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const now = Date.now();
        const o5: OUMatch[] = [];
        const u4: OUMatch[] = [];
        const newO5: OUMatch[] = [];
        const newU4: OUMatch[] = [];

        for (const s of SCAN_SYMBOLS) {
          const all = ticksRef.current[s.symbol];
          if (!all || all.length < 200) continue;
          const ticks = all.slice(-WINDOW);
          const ou5 = overUnderStats(ticks, 5);
          const ou4 = overUnderStats(ticks, 4);
          const intel = marketIntel(ticks);
          const last = ticks[ticks.length - 1];
          const entry = last.price;
          const ld = lastDigit(entry);
          const manipOk = intel.manipulation < 0.20;

          // OVER 5: pOver > 0.42 AND pUnder < 0.475
          if (manipOk && ou5.pOver > 0.42 && ou5.pUnder < 0.475) {
            const edge = (ou5.pOver - 0.42) * 100;
            const calm = (0.475 - ou5.pUnder) * 100;
            const conf = Math.min(98, Math.max(70, Math.round(70 + edge * 2 + calm * 1.5)));
            const sig: OUMatch = {
              id: `o5-${s.symbol}-${now}`,
              type: "OVER5",
              symbol: s.symbol,
              name: s.name,
              ts: now,
              conf,
              manipulation: intel.manipulation,
              pOver: ou5.pOver,
              pUnder: ou5.pUnder,
              entryPrice: entry,
              lastDigit: ld,
            };
            o5.push(sig);
            const lastTs = o5Cooldown.current[s.symbol] ?? 0;
            if (now - lastTs > COOLDOWN_MS) {
              o5Cooldown.current[s.symbol] = now;
              newO5.push(sig);
            }
          }

          // UNDER 4: pUnder > 0.42 AND pOver < 0.475
          if (manipOk && ou4.pUnder > 0.42 && ou4.pOver < 0.475) {
            const edge = (ou4.pUnder - 0.42) * 100;
            const calm = (0.475 - ou4.pOver) * 100;
            const conf = Math.min(98, Math.max(70, Math.round(70 + edge * 2 + calm * 1.5)));
            const sig: OUMatch = {
              id: `u4-${s.symbol}-${now}`,
              type: "UNDER4",
              symbol: s.symbol,
              name: s.name,
              ts: now,
              conf,
              manipulation: intel.manipulation,
              pOver: ou4.pOver,
              pUnder: ou4.pUnder,
              entryPrice: entry,
              lastDigit: ld,
            };
            u4.push(sig);
            const lastTs = u4Cooldown.current[s.symbol] ?? 0;
            if (now - lastTs > COOLDOWN_MS) {
              u4Cooldown.current[s.symbol] = now;
              newU4.push(sig);
            }
          }
        }

        setOver5Signals(o5);
        setUnder4Signals(u4);
        if (newO5.length) setOver5History((p) => [...newO5, ...p].slice(0, HISTORY_MAX));
        if (newU4.length) setUnder4History((p) => [...newU4, ...p].slice(0, HISTORY_MAX));
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
          recompute();
        } else if (msg.msg_type === "tick" && msg.tick) {
          const sym = msg.tick.symbol as string;
          const arr = ticksRef.current[sym] ?? [];
          arr.push({ t: msg.tick.epoch * 1000, price: Number(msg.tick.quote) });
          if (arr.length > MAX_TICKS) arr.splice(0, arr.length - MAX_TICKS);
          ticksRef.current[sym] = arr;
          recompute();
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
    over5Signals,
    under4Signals,
    over5History,
    under4History,
    status,
    scannedCount: SCAN_SYMBOLS.length,
  };
}
