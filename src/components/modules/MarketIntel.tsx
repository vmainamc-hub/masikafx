import { marketIntel, monteCarlo, type Tick } from "@/lib/analytics";
import { Panel, Stat, Bar } from "../Panel";
import { Area, AreaChart, Line, LineChart, ResponsiveContainer, YAxis, XAxis } from "recharts";

export function MarketIntel({ ticks }: { ticks: Tick[] }) {
  const m = marketIntel(ticks);
  const mc = monteCarlo(ticks, 40, 150);
  return (
    <Panel title="Market Intelligence" subtitle="Institutional-grade signal aggregation" accent="amber">
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Edge Score" value={`${m.edgeScore}`} tone={m.edgeScore > 60 ? "bull" : m.edgeScore > 35 ? "warn" : "neon"} hint="0–100" />
        <Stat label="Vol Index" value={m.volatilityIndex.toFixed(2)} tone="warn" />
        <Stat label="Crowd Bias" value={`${(m.crowdBias*100).toFixed(0)}%`} tone={m.crowdBias > 0 ? "bull" : "bear"} hint={m.crowdBias > 0 ? "long" : "short"} />
        <Stat label="Manipulation" value={`${(m.manipulation*100).toFixed(0)}%`} tone={m.manipulation > 0.5 ? "bear" : "neon"} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
        <div>
          <div className="flex justify-between text-muted-foreground"><span>Streak pressure</span><span className="tabular">{(m.streakPressure*100).toFixed(0)}%</span></div>
          <Bar value={m.streakPressure*100} tone="warn" />
        </div>
        <div>
          <div className="flex justify-between text-muted-foreground"><span>Reversal zone</span><span className={m.reversalZone ? "text-[var(--bear)]" : "text-muted-foreground"}>{m.reversalZone ? "ACTIVE" : "—"}</span></div>
          <Bar value={m.reversalZone ? 100 : 10} tone={m.reversalZone ? "bear" : "neon"} />
        </div>
      </div>

      <div className="mt-5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex justify-between">
          <span>Monte Carlo Forecast (40 steps · 150 paths)</span>
          <span className="tabular">P↑ {(mc.pUp*100).toFixed(0)}% · P↓ {(mc.pDown*100).toFixed(0)}%</span>
        </div>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={mc.band}>
              <defs>
                <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--neon)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis dataKey="i" hide />
              <YAxis domain={["dataMin","dataMax"]} hide />
              <Area type="monotone" dataKey="hi" stroke="none" fill="url(#band)" />
              <Area type="monotone" dataKey="lo" stroke="none" fill="var(--background)" />
              <Line type="monotone" dataKey="mid" stroke="var(--neon)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Panel>
  );
}
