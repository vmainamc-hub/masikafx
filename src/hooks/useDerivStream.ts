import { useEffect, useRef, useState } from "react";
import type { Tick } from "@/lib/analytics";

export type DerivSymbol = {
  symbol: string;
  name: string;
  group: "Standard" | "1s" | "Crash/Boom" | "Jump";
};

// Only symbols actually offered on Deriv. Names match Deriv's UI labels.
export const DERIV_SYMBOLS: DerivSymbol[] = [
  { symbol: "R_10", name: "Volatility 10 Index", group: "Standard" },
  { symbol: "R_25", name: "Volatility 25 Index", group: "Standard" },
  { symbol: "R_50", name: "Volatility 50 Index", group: "Standard" },
  { symbol: "R_75", name: "Volatility 75 Index", group: "Standard" },
  { symbol: "R_100", name: "Volatility 100 Index", group: "Standard" },
  { symbol: "1HZ10V", name: "Volatility 10 (1s) Index", group: "1s" },
  { symbol: "1HZ25V", name: "Volatility 25 (1s) Index", group: "1s" },
  { symbol: "1HZ50V", name: "Volatility 50 (1s) Index", group: "1s" },
  { symbol: "1HZ75V", name: "Volatility 75 (1s) Index", group: "1s" },
  { symbol: "1HZ100V", name: "Volatility 100 (1s) Index", group: "1s" },
  { symbol: "1HZ150V", name: "Volatility 150 (1s) Index", group: "1s" },
  { symbol: "1HZ250V", name: "Volatility 250 (1s) Index", group: "1s" },
  { symbol: "JD10", name: "Jump 10 Index", group: "Jump" },
  { symbol: "JD25", name: "Jump 25 Index", group: "Jump" },
  { symbol: "JD50", name: "Jump 50 Index", group: "Jump" },
  { symbol: "JD75", name: "Jump 75 Index", group: "Jump" },
  { symbol: "JD100", name: "Jump 100 Index", group: "Jump" },
  { symbol: "BOOM300N", name: "Boom 300 Index", group: "Crash/Boom" },
  { symbol: "BOOM500", name: "Boom 500 Index", group: "Crash/Boom" },
  { symbol: "BOOM1000", name: "Boom 1000 Index", group: "Crash/Boom" },
  { symbol: "CRASH300N", name: "Crash 300 Index", group: "Crash/Boom" },
  { symbol: "CRASH500", name: "Crash 500 Index", group: "Crash/Boom" },
  { symbol: "CRASH1000", name: "Crash 1000 Index", group: "Crash/Boom" },
];

export type DerivStatus = "idle" | "connecting" | "live" | "error" | "closed";

// Deriv public app_id 1089 is documented for community/demo apps.
const APP_ID = 1089;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

export function useDerivStream(symbol: string | null, enabled: boolean) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [status, setStatus] = useState<DerivStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled || !symbol) {
      wsRef.current?.close();
      wsRef.current = null;
      setStatus("idle");
      return;
    }

    setTicks([]);
    setError(null);
    setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      setStatus("error");
      setError(String(e));
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      // Request 500-tick history + live stream
      ws.send(
        JSON.stringify({
          ticks_history: symbol,
          adjust_start_time: 1,
          count: 500,
          end: "latest",
          style: "ticks",
          subscribe: 1,
        }),
      );
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.error) {
          setStatus("error");
          setError(msg.error.message ?? "Deriv API error");
          return;
        }
        if (msg.msg_type === "history" && msg.history) {
          const { prices, times } = msg.history as { prices: number[]; times: number[] };
          const seed: Tick[] = prices.map((p, i) => ({ t: times[i] * 1000, price: p }));
          setTicks(seed);
          setStatus("live");
        } else if (msg.msg_type === "tick" && msg.tick) {
          const t: Tick = { t: msg.tick.epoch * 1000, price: Number(msg.tick.quote) };
          setTicks((prev) => {
            const arr = [...prev, t];
            if (arr.length > 1000) arr.splice(0, arr.length - 1000);
            return arr;
          });
        }
      } catch (e) {
        console.error("Deriv parse error", e);
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setError("WebSocket error — check network or symbol");
    };

    ws.onclose = () => {
      setStatus((s) => (s === "error" ? s : "closed"));
    };

    return () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ forget_all: "ticks" }));
        }
        ws.close();
      } catch {}
    };
  }, [symbol, enabled]);

  return { ticks, status, error };
}
