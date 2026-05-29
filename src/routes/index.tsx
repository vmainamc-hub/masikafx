import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Activity, Pause, Play, Upload, Radio, Cpu, BarChart3, Wifi, WifiOff } from "lucide-react";
import { useTickStream } from "@/hooks/useTickStream";
import { useDerivStream, DERIV_SYMBOLS } from "@/hooks/useDerivStream";
import { lastDigit, type Tick } from "@/lib/analytics";
import { Panel } from "@/components/Panel";
import { PriceChart } from "@/components/PriceChart";
import { EvenOddModule } from "@/components/modules/EvenOddModule";
import { RiseFallModule } from "@/components/modules/RiseFallModule";
import { OverUnderModule } from "@/components/modules/OverUnderModule";
import { MatchDiffModule } from "@/components/modules/MatchDiffModule";
import { MarketIntel } from "@/components/modules/MarketIntel";
import { SignalFeed } from "@/components/modules/SignalFeed";
import { useMultiVolatilityScan } from "@/hooks/useMultiVolatilityScan";
import { useAdvancedOverUnderScan } from "@/hooks/useAdvancedOverUnderScan";
import { AdvancedScannerFeed } from "@/components/modules/AdvancedScannerFeed";
import { useOver5Under4Scan } from "@/hooks/useOver5Under4Scan";
import { Over5Under4Panel } from "@/components/modules/Over5Under4Panel";
import { DigitPercentages } from "@/components/modules/DigitPercentages";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Deriv Edge AI — Market Probability Analytics" },
      { name: "description", content: "Institutional-grade probability forecasting for Even/Odd, Rise/Fall, Over/Under and Matches/Differs markets." },
    ],
  }),
  component: Dashboard,
});

const WINDOWS = [10, 25, 50, 100, 500] as const;

function Dashboard() {
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(350);
  const [windowSize, setWindowSize] = useState<typeof WINDOWS[number]>(100);
  const [threshold, setThreshold] = useState(5);
  const [source, setSource] = useState<string>("R_100"); // Deriv symbol
  const isDeriv = true;
  const synth = useTickStream({ running: false, speedMs: speed });
  const deriv = useDerivStream(source, running);
  const ticks = deriv.ticks;
  const setTicks = synth.setTicks;
  const view: Tick[] = useMemo(() => ticks.slice(-windowSize), [ticks, windowSize]);
  const fileRef = useRef<HTMLInputElement>(null);
  const scan = useMultiVolatilityScan(running);
  const advScan = useAdvancedOverUnderScan(running);
  const o5u4 = useOver5Under4Scan(running);

  const onUpload = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const parsed: Tick[] = [];
    lines.forEach((line, i) => {
      const parts = line.split(/[,\t;]/);
      const last = parts[parts.length - 1];
      const num = parseFloat(last);
      if (!isNaN(num)) parsed.push({ t: Date.now() - (lines.length - i) * 1000, price: num });
    });
    if (parsed.length > 10) { setTicks(parsed.slice(-1000)); setRunning(false); }
  };

  const last = view[view.length - 1];
  const prev = view[view.length - 2] ?? last;
  const change = last ? ((last.price - prev.price) / prev.price) * 100 : 0;
  const digit = last ? lastDigit(last.price) : 0;

  return (
    <div className="min-h-screen grid-bg">
      {/* Header */}
      <header className="border-b border-border/40 glass sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-gradient-to-br from-[var(--neon)] to-[var(--accent)] flex items-center justify-center">
              <Activity size={18} className="text-[var(--primary-foreground)]" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-wide neon-text">DERIV EDGE <span className="text-[var(--accent)]">AI</span></h1>
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Probability Intelligence Engine</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-6 text-xs">
            <Metric label="LAST" value={last?.price.toFixed(4) ?? "—"} mono />
            <Metric label="Δ" value={`${change >= 0 ? "+" : ""}${change.toFixed(3)}%`} mono tone={change >= 0 ? "bull" : "bear"} />
            <Metric label="DIGIT" value={String(digit)} mono tone={digit % 2 === 0 ? "neon" : "magenta"} />
            <Metric label="TICKS" value={String(ticks.length)} mono />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/60 bg-secondary/40 text-[11px] text-muted-foreground">
              {isDeriv ? (
                deriv.status === "live" ? <Wifi size={12} className="text-[var(--bull)] pulse-dot" />
                : deriv.status === "connecting" ? <Radio size={12} className="text-[var(--accent)] pulse-dot" />
                : <WifiOff size={12} className="text-[var(--bear)]" />
              ) : (
                <Radio size={12} className={running ? "text-[var(--bull)] pulse-dot" : "text-muted-foreground"} />
              )}
              {isDeriv ? deriv.status.toUpperCase() : (running ? "LIVE" : "PAUSED")}
            </div>
            <button onClick={() => setRunning(r => !r)} className="h-8 px-3 rounded-md bg-secondary hover:bg-secondary/70 border border-border/60 text-xs flex items-center gap-1.5">
              {running ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Resume</>}
            </button>
            <button onClick={() => fileRef.current?.click()} className="h-8 px-3 rounded-md bg-[var(--neon)]/15 hover:bg-[var(--neon)]/25 border border-[var(--neon)]/40 text-xs text-[var(--neon)] flex items-center gap-1.5">
              <Upload size={12} /> CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground uppercase tracking-wider">Feed</span>
          <select
            value={source}
            onChange={(e) => { setSource(e.target.value); setRunning(true); }}
            className="h-8 px-2 rounded-md bg-secondary/40 border border-border/60 text-[11px] text-foreground focus:outline-none focus:border-[var(--neon)]"
          >
            <optgroup label="Deriv · Volatility">
              {DERIV_SYMBOLS.filter(s => s.group === "Standard").map(s => <option key={s.symbol} value={s.symbol}>{s.name}</option>)}
            </optgroup>
            <optgroup label="Deriv · Volatility 1s">
              {DERIV_SYMBOLS.filter(s => s.group === "1s").map(s => <option key={s.symbol} value={s.symbol}>{s.name}</option>)}
            </optgroup>
            <optgroup label="Deriv · Jump">
              {DERIV_SYMBOLS.filter(s => s.group === "Jump").map(s => <option key={s.symbol} value={s.symbol}>{s.name}</option>)}
            </optgroup>
            <optgroup label="Deriv · Crash/Boom">
              {DERIV_SYMBOLS.filter(s => s.group === "Crash/Boom").map(s => <option key={s.symbol} value={s.symbol}>{s.name}</option>)}
            </optgroup>
          </select>
          {isDeriv && deriv.error && <span className="text-[var(--bear)] text-[10px]">{deriv.error}</span>}

          <span className="text-muted-foreground uppercase tracking-wider ml-2">Rolling window</span>
          <div className="flex gap-1 rounded-md border border-border/60 bg-secondary/40 p-1">
            {WINDOWS.map(w => (
              <button key={w} onClick={() => setWindowSize(w)} className={`px-2.5 py-1 rounded text-[11px] tabular ${windowSize === w ? "bg-[var(--neon)]/20 text-[var(--neon)]" : "text-muted-foreground hover:text-foreground"}`}>{w}t</button>
            ))}
          </div>

          <span className="text-muted-foreground uppercase tracking-wider ml-4">Speed</span>
          <input type="range" min={100} max={1000} step={50} value={speed} onChange={(e) => setSpeed(+e.target.value)} className="accent-[var(--neon)]" />
          <span className="tabular text-foreground/70">{speed}ms</span>

          <span className="text-muted-foreground uppercase tracking-wider ml-4">O/U threshold</span>
          <div className="flex gap-1 rounded-md border border-border/60 bg-secondary/40 p-1">
            {[3, 4, 5, 6, 7].map(t => (
              <button key={t} onClick={() => setThreshold(t)} className={`px-2.5 py-1 rounded text-[11px] tabular ${threshold === t ? "bg-[var(--accent)]/20 text-[var(--accent)]" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>
            ))}
          </div>
        </div>

        {view.length === 0 ? (
          <div className="glass rounded-lg p-10 text-center text-sm text-muted-foreground">
            <Radio size={18} className="inline mr-2 text-[var(--neon)] pulse-dot" />
            {isDeriv ? `Connecting to Deriv · ${source}…` : "Initializing synthetic feed…"}
          </div>
        ) : (
          <>
            {/* Top grid: chart + signals */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <Panel title="Live Market Stream" subtitle={isDeriv ? `Deriv WS · ${DERIV_SYMBOLS.find(s=>s.symbol===source)?.name ?? source}` : "Synthetic tick feed · Geometric Brownian Motion"} accent="cyan">
                  <PriceChart ticks={view} />
                  <div className="mt-3 grid grid-cols-5 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {[10,25,50,100,500].map(n => {
                      const slice = ticks.slice(-n);
                      const evens = slice.filter(t => lastDigit(t.price)%2===0).length;
                      return (
                        <div key={n} className="rounded-md border border-border/40 bg-secondary/30 p-2">
                          <div>Last {n}t</div>
                          <div className="tabular text-sm text-foreground mt-1">E {evens} · O {slice.length - evens}</div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              </div>
              <SignalFeed ticks={view} scanMatches={scan.matches} evenOddMatches={scan.evenOddMatches} over2Matches={scan.over2Matches} over2History={scan.over2History} botMatches={scan.botMatches} botHistory={scan.botHistory} scanStatus={scan.status} scannedCount={scan.scannedCount} />
            </div>

            <DigitPercentages ticks={ticks} />

            {/* Modules grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <EvenOddModule ticks={view} />
              <RiseFallModule ticks={view} />
              <OverUnderModule ticks={view} threshold={threshold} />
              <MatchDiffModule ticks={view} />
            </div>

            {/* Advanced OVER 2 / UNDER 7 multi-market scanners */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <AdvancedScannerFeed
                type="OVER2"
                signals={advScan.over2Signals}
                history={advScan.over2History}
                winRate={advScan.over2WinRate}
                status={advScan.status}
                scannedCount={advScan.scannedCount}
              />
              <AdvancedScannerFeed
                type="UNDER7"
                signals={advScan.under7Signals}
                history={advScan.under7History}
                winRate={advScan.under7WinRate}
                status={advScan.status}
                scannedCount={advScan.scannedCount}
              />
            </div>

            {/* UNDER 7 exhaustion + UNDER 5 recovery scanner */}
            <Under7ExhaustionPanel
              signals={u7Scan.signals}
              history={u7Scan.history}
              winRate={u7Scan.winRate}
              ranking={u7Scan.ranking}
              status={u7Scan.status}
              scannedCount={u7Scan.scannedCount}
            />

            <SignalBacktestPanel history={u7Scan.history} thresholds={u7Scan.thresholds} />


            <MarketIntel ticks={view} />
          </>
        )}

        {/* Footer stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <FooterStat icon={<Cpu size={14}/>} label="Models active" value="6" hint="Markov · Bayes · MC · RSI · MACD · χ²" />
          <FooterStat icon={<BarChart3 size={14}/>} label="Data points" value={ticks.length.toLocaleString()} hint="rolling buffer 1k" />
          <FooterStat icon={<Activity size={14}/>} label="Session win-rate" value="—" hint="trade log empty" />
          <FooterStat icon={<Radio size={14}/>} label="Refresh" value={`${speed}ms`} hint="tick cadence" />
        </div>

        <p className="text-center text-[10px] text-muted-foreground uppercase tracking-[0.25em] py-4">
          Deriv Edge AI · v1.0 · Statistical models for research. Not financial advice.
        </p>
      </main>
    </div>
  );
}

function Metric({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "bull"|"bear"|"neon"|"magenta" }) {
  const color = tone === "bull" ? "text-[var(--bull)]" : tone === "bear" ? "text-[var(--bear)]" : tone === "magenta" ? "text-[var(--accent)]" : tone === "neon" ? "text-[var(--neon)]" : "text-foreground";
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className={`${mono ? "tabular" : ""} text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function FooterStat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="glass rounded-lg px-3 py-2.5 flex items-center gap-3">
      <div className="text-[var(--neon)]">{icon}</div>
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="tabular text-sm font-semibold">{value}</div>
      </div>
      <div className="text-[10px] text-muted-foreground text-right max-w-[140px]">{hint}</div>
    </div>
  );
}
