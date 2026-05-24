import { useEffect, useRef, useState } from "react";
import { generateTick, type Tick } from "@/lib/analytics";

export function useTickStream(opts: { running: boolean; speedMs?: number; seed?: number; volatility?: number }) {
  const { running, speedMs = 350, seed = 1234.5678, volatility = 0.0009 } = opts;
  // Start empty so SSR and first client render match. Seed in effect (client-only).
  const [ticks, setTicks] = useState<Tick[]>([]);
  const ref = useRef(ticks);
  ref.current = ticks;

  // Client-only seed
  useEffect(() => {
    if (ticks.length > 0) return;
    const now = Date.now();
    const arr: Tick[] = [{ t: now - 200 * speedMs, price: seed }];
    for (let i = 1; i < 200; i++) {
      arr.push({ t: arr[i - 1].t + speedMs, price: generateTick(arr[i - 1].price, volatility) });
    }
    setTicks(arr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setTicks((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        const next: Tick = { t: Date.now(), price: generateTick(last.price, volatility) };
        const arr = [...prev, next];
        if (arr.length > 1000) arr.splice(0, arr.length - 1000);
        return arr;
      });
    }, speedMs);
    return () => window.clearInterval(id);
  }, [running, speedMs, volatility]);

  return { ticks, setTicks };
}
