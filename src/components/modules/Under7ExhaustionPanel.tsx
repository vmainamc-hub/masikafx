import { Panel } from "../Panel";
import { TrendingDown, Radar, ShieldCheck, Flame, Activity, Trophy, AlertTriangle } from "lucide-react";
import { useAlertSound } from "@/hooks/useAlertSound";
import type { U7Signal, U7Resolved } from "@/hooks/useUnder7ExhaustionScan";

type Props = {
  signals: U7Signal[];
  history: U7Resolved[];
  winRate: { wins: number; losses: number };
  ranking: { symbol: string; name: string; rank: number; stability: number; lowDom: number; highDom: number; manipulation: number }[];
  status?: string;
  scannedCount: number;
};

export function Under7ExhaustionPanel({ signals, history, winRate, ranking, status, scannedCount }: Props) {
  const accent = "var(--bear)";
  const matchKey = signals.map((s) => s.symbol + s.kind).sort().join(",");
  useAlertSound(matchKey ? `U7X:${matchKey}` : "");

  const total = winRate.wins + winRate.losses;
  const winPct = total ? Math.round((winRate.wins / total) * 100) : 0;
  const top = signals.length ? [...signals].sort((a, b) => b.conf - a.conf)[0] : null;
  const topRanked = ranking.slice(0, 5);

  return (
    <Panel
      title="UNDER 7 · AI Exhaustion Scanner"
      subtitle="500-tick · OVER 5 streak ≥3 → UNDER 4 confirm → UNDER 7 · loss ⇒ UNDER 5 recovery"
      accent="magenta"
    >
      {/* Status + meters */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-md border border-border/40 bg-secondary/30 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider opacity-70 flex items-center gap-1">
            <Radar size={10} className={status === "live" ? "pulse-dot" : ""} /> Scanner
          </div>
          <div className="text-[10px] tabular mt-1">{status ?? "idle"} · {scannedCount} mkts</div>
        </div>
        <div className="rounded-md border border-border/40 bg-secondary/30 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider opacity-70">Confidence (top)</div>
          <div className="mt-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div className="h-full" style={{ width: `${top?.conf ?? 0}%`, background: accent }} />
          </div>
          <div className="text-[10px] tabular mt-0.5">{top ? `${top.name.replace(" Index", "")} · ${top.conf}%` : "—"}</div>
        </div>
        <div className="rounded-md border border-border/40 bg-secondary/30 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-wider opacity-70">Win-rate</div>
          <div className="mt-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div className="h-full bg-[var(--bull)]" style={{ width: `${winPct}%` }} />
          </div>
          <div className="text-[10px] tabular mt-0.5">{winPct}% · {winRate.wins}W / {winRate.losses}L</div>
        </div>
      </div>

      {top && (
        <div className="rounded-md border border-[var(--warn)]/30 bg-[var(--warn)]/5 px-2 py-1.5 mb-3">
          <div className="flex items-center justify-between text-[9px] uppercase tracking-wider opacity-80">
            <span className="flex items-center gap-1"><ShieldCheck size={10}/> Manipulation</span>
            <span className="tabular">{(top.manipulation * 100).toFixed(1)}% · cap 20%</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div className="h-full bg-[var(--warn)]" style={{ width: `${Math.min(100, top.manipulation * 500)}%` }} />
          </div>
        </div>
      )}

      {/* Signals */}
      {signals.length === 0 ? (
        <p className="text-[11px] text-foreground/60 px-1 py-3">
          Awaiting OVER 5 streak + UNDER 4 confirmation across {scannedCount} markets…
        </p>
      ) : (
        <ul className="space-y-2">
          {signals.map((s) => {
            const isRecovery = s.kind === "UNDER5_RECOVERY";
            const labelText = isRecovery ? "UNDER 5 · Recovery" : "UNDER 7";
            return (
              <li key={s.id}
                className="rounded-md border anim-pop px-2.5 py-2"
                style={{
                  borderColor: isRecovery ? "color-mix(in oklab, var(--warn) 50%, transparent)" : `color-mix(in oklab, ${accent} 45%, transparent)`,
                  background: isRecovery ? "color-mix(in oklab, var(--warn) 8%, transparent)" : `color-mix(in oklab, ${accent} 8%, transparent)`,
                }}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold flex items-center gap-1.5" style={{ color: isRecovery ? "var(--warn)" : accent }}>
                    {isRecovery ? <AlertTriangle size={12} className="pulse-dot" /> : <TrendingDown size={12} className="pulse-dot" />}
                    {s.name} · {labelText}
                  </span>
                  <span className="tabular text-[10px] opacity-80">
                    {s.conf}% conf · {new Date(s.ts).toLocaleTimeString()}
                  </span>
                </div>

                <div className="mt-1 grid grid-cols-2 gap-x-3 text-[10px] tabular text-foreground/80">
                  <span>Low (0-4) {(s.lowDom * 100).toFixed(1)}%</span>
                  <span>High (7-9) {(s.highDom * 100).toFixed(1)}%</span>
                  <span>Mid (5-6) {(s.midDom * 100).toFixed(1)}%</span>
                  <span>Manip {(s.manipulation * 100).toFixed(1)}%</span>
                  <span>Over5 streak {s.over5Streak}</span>
                  <span>Under4 confirm {s.under4Confirmed ? "✓" : "—"}</span>
                  <span>Low mom {s.lowMomentum}</span>
                  <span>High mom {s.highMomentum}</span>
                  <span>Entry {s.entryPrice.toFixed(4)}</span>
                  <span>Stability {(s.stability * 100).toFixed(0)}%</span>
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px]">
                  <span className={`px-1.5 py-0.5 rounded ${s.status === "SAFE ENTRY" ? "bg-[var(--bull)]/15 text-[var(--bull)]" : "bg-[var(--warn)]/20 text-[var(--warn)]"}`}>
                    <Flame size={9} className="inline mr-1" /> {s.status}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/70">
                    rank {s.rank}/100
                  </span>
                </div>

                <div className="mt-1.5 text-[9px] uppercase tracking-wider opacity-60 flex items-center gap-1">
                  <Activity size={9} /> live · cooldown 30s · resolves in 5 ticks
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Market ranking */}
      {topRanked.length > 0 && (
        <div className="mt-3 border-t border-border/40 pt-2">
          <div className="text-[9px] uppercase tracking-wider opacity-60 mb-1 flex items-center gap-1">
            <Trophy size={10} /> Safest markets (live ranking)
          </div>
          <ul className="space-y-0.5">
            {topRanked.map((r) => (
              <li key={r.symbol} className="flex items-center justify-between text-[10px] tabular opacity-90">
                <span>{r.name.replace(" Index", "")}</span>
                <span className="flex items-center gap-2">
                  <span className="opacity-70">low {(r.lowDom * 100).toFixed(0)}% · high {(r.highDom * 100).toFixed(0)}%</span>
                  <span style={{ color: accent }}>{r.rank}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-3 border-t border-border/40 pt-2">
          <div className="text-[9px] uppercase tracking-wider opacity-60 mb-1">Signal history</div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto pr-1">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between text-[10px] tabular opacity-90">
                <span>{new Date(h.ts).toLocaleTimeString()} · {h.name.replace(" Index", "")}</span>
                <span className="flex items-center gap-2">
                  <span style={{ color: h.kind === "UNDER5_RECOVERY" ? "var(--warn)" : accent }}>
                    {h.kind === "UNDER5_RECOVERY" ? "U5·REC" : "U7"} · {h.conf}%
                  </span>
                  <span className={
                    h.outcome === "WIN" ? "text-[var(--bull)]"
                    : h.outcome === "LOSS" ? "text-[var(--bear)]"
                    : "opacity-60"
                  }>{h.outcome ?? "PENDING"}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
