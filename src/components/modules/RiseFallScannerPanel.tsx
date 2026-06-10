import { useMemo, useState } from "react";
import { Panel, Bar } from "../Panel";
import { ScanLine, Brain, ShieldCheck, AlertTriangle, TrendingUp, TrendingDown, Activity, Gauge } from "lucide-react";
import type { Tick } from "@/lib/analytics";
import { scanRiseFall, backtestRiseFall, type RiseFallScan, type BacktestResult } from "@/lib/riseFallEngine";

export function RiseFallScannerPanel({ ticks, marketName }: { ticks: Tick[]; marketName: string }) {
  const [scan, setScan] = useState<RiseFallScan | null>(null);
  const [bt, setBt] = useState<BacktestResult | null>(null);
  const [minConf, setMinConf] = useState(70);
  const [btWindow, setBtWindow] = useState<100 | 500 | 1000>(500);
  const ready = ticks.length >= 60;

  const onScan = () => {
    setScan(scanRiseFall(ticks.slice(-500), minConf));
  };
  const onBacktest = () => {
    setBt(backtestRiseFall(ticks, btWindow, minConf));
  };

  const sigColor = scan?.signal === "RISE" ? "text-[var(--bull)]" : scan?.signal === "FALL" ? "text-[var(--bear)]" : "text-muted-foreground";
  const riskColor = scan?.risk === "LOW" ? "text-[var(--bull)]" : scan?.risk === "MEDIUM" ? "text-[var(--warn)]" : "text-[var(--bear)]";

  return (
    <Panel
      title="AI Rise / Fall Scanner Pro"
      subtitle={`${marketName} · multi-indicator confluence + NO-TRADE gate`}
      accent="cyan"
    >
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={onScan}
          disabled={!ready}
          className="h-9 px-4 rounded-md bg-gradient-to-r from-[var(--neon)] to-[var(--accent)] text-[var(--primary-foreground)] text-xs font-semibold flex items-center gap-2 disabled:opacity-50"
        >
          <ScanLine size={14} /> SCAN MARKET
        </button>
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground ml-2">
          Min confidence
          <input
            type="range" min={60} max={90} step={1}
            value={minConf} onChange={(e) => setMinConf(+e.target.value)}
            className="accent-[var(--neon)] ml-2"
          />
          <span className="tabular text-foreground/80 ml-1">{minConf}%</span>
        </div>
        {!ready && <span className="text-[10px] text-[var(--warn)]">Need 60+ ticks to scan</span>}
      </div>

      {!scan ? (
        <div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-xs text-muted-foreground">
          <Brain size={20} className="mx-auto mb-2 text-[var(--neon)]" />
          Press <span className="text-foreground font-semibold">SCAN MARKET</span> to run the AI probability engine on the latest 500 ticks.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Headline */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Signal" value={scan.signal} tone={sigColor} icon={scan.signal === "RISE" ? <TrendingUp size={14}/> : scan.signal === "FALL" ? <TrendingDown size={14}/> : <ShieldCheck size={14}/>} />
            <Tile label="Confidence" value={`${scan.confidence}%`} tone="text-[var(--neon)]" />
            <Tile label="Risk" value={scan.risk} tone={riskColor} />
            <Tile label="Quality" value={`${scan.health.quality}/100`} tone="text-foreground" />
          </div>

          {/* Probability meters */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="flex justify-between text-muted-foreground"><span>Rise probability</span><span className="tabular">{(scan.pRise*100).toFixed(1)}%</span></div>
              <Bar value={scan.pRise*100} tone="bull" />
            </div>
            <div>
              <div className="flex justify-between text-muted-foreground"><span>Fall probability</span><span className="tabular">{(scan.pFall*100).toFixed(1)}%</span></div>
              <Bar value={scan.pFall*100} tone="bear" />
            </div>
          </div>

          {/* Strength banner */}
          <div className={`rounded-md border px-3 py-2 text-xs flex items-center gap-2 ${
            scan.strength === "Strong Signal" ? "border-[var(--bull)]/40 bg-[var(--bull)]/10 text-[var(--bull)]" :
            scan.strength === "Moderate Signal" ? "border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)]" :
            "border-border/60 bg-secondary/40 text-muted-foreground"
          }`}>
            <Gauge size={14} /> {scan.strength} — recommendation: <span className="font-semibold">{scan.signal}</span>
          </div>

          {/* Market Health */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <Mini label="Trend strength" value={scan.health.trendStrength.toFixed(3)} />
            <Mini label="Volatility" value={`${scan.health.volatilityScore.toFixed(0)}/100`} />
            <Mini label="Stability" value={`${scan.health.stability.toFixed(0)}/100`} />
            <Mini label="Momentum" value={scan.health.momentumDir} />
          </div>

          {/* Manip gate */}
          <div className={`flex items-center gap-2 text-[11px] ${scan.health.manipulation < 0.2 ? "text-[var(--bull)]" : "text-[var(--bear)]"}`}>
            <ShieldCheck size={12} /> manip gate {scan.health.manipulation < 0.2 ? "PASS" : "FAIL"} · {(scan.health.manipulation*100).toFixed(0)}%/20%
          </div>

          {/* Indicator votes */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Indicator confluence</div>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              {scan.votes.map((v) => (
                <div key={v.name} className="flex items-center justify-between rounded border border-border/60 bg-secondary/40 px-2 py-1.5">
                  <span className="text-muted-foreground">{v.name}</span>
                  <span className={`tabular font-semibold ${
                    v.signal === "RISE" ? "text-[var(--bull)]" : v.signal === "FALL" ? "text-[var(--bear)]" : "text-muted-foreground"
                  }`}>{v.signal} · {v.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Reasoning */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1"><Brain size={11}/> AI reasoning</div>
            <ul className="text-[11px] space-y-1 text-foreground/85">
              {scan.reasoning.map((r, i) => <li key={i} className="flex gap-2"><span className="text-[var(--neon)]">▸</span>{r}</li>)}
            </ul>
          </div>

          {/* Stake sizing */}
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <Mini label="Conservative" value={`${scan.stakes.conservative}%`} />
            <Mini label="Moderate" value={`${scan.stakes.moderate}%`} />
            <Mini label="Aggressive" value={`${scan.stakes.aggressive}%`} />
          </div>

          {/* Backtest */}
          <div className="rounded-md border border-border/60 bg-secondary/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Activity size={11}/> Backtest</span>
              <div className="flex gap-1">
                {[100, 500, 1000].map((w) => (
                  <button key={w} onClick={() => setBtWindow(w as 100|500|1000)} className={`px-2 py-0.5 rounded text-[10px] tabular ${btWindow===w ? "bg-[var(--neon)]/20 text-[var(--neon)]" : "text-muted-foreground hover:text-foreground"}`}>{w}t</button>
                ))}
                <button onClick={onBacktest} className="px-2 py-0.5 rounded text-[10px] bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30">Run</button>
              </div>
            </div>
            {bt ? (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px]">
                <Mini label="Trades" value={String(bt.trades)} />
                <Mini label="Win rate" value={`${(bt.winRate*100).toFixed(1)}%`} />
                <Mini label="Wins" value={String(bt.wins)} />
                <Mini label="Profit factor" value={bt.profitFactor.toFixed(2)} />
                <Mini label="Max DD" value={bt.maxDrawdown.toFixed(1)} />
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">Run a backtest over the selected window.</div>
            )}
          </div>

          {scan.signal === "NO TRADE" && (
            <div className="rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-3 py-2 text-[11px] text-[var(--warn)] flex items-center gap-2">
              <AlertTriangle size={12} /> NO-TRADE ZONE — confluence below threshold or manipulation detected. Stay flat.
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function Tile({ label, value, tone, icon }: { label: string; value: string; tone: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/60 bg-secondary/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`tabular text-lg font-semibold mt-0.5 ${tone}`}>{value}</div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/40 bg-secondary/30 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="tabular text-xs font-semibold text-foreground">{value}</div>
    </div>
  );
}
