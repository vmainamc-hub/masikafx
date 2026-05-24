import { matchDiffStats, type Tick } from "@/lib/analytics";
import { Panel, Stat } from "../Panel";

export function MatchDiffModule({ ticks }: { ticks: Tick[] }) {
  const s = matchDiffStats(ticks);
  const max = Math.max(...s.probs);
  return (
    <Panel title="Matches / Differs AI" subtitle="Repetition cycles · hidden intervals" accent="magenta">
      <div className="grid grid-cols-4 gap-4">
        <Stat label="P(Match)" value={`${(s.pMatch*100).toFixed(1)}%`} tone="neon" />
        <Stat label="P(Differ)" value={`${(s.pDiffer*100).toFixed(1)}%`} tone="warn" />
        <Stat label="Most likely" value={s.mostLikely} tone="bull" hint={`${(s.probs[s.mostLikely]*100).toFixed(1)}%`} />
        <Stat label="Least likely" value={s.leastLikely} tone="bear" hint={`${(s.probs[s.leastLikely]*100).toFixed(1)}%`} />
      </div>
      <div className="mt-5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Digit Probability Matrix</div>
        <div className="space-y-1.5">
          {s.probs.map((p, d) => (
            <div key={d} className="flex items-center gap-2 text-xs">
              <span className="w-4 text-muted-foreground tabular">{d}</span>
              <div className="flex-1 h-4 bg-secondary/60 rounded overflow-hidden relative">
                <div className="h-full" style={{ width: `${(p/max)*100}%`, background: `linear-gradient(90deg, var(--neon), var(--accent))` }} />
              </div>
              <span className="w-12 text-right tabular text-foreground/80">{(p*100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
