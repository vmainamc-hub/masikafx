import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";
import type { Tick } from "@/lib/analytics";

export function PriceChart({ ticks }: { ticks: Tick[] }) {
  const data = useMemo(() => ticks.slice(-150).map((t, i) => ({ i, price: t.price })), [ticks]);
  const last = data[data.length - 1]?.price ?? 0;
  return (
    <div className="h-48 w-full relative scan-line">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--neon)" stopOpacity={0.6} />
              <stop offset="100%" stopColor="var(--neon)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis domain={["dataMin", "dataMax"]} hide />
          <Tooltip
            contentStyle={{ background: "oklch(0.2 0.03 252)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "var(--font-mono)" }}
            labelStyle={{ color: "var(--muted-foreground)" }}
            formatter={(v: number) => v.toFixed(4)}
          />
          <ReferenceLine y={last} stroke="var(--neon)" strokeDasharray="3 3" />
          <Area type="monotone" dataKey="price" stroke="var(--neon)" strokeWidth={1.6} fill="url(#g1)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
