import { overUnderStats, type Tick } from "@/lib/analytics";
import { Panel, Stat } from "../Panel";

export function OverUnderModule({ ticks, threshold = 5 }: { ticks: Tick[]; threshold?: number }) {
  const s = overUnderStats(ticks, threshold);
  const max = Math.max(...s.freq, 1);
  return (
    <Panel title="Over / Under Predictor" subtitle={`Digit distribution · threshold ${threshold}`} accent="cyan">
      <div className="grid grid-cols-3 gap-4">
        <Stat label={`Over ${threshold}`} value={`${(s.pOver*100).toFixed(1)}%`} tone="bull" />
        <Stat label={`Under ${threshold}`} value={`${(s.pUnder*100).toFixed(1)}%`} tone="bear" />
        <Stat label="Anomaly" value={`${(s.anomaly*100).toFixed(0)}%`} tone="warn" hint={`χ² ${s.chi.toFixed(1)}`} />
      </div>
      <div className="mt-5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Digit Frequency Heatmap</div>
        <div className="grid grid-cols-10 gap-1.5">
          {s.freq.map((f, d) => {
            const intensity = f / max;
            const isOver = d > threshold;
            const bg = `oklch(${0.25 + intensity*0.4} ${0.05 + intensity*0.15} ${isOver ? 155 : 25} / ${0.25 + intensity*0.75})`;
            return (
              <div key={d} className="rounded-md text-center py-2 border border-border/40" style={{ background: bg }}>
                <div className="text-[10px] text-muted-foreground tabular">{d}</div>
                <div className="text-sm font-semibold tabular">{f}</div>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
