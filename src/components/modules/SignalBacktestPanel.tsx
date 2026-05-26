import { useMemo } from "react";
import { Panel } from "../Panel";
import { BarChart3, Sliders, Trophy, TrendingDown, Timer } from "lucide-react";
import type { U7Resolved, U7Thresholds } from "@/hooks/useUnder7ExhaustionScan";

type Props = {
  history: U7Resolved[];
  thresholds: U7Thresholds;
};

function pct(n: number, d: number) { return d ? Math.round((n / d) * 100) : 0; }

export function SignalBacktestPanel({ history, thresholds }: Props) {
  const stats = useMemo(() => {
    const resolved = history.filter((h) => h.outcome === "WIN" || h.outcome === "LOSS");
    const pending = history.length - resolved.length;
    const wins = resolved.filter((h) => h.outcome === "WIN").length;
    const losses = resolved.length - wins;
    const winPct = pct(wins, resolved.length);

    // Expectancy assuming a 0.90 payout per win, -1.00 per loss (typical digit contract)
    const exp = resolved.length
      ? +(((wins * 0.90) - losses) / resolved.length).toFixed(3)
      : 0;

    // Per-kind breakdown
    const byKind: Record<string, { w: number; l: number }> = {};
    for (const r of resolved) {
      byKind[r.kind] = byKind[r.kind] ?? { w: 0, l: 0 };
      if (r.outcome === "WIN") byKind[r.kind].w++; else byKind[r.kind].l++;
    }

    // Per-symbol breakdown (top 5 by sample size)
    const bySym: Record<string, { name: string; w: number; l: number }> = {};
    for (const r of resolved) {
      bySym[r.symbol] = bySym[r.symbol] ?? { name: r.name, w: 0, l: 0 };
      if (r.outcome === "WIN") bySym[r.symbol].w++; else bySym[r.symbol].l++;
    }
    const symRows = Object.entries(bySym)
      .map(([sym, v]) => ({ sym, ...v, total: v.w + v.l, rate: pct(v.w, v.w + v.l) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Streaks
    let curStreak = 0, curKind: "W" | "L" | null = null;
    let bestW = 0, bestL = 0;
    const chrono = [...resolved].sort((a, b) => a.ts - b.ts);
    for (const r of chrono) {
      const k = r.outcome === "WIN" ? "W" : "L";
      if (k === curKind) curStreak++; else { curKind = k; curStreak = 1; }
      if (k === "W") bestW = Math.max(bestW, curStreak);
      else bestL = Math.max(bestL, curStreak);
    }

    return { resolved: resolved.length, pending, wins, losses, winPct, exp, byKind, symRows, bestW, bestL };
  }, [history]);

  return (
    <Panel title="Signal Backtest · Dynamic Tuning" subtitle="Rolling backtest of emitted signals · live-tuned thresholds" accent="cyan">
      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
        <Stat icon={<BarChart3 size={11} />} label="Resolved" value={String(stats.resolved)} hint={`${stats.pending} pending`} />
        <Stat icon={<Trophy size={11} />} label="Win rate" value={`${stats.winPct}%`} hint={`${stats.wins}W / ${stats.losses}L`} tone={stats.winPct >= 65 ? "bull" : stats.winPct >= 50 ? "neon" : "bear"} />
        <Stat icon={<TrendingDown size={11} />} label="Expectancy" value={stats.exp >= 0 ? `+${stats.exp}` : String(stats.exp)} hint="payout 0.9× per win" tone={stats.exp >= 0 ? "bull" : "bear"} />
        <Stat icon={<Timer size={11} />} label="Best W streak" value={String(stats.bestW)} hint={`worst ${stats.bestL}L`} />
        <Stat icon={<Sliders size={11} />} label="Conf gate" value={`≥${thresholds.emitConfMin}`} hint="auto-tuned" tone="neon" />
      </div>

      {/* Live thresholds */}
      <div className="rounded-md border border-border/40 bg-secondary/20 p-2 mb-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
          <Sliders size={11} className="text-[var(--neon)]" /> Dynamic thresholds (auto-tuned from outcomes)
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 text-[10px] tabular">
          <Th label="streak ≥" value={thresholds.minStreak} />
          <Th label="low ≥" value={`${(thresholds.lowDomMin * 100).toFixed(0)}%`} />
          <Th label="high <" value={`${(thresholds.highDomMax * 100).toFixed(0)}%`} />
          <Th label="mid <" value={`${(thresholds.midDomMax * 100).toFixed(0)}%`} />
          <Th label="manip <" value={thresholds.manipMax.toFixed(2)} />
          <Th label="stability >" value={thresholds.stabilityMin.toFixed(2)} />
          <Th label="emit conf ≥" value={thresholds.emitConfMin} />
        </div>
      </div>

      {/* Per-kind */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {(["UNDER7", "UNDER5_RECOVERY"] as const).map((k) => {
          const v = stats.byKind[k] ?? { w: 0, l: 0 };
          const total = v.w + v.l;
          const rate = pct(v.w, total);
          return (
            <div key={k} className="rounded-md border border-border/40 bg-secondary/20 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
              <div className="flex items-baseline justify-between mt-0.5">
                <div className="text-sm tabular font-semibold">{rate}%</div>
                <div className="text-[10px] text-muted-foreground tabular">{v.w}W · {v.l}L</div>
              </div>
              <div className="h-1 rounded bg-secondary/60 mt-1 overflow-hidden">
                <div className="h-full bg-[var(--bull)]" style={{ width: `${rate}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-symbol */}
      <div className="rounded-md border border-border/40 bg-secondary/20 p-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Top markets by sample</div>
        {stats.symRows.length === 0 ? (
          <div className="text-[10px] text-muted-foreground italic">No resolved signals yet — backtest will populate as signals close.</div>
        ) : (
          <div className="space-y-1">
            {stats.symRows.map((r) => (
              <div key={r.sym} className="flex items-center gap-2 text-[10px] tabular">
                <div className="w-20 truncate text-foreground/80">{r.name}</div>
                <div className="flex-1 h-1.5 rounded bg-secondary/60 overflow-hidden">
                  <div className={`h-full ${r.rate >= 60 ? "bg-[var(--bull)]" : r.rate >= 50 ? "bg-[var(--neon)]" : "bg-[var(--bear)]"}`} style={{ width: `${r.rate}%` }} />
                </div>
                <div className="w-10 text-right">{r.rate}%</div>
                <div className="w-12 text-right text-muted-foreground">{r.w}/{r.total}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Stat({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint?: string; tone?: "bull" | "bear" | "neon" }) {
  const color = tone === "bull" ? "text-[var(--bull)]" : tone === "bear" ? "text-[var(--bear)]" : tone === "neon" ? "text-[var(--neon)]" : "text-foreground";
  return (
    <div className="rounded-md border border-border/40 bg-secondary/30 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider opacity-70 flex items-center gap-1">{icon}{label}</div>
      <div className={`text-sm tabular font-semibold mt-0.5 ${color}`}>{value}</div>
      {hint && <div className="text-[9px] text-muted-foreground tabular">{hint}</div>}
    </div>
  );
}

function Th({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between rounded bg-secondary/40 px-1.5 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-[var(--neon)] font-semibold">{value}</span>
    </div>
  );
}
