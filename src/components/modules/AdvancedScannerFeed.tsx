import { Panel } from "../Panel";
import { TrendingUp, TrendingDown, Radar, Volume2, ShieldCheck, Activity, Flame } from "lucide-react";
import { useAlertSound } from "@/hooks/useAlertSound";
import type { AdvancedSignal } from "@/hooks/useAdvancedOverUnderScan";

type Props = {
  type: "OVER2" | "UNDER7";
  signals: AdvancedSignal[];
  history: (AdvancedSignal & { outcome?: "WIN" | "LOSS" | "PENDING" })[];
  winRate: { wins: number; losses: number };
  status?: string;
  scannedCount: number;
};

export function AdvancedScannerFeed({ type, signals, history, winRate, status, scannedCount }: Props) {
  const isOver = type === "OVER2";
  const accent = isOver ? "bull" : "bear";
  const accentVar = isOver ? "var(--bull)" : "var(--bear)";
  const label = isOver ? "OVER 2" : "UNDER 7";
  const Icon = isOver ? TrendingUp : TrendingDown;

  const matchKey = signals.map((s) => s.symbol).sort().join(",");
  useAlertSound(matchKey ? `${type}:${matchKey}` : "");

  const total = winRate.wins + winRate.losses;
  const winPct = total ? Math.round((winRate.wins / total) * 100) : 0;
  const top = signals.length ? [...signals].sort((a, b) => b.conf - a.conf)[0] : null;

  return (
    <Panel
      title={`${label} · AI Market Scanner`}
      subtitle={isOver
        ? "500-tick · momentum 0/2/4 · buildup 7-9 · exhaustion 0/1"
        : "500-tick · momentum 5/7/9 · buildup 0-2 · exhaustion 7/9"}
      accent={isOver ? "neon" : "magenta"}
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
            <div className="h-full" style={{ width: `${top?.conf ?? 0}%`, background: accentVar }} />
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

      {/* Manipulation meter from top match */}
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

      {signals.length === 0 ? (
        <p className="text-[11px] text-foreground/60 px-1 py-3">
          No market currently meets all {label} conditions. Scanning {scannedCount} synthetic indices…
        </p>
      ) : (
        <ul className="space-y-2">
          {signals.map((s) => (
            <li
              key={s.symbol}
              className="rounded-md border anim-pop px-2.5 py-2"
              style={{ borderColor: `color-mix(in oklab, ${accentVar} 45%, transparent)`, background: `color-mix(in oklab, ${accentVar} 8%, transparent)` }}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold flex items-center gap-1.5" style={{ color: accentVar }}>
                  <Icon size={12} className="pulse-dot" /> {s.name} · {label}
                </span>
                <span className="tabular text-[10px] opacity-80">
                  {s.conf}% conf · {new Date(s.ts).toLocaleTimeString()}
                </span>
              </div>

              <div className="mt-1 grid grid-cols-2 gap-x-3 text-[10px] tabular text-foreground/80">
                <span>Over5 {(s.pOver5 * 100).toFixed(1)}%</span>
                <span>Under5 {(s.pUnder5 * 100).toFixed(1)}%</span>
                <span>Manip {(s.manipulation * 100).toFixed(1)}%</span>
                <span>Momentum {s.momentum}</span>
                <span>Entry {s.entryPrice.toFixed(4)}</span>
                <span>Last digit {s.lastDigit}</span>
              </div>

              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[9px]">
                <span className="px-1.5 py-0.5 rounded bg-[var(--bull)]/15 text-[var(--bull)]">
                  green: {s.greenDigits.join("·")}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-[var(--bear)]/15 text-[var(--bear)]">
                  red: {s.redDigits.join("·")}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded flex items-center gap-1 ${s.exhaustionStatus === "CONFIRMED" ? "bg-[var(--warn)]/20 text-[var(--warn)]" : "bg-foreground/10 text-foreground/70"}`}
                >
                  <Flame size={9} /> exhaustion {s.exhaustionStatus}
                </span>
              </div>

              <div className="mt-1.5 grid grid-cols-2 gap-2 text-[10px] tabular">
                <div className="rounded border border-border/30 bg-secondary/20 px-1.5 py-1">
                  <div className="text-[9px] uppercase opacity-60">Hidden buildup</div>
                  {s.buildup.map((b) => (
                    <div key={b.digit} className="flex justify-between">
                      <span>d{b.digit}</span>
                      <span>
                        {(b.pct * 100).toFixed(1)}% <span className={b.slope > 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}>
                          {b.slope > 0 ? "↑" : "↓"}{(b.slope * 1000).toFixed(2)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="rounded border border-border/30 bg-secondary/20 px-1.5 py-1">
                  <div className="text-[9px] uppercase opacity-60">Exhaustion</div>
                  {s.exhaustion.map((e) => (
                    <div key={e.digit} className="flex justify-between">
                      <span>d{e.digit}</span>
                      <span>
                        {(e.pct * 100).toFixed(1)}% · flat {(e.flat * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-1.5 text-[9px] uppercase tracking-wider opacity-60 flex items-center gap-1">
                <Activity size={9} /> live · cooldown 45s · resolves in 5 ticks
              </div>
            </li>
          ))}
        </ul>
      )}

      {history.length > 0 && (
        <div className="mt-3 border-t border-border/40 pt-2">
          <div className="text-[9px] uppercase tracking-wider opacity-60 mb-1 flex items-center justify-between">
            <span><Volume2 size={10} className="inline mr-1" />Signal history</span>
            <span className="tabular">{history.length} recent</span>
          </div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto pr-1">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between text-[10px] tabular opacity-90">
                <span>{new Date(h.ts).toLocaleTimeString()} · {h.name.replace(" Index", "")}</span>
                <span className="flex items-center gap-2">
                  <span style={{ color: accentVar }}>{label} · {h.conf}%</span>
                  <span className={
                    h.outcome === "WIN" ? "text-[var(--bull)]"
                    : h.outcome === "LOSS" ? "text-[var(--bear)]"
                    : "opacity-60"
                  }>
                    {h.outcome ?? "PENDING"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
