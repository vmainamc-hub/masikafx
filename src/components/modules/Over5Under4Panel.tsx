import { Panel } from "../Panel";
import { TrendingUp, TrendingDown, Radar, ShieldCheck, Volume2 } from "lucide-react";
import { useAlertSound } from "@/hooks/useAlertSound";
import type { OUMatch } from "@/hooks/useOver5Under4Scan";

type Props = {
  type: "OVER5" | "UNDER4";
  signals: OUMatch[];
  history: OUMatch[];
  status?: string;
  scannedCount: number;
};

export function Over5Under4Panel({ type, signals, history, status, scannedCount }: Props) {
  const isOver = type === "OVER5";
  const accentVar = isOver ? "var(--bull)" : "var(--bear)";
  const label = isOver ? "OVER 5" : "UNDER 4";
  const sub = isOver
    ? "pOver5 > 42% · pUnder5 < 47.5% · manip < 20%"
    : "pUnder4 > 42% · pOver4 < 47.5% · manip < 20%";
  const Icon = isOver ? TrendingUp : TrendingDown;

  const key = signals.map((s) => s.symbol).sort().join(",");
  useAlertSound(key ? `${type}:${key}` : "");

  return (
    <Panel title={`${label} · AI Scanner`} subtitle={sub} accent={isOver ? "cyan" : "magenta"}>
      <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-wider opacity-80">
        <span className="flex items-center gap-1">
          <Radar size={11} className={status === "live" ? "pulse-dot" : ""} /> {status ?? "idle"} · {scannedCount} mkts
        </span>
        <span>{signals.length} live · {history.length} recent</span>
      </div>

      {signals.length === 0 ? (
        <p className="text-[11px] text-foreground/60 px-1 py-3">
          No market currently meets {label} conditions. Scanning…
        </p>
      ) : (
        <ul className="space-y-2">
          {signals.map((s) => {
            const mp = s.manipulation * 100;
            const pass = mp < 20;
            return (
              <li key={s.id}
                className="rounded-md border anim-pop px-2.5 py-2"
                style={{
                  borderColor: `color-mix(in oklab, ${accentVar} 45%, transparent)`,
                  background: `color-mix(in oklab, ${accentVar} 8%, transparent)`,
                }}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold flex items-center gap-1.5" style={{ color: accentVar }}>
                    <Icon size={12} className="pulse-dot" /> {s.name} · {label}
                  </span>
                  <span className="tabular text-[10px] opacity-80">
                    {s.conf}% conf · {new Date(s.ts).toLocaleTimeString()}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 text-[10px] tabular text-foreground/80">
                  <span>{isOver ? "pOver5" : "pUnder4"} {((isOver ? s.pOver : s.pUnder) * 100).toFixed(1)}%</span>
                  <span>{isOver ? "pUnder5" : "pOver4"} {((isOver ? s.pUnder : s.pOver) * 100).toFixed(1)}%</span>

                  <span>Manip {mp.toFixed(1)}%</span>
                  <span>Entry {s.entryPrice.toFixed(4)}</span>
                  <span>Last digit {s.lastDigit}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px]">
                  <span className={`px-1.5 py-0.5 rounded flex items-center gap-1 ${pass ? "bg-[var(--bull)]/15 text-[var(--bull)]" : "bg-[var(--bear)]/15 text-[var(--bear)]"}`}>
                    <ShieldCheck size={9} /> manip gate {pass ? "PASS" : "FAIL"} · {mp.toFixed(1)}%/20%
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {history.length > 0 && (
        <div className="mt-3 border-t border-border/40 pt-2">
          <div className="text-[9px] uppercase tracking-wider opacity-60 mb-1 flex items-center justify-between">
            <span><Volume2 size={10} className="inline mr-1" />Recent history</span>
            <span className="tabular">{history.length}</span>
          </div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto pr-1">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between text-[10px] tabular opacity-90">
                <span>{new Date(h.ts).toLocaleTimeString()} · {h.name.replace(" Index", "")}</span>
                <span style={{ color: accentVar }}>{label} · {h.conf}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
