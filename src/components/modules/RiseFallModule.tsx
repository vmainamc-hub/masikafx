import { riseFallStats, type Tick } from "@/lib/analytics";
import { Panel, Stat, Bar } from "../Panel";
import { TrendingUp, TrendingDown, Zap, AlertTriangle } from "lucide-react";

export function RiseFallModule({ ticks }: { ticks: Tick[] }) {
  const s = riseFallStats(ticks);
  return (
    <Panel title="Rise / Fall Engine" subtitle="RSI · MACD · Volatility · Trend" accent="magenta">
      <div className="grid grid-cols-4 gap-4">
        <Stat label="P(Rise)" value={`${(s.pRise*100).toFixed(1)}%`} tone="bull" />
        <Stat label="P(Fall)" value={`${(s.pFall*100).toFixed(1)}%`} tone="bear" />
        <Stat label="RSI" value={s.rsi.toFixed(1)} tone={s.rsi > 70 ? "bear" : s.rsi < 30 ? "bull" : "neon"} />
        <Stat label="Volatility" value={`${s.volatility.toFixed(2)}%`} tone="warn" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div><div className="flex justify-between text-muted-foreground"><span>Rise pressure</span><span className="tabular">{(s.pRise*100).toFixed(0)}%</span></div><Bar value={s.pRise*100} tone="bull" /></div>
        <div><div className="flex justify-between text-muted-foreground"><span>Fall pressure</span><span className="tabular">{(s.pFall*100).toFixed(0)}%</span></div><Bar value={s.pFall*100} tone="bear" /></div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Signal icon={<Zap size={14} />} label="MACD Hist" value={s.macd.hist.toExponential(2)} tone={s.macd.hist > 0 ? "bull" : "bear"} />
        <Signal icon={s.lastDir > 0 ? <TrendingUp size={14}/> : <TrendingDown size={14}/>} label={`Streak ${s.streak}`} value={s.lastDir > 0 ? "Rising" : "Falling"} tone={s.lastDir>0?"bull":"bear"} />
        <Signal icon={<AlertTriangle size={14} />} label="Exhaustion" value={s.exhaustion ? "YES" : "NO"} tone={s.exhaustion ? "warn" : "neon"} />
        <Signal icon={<Zap size={14} />} label="Trend strength" value={s.trendStrength.toFixed(2)} tone={s.trendStrength > 0 ? "bull" : "bear"} />
      </div>
    </Panel>
  );
}

function Signal({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "bull"|"bear"|"warn"|"neon" }) {
  const color = tone === "bull" ? "text-[var(--bull)]" : tone === "bear" ? "text-[var(--bear)]" : tone === "warn" ? "text-[var(--warn)]" : "text-[var(--neon)]";
  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/40 px-3 py-2">
      <span className={`flex items-center gap-2 text-[11px] uppercase tracking-wider ${color}`}>{icon}{label}</span>
      <span className={`tabular text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}
