import { evenOddStats, predictNextEvenOdd, type Tick } from "@/lib/analytics";
import { Panel, Stat, Bar } from "../Panel";

export function EvenOddModule({ ticks }: { ticks: Tick[] }) {
  const s = evenOddStats(ticks);
  const seq = predictNextEvenOdd(ticks, 10);
  return (
    <Panel title="Even / Odd Analyzer" subtitle="Markov + Bayesian sequence model" accent="cyan">
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Even" value={`${(s.pEven * 100).toFixed(1)}%`} tone="neon" />
        <Stat label="Odd" value={`${(s.pOdd * 100).toFixed(1)}%`} tone="warn" />
        <Stat label="Streak" value={`${s.streak} ${s.streakType.toUpperCase()}`} tone="warn" hint={`continuation ${(s.continuation*100).toFixed(0)}%`} />
        <Stat label="Entropy" value={s.entropy.toFixed(3)} hint={s.entropy < 0.9 ? "low / predictable" : "high / random"} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div><div className="flex justify-between text-muted-foreground"><span>Continuation</span><span className="tabular">{(s.continuation*100).toFixed(1)}%</span></div><Bar value={s.continuation*100} tone="bull" /></div>
        <div><div className="flex justify-between text-muted-foreground"><span>Reversal</span><span className="tabular">{(s.reversal*100).toFixed(1)}%</span></div><Bar value={s.reversal*100} tone="bear" /></div>
      </div>

      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Next 10 Predicted Outcomes</div>
        <div className="flex gap-1.5">
          {seq.map((p, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className={`w-full h-10 rounded-md flex items-center justify-center text-[10px] font-semibold tabular ${p.label === "EVEN" ? "bg-[var(--neon)]/15 text-[var(--neon)] border border-[var(--neon)]/40" : "bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/40"}`}>
                {p.label}
              </div>
              <span className="text-[9px] text-muted-foreground tabular">{p.conf}%</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
