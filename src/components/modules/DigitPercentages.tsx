import { useMemo } from "react";
import { Panel } from "../Panel";
import { lastDigit, type Tick } from "@/lib/analytics";

export function DigitPercentages({ ticks }: { ticks: Tick[] }) {
  const { freq, pct, total, hot, cold, lastD } = useMemo(() => {
    const slice = ticks.slice(-1000);
    const f = new Array(10).fill(0);
    slice.forEach((t) => f[lastDigit(t.price)]++);
    const total = slice.length || 1;
    const pct = f.map((c) => (c / total) * 100);
    let hot = 0, cold = 0;
    pct.forEach((p, i) => {
      if (p > pct[hot]) hot = i;
      if (p < pct[cold]) cold = i;
    });
    return { freq: f, pct, total: slice.length, hot, cold, lastD: slice.length ? lastDigit(slice[slice.length - 1].price) : -1 };
  }, [ticks]);

  const maxP = Math.max(...pct, 1);

  return (
    <Panel title="Digits 0–9 Live Distribution" subtitle={`Last ${total} ticks · Expected 10% each`} accent="cyan">
      <div className="grid grid-cols-10 gap-2">
        {pct.map((p, d) => {
          const isHot = d === hot;
          const isCold = d === cold;
          const isLast = d === lastD;
          const barH = Math.max(4, (p / maxP) * 100);
          const tone = isHot
            ? "var(--bull)"
            : isCold
              ? "var(--bear)"
              : "var(--neon)";
          return (
            <div key={d} className="flex flex-col items-center gap-1">
              <div className="tabular text-[11px] font-semibold" style={{ color: tone }}>
                {p.toFixed(1)}%
              </div>
              <div className="relative w-full h-24 rounded-md border border-border/40 bg-secondary/30 overflow-hidden flex items-end">
                <div
                  className="w-full transition-all duration-300"
                  style={{
                    height: `${barH}%`,
                    background: `linear-gradient(to top, ${tone}, color-mix(in oklab, ${tone} 40%, transparent))`,
                    boxShadow: isHot || isCold ? `0 0 12px ${tone}` : undefined,
                  }}
                />
              </div>
              <div
                className={`tabular text-sm font-bold w-7 h-7 flex items-center justify-center rounded ${
                  isLast ? "ring-1 ring-[var(--accent)]" : ""
                }`}
                style={{ color: isHot || isCold ? tone : "var(--foreground)" }}
              >
                {d}
              </div>
              <div className="tabular text-[9px] text-muted-foreground">{freq[d]}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>
          Hot <span className="text-[var(--bull)] font-semibold">{hot}</span> · Cold{" "}
          <span className="text-[var(--bear)] font-semibold">{cold}</span>
        </span>
        <span>
          Last digit <span className="text-[var(--accent)] font-semibold">{lastD >= 0 ? lastD : "—"}</span>
        </span>
      </div>
    </Panel>
  );
}
