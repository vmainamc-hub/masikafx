import { marketIntel, riseFallStats, evenOddStats, overUnderStats, type Tick } from "@/lib/analytics";
import { Panel } from "../Panel";
import { Sparkles, AlertTriangle, Activity, Target, TrendingDown, TrendingUp, Crosshair, Radar, Volume2, Dice5, Bot, ShieldCheck } from "lucide-react";

function ManipGate({ manipulation }: { manipulation: number }) {
  const mp = manipulation * 100;
  const pass = mp < 20;
  return (
    <span className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] ${pass ? "bg-[var(--bull)]/15 text-[var(--bull)]" : "bg-[var(--bear)]/15 text-[var(--bear)]"}`}>
      <ShieldCheck size={9} /> manip gate {pass ? "PASS" : "FAIL"} · {mp.toFixed(1)}%/20%
    </span>
  );
}
import { useAlertSound } from "@/hooks/useAlertSound";
import type { Under7Match, EvenOddMatch, Over2Match, BotMatch } from "@/hooks/useMultiVolatilityScan";

export function SignalFeed({
  ticks,
  scanMatches = [],
  evenOddMatches = [],
  over2Matches = [],
  over2History = [],
  botMatches = [],
  botHistory = [],
  scanStatus,
  scannedCount = 0,
}: {
  ticks: Tick[];
  scanMatches?: Under7Match[];
  evenOddMatches?: EvenOddMatch[];
  over2Matches?: Over2Match[];
  over2History?: Over2Match[];
  botMatches?: BotMatch[];
  botHistory?: BotMatch[];
  scanStatus?: string;
  scannedCount?: number;
}) {
  // Ring a beep whenever the set of matching markets changes (and is non-empty).
  const matchKey = scanMatches.map((m) => m.symbol).sort().join(",");
  const eoMatchKey = evenOddMatches.map((m) => `${m.symbol}:${m.side}`).sort().join(",");
  const o2MatchKey = over2Matches.map((m) => m.symbol).sort().join(",");
  const botMatchKey = botMatches.map((m) => m.symbol).sort().join(",");
  useAlertSound(matchKey ? `u7:${matchKey}` : "");
  useAlertSound(eoMatchKey ? `eo:${eoMatchKey}` : "");
  useAlertSound(o2MatchKey ? `o2:${o2MatchKey}` : "");
  useAlertSound(botMatchKey ? `bot:${botMatchKey}` : "");


  const m = marketIntel(ticks);
  const rf = riseFallStats(ticks);
  const eo = evenOddStats(ticks);
  const ou5 = overUnderStats(ticks, 5);
  const ou7 = overUnderStats(ticks, 7);

  const signals: { icon: any; title: string; desc: string; tone: string; conf: number; entry?: { contract: string; price: number; lastDigit: number; ticks: number; stakePct: number; payout: number } }[] = [];
  if (ou5.pUnder > 0.55 && ou5.anomaly >= 0.35 && ou5.anomaly <= 0.65 && m.manipulation < 0.15) {
    signals.push({
      icon: TrendingDown,
      title: "Under 5 Edge Detected",
      desc: `Under ${(ou5.pUnder*100).toFixed(1)}% · anomaly ${(ou5.anomaly*100).toFixed(0)}% · manipulation ${(m.manipulation*100).toFixed(0)}%. Clean statistical edge.`,
      tone: "bull",
      conf: Math.min(97, Math.round(ou5.pUnder * 100 + 25)),
    });
  }
  if (ou7.pUnder > 0.70 && m.manipulation < 0.20) {
    const total = Math.max(1, ticks.length);
    const p0 = ou7.freq[0] / total;
    const p1 = ou7.freq[1] / total;
    const p9 = ou7.freq[9] / total;
    if (p0 < 0.095 && p1 < 0.095 && p9 >= 0.105) {
      const lastTick = ticks[ticks.length - 1];
      const entryPrice = lastTick?.price ?? 0;
      const lastDigit = Math.abs(Math.round(entryPrice * 100)) % 10;
      const ticksWindow = 5;
      const stakePct = Math.min(5, Math.max(1, Math.round((ou7.pUnder - 0.70) * 100 / 2 + 1)));
      signals.push({
        icon: TrendingDown,
        title: "Under 7 Edge Detected",
        desc: `Under ${(ou7.pUnder*100).toFixed(1)}% · manipulation ${(m.manipulation*100).toFixed(0)}% · digit 0 ${(p0*100).toFixed(1)}% · digit 1 ${(p1*100).toFixed(1)}% · digit 9 ${(p9*100).toFixed(1)}%. Strong statistical edge.`,
        tone: "bull",
        conf: Math.min(98, Math.round(ou7.pUnder * 100 + 18)),
        entry: {
          contract: "DIGITUNDER 7",
          price: entryPrice,
          lastDigit,
          ticks: ticksWindow,
          stakePct,
          payout: 1.45,
        },
      });
    }
  }
  // ---- EVEN / ODD high-selectivity signal ----
  {
    const recent = ticks.slice(-30);
    if (recent.length >= 20) {
      const digits = recent.map((t) => Math.abs(Math.round(t.price * 100)) % 10);
      const evenCount = digits.filter((d) => d % 2 === 0).length;
      const pEvenRecent = evenCount / digits.length;
      const pOddRecent = 1 - pEvenRecent;
      // alternation rate (chop detector)
      let flips = 0;
      for (let i = 1; i < digits.length; i++) if ((digits[i] % 2) !== (digits[i - 1] % 2)) flips++;
      const altRate = flips / (digits.length - 1);
      // current same-parity streak
      let curStreak = 1;
      const lastPar = digits[digits.length - 1] % 2;
      for (let i = digits.length - 2; i >= 0; i--) {
        if ((digits[i] % 2) === lastPar) curStreak++; else break;
      }
      const stableMomentum = !rf.exhaustion && rf.volatility < 1.2 && Math.abs(rf.macd.hist) > 0;
      const lowNoise = m.manipulation < 0.20 && !m.reversalZone && altRate < 0.65 && curStreak < 5;
      const continuation = eo.continuation; // historical pattern probability
      const dominance = Math.max(pEvenRecent, pOddRecent);
      const side: "EVEN" | "ODD" | null =
        pEvenRecent >= 0.65 ? "EVEN" : pOddRecent >= 0.65 ? "ODD" : null;
      if (side && continuation >= 0.70 && lowNoise) {
        // count confirmations
        const confirms = [stableMomentum, lowNoise, continuation >= 0.72, dominance >= 0.68].filter(Boolean).length;
        const confidence = Math.round(dominance * 55 + continuation * 35 + (stableMomentum ? 8 : 0));
        if (confirms >= 2 && confidence >= 75) {
          const lastTick = ticks[ticks.length - 1];
          const entryPrice = lastTick?.price ?? 0;
          const lastD = Math.abs(Math.round(entryPrice * 100)) % 10;
          const risk: "LOW" | "MEDIUM" | "HIGH" =
            confidence >= 88 && rf.volatility < 0.8 ? "LOW"
            : confidence >= 80 ? "MEDIUM" : "HIGH";
          signals.push({
            icon: Dice5,
            title: `${side} Signal · ENTER`,
            desc: `Dominance ${(dominance*100).toFixed(0)}% · continuation ${(continuation*100).toFixed(0)}% · alt-rate ${(altRate*100).toFixed(0)}% · streak ${curStreak} · vol ${rf.volatility.toFixed(2)} · risk ${risk}. Anti-martingale only, max 2 recovery trades, ≤2% per trade.`,
            tone: "bull",
            conf: Math.min(97, confidence),
            entry: {
              contract: side === "EVEN" ? "DIGITEVEN" : "DIGITODD",
              price: entryPrice,
              lastDigit: lastD,
              ticks: 1,
              stakePct: 2,
              payout: 1.95,
            },
          });
        }
      }
    }
  }
  if (m.edgeScore > 55) signals.push({ icon: Target, title: "High-Probability Setup", desc: `Edge score ${m.edgeScore}/100 with aligned momentum.`, tone: "bull", conf: Math.min(98, m.edgeScore + 10) });
  if (m.reversalZone) signals.push({ icon: AlertTriangle, title: "Reversal Zone Active", desc: `RSI ${rf.rsi.toFixed(0)} + ${eo.streak}-streak ${eo.streakType}. Counter-trend opportunity.`, tone: "bear", conf: 78 });
  if (rf.acceleration) signals.push({ icon: Activity, title: "Momentum Acceleration", desc: `MACD histogram expanding ${rf.macd.hist > 0 ? "bullish" : "bearish"}.`, tone: rf.macd.hist > 0 ? "bull" : "bear", conf: 71 });
  if (eo.streak >= 5) signals.push({ icon: Sparkles, title: `${eo.streakType.toUpperCase()} Cluster`, desc: `${eo.streak} consecutive ${eo.streakType}. Continuation ${(eo.continuation*100).toFixed(0)}%.`, tone: "warn", conf: Math.round(eo.continuation*100) });
  if (m.manipulation > 0.5) signals.push({ icon: AlertTriangle, title: "Anomalous Distribution", desc: "Digit frequency deviating from uniform — possible smart-money flow.", tone: "warn", conf: Math.round(m.manipulation * 100) });
  if (!signals.length) signals.push({ icon: Activity, title: "Market Neutral", desc: "No high-conviction setups. Stand aside.", tone: "neon", conf: 50 });

  return (
    <Panel title="AI Signal Feed" subtitle="Real-time edge detection" accent="cyan">
      <div className="mb-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/8 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <Radar size={14} className={scanStatus === "live" ? "pulse-dot" : ""} />
            <span className="text-xs font-semibold uppercase tracking-wider">Under 7 · Multi-Market Scanner</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider opacity-70 flex items-center gap-1">
            <Volume2 size={11} /> {scanStatus ?? "idle"} · {scannedCount} markets
          </span>
        </div>
        {scanMatches.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-foreground/60">No volatility currently meets all Under 7 conditions. Scanning…</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {scanMatches.map((m) => (
              <li key={m.symbol} className="rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/8 px-2.5 py-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--bull)]">{m.name}</span>
                  <span className="tabular text-[10px] opacity-80">{m.conf}% conf · stake {m.stakePct}%</span>
                </div>
                <div className="mt-0.5 grid grid-cols-2 gap-x-3 text-[10px] tabular text-foreground/75">
                  <span>Under {(m.pUnder*100).toFixed(1)}%</span>
                  <span>Manip {(m.manipulation*100).toFixed(0)}%</span>
                  <span>d0 {(m.p0*100).toFixed(1)}% · d1 {(m.p1*100).toFixed(1)}%</span>
                  <span>d9 {(m.p9*100).toFixed(1)}%</span>
                  <span>Entry {m.entryPrice.toFixed(4)}</span>
                  <span>Last digit {m.lastDigit}</span>
                </div>
                <ManipGate manipulation={m.manipulation} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mb-3 rounded-lg border border-[var(--neon)]/40 bg-[var(--neon)]/8 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--neon)]">
            <Dice5 size={14} className={scanStatus === "live" ? "pulse-dot" : ""} />
            <span className="text-xs font-semibold uppercase tracking-wider">Even / Odd · Multi-Market Scanner</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider opacity-70 flex items-center gap-1">
            <Volume2 size={11} /> {scanStatus ?? "idle"} · trend + reversal · 50↔200 weight
          </span>
        </div>
        {evenOddMatches.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-foreground/60">No volatility currently meets EVEN/ODD conditions. Scanning…</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {evenOddMatches.map((m) => (
              <li key={m.symbol} className={`rounded-md border px-2.5 py-1.5 ${m.side === "EVEN" ? "border-[var(--neon)]/40 bg-[var(--neon)]/8" : "border-[var(--accent)]/40 bg-[var(--accent)]/8"}`}>
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-semibold ${m.side === "EVEN" ? "text-[var(--neon)]" : "text-[var(--accent)]"}`}>
                    {m.name} · {m.side}
                    <span className={`ml-1.5 text-[9px] uppercase tracking-wider px-1 py-0.5 rounded ${m.mode === "REVERSAL" ? "bg-[var(--bear)]/20 text-[var(--bear)]" : "bg-[var(--bull)]/20 text-[var(--bull)]"}`}>{m.mode}</span>
                  </span>
                  <span className="tabular text-[10px] opacity-80">{m.conf}% conf</span>
                </div>
                <div className="mt-0.5 grid grid-cols-2 gap-x-3 text-[10px] tabular text-foreground/75">
                  <span>Ev50 {(m.ev50*100).toFixed(0)}% · Ev200 {(m.ev200*100).toFixed(0)}%</span>
                  <span>Shift {m.shift >= 0 ? "+" : ""}{(m.shift*100).toFixed(1)}%</span>
                  <span>Continuation {(m.continuation*100).toFixed(0)}%</span>
                  <span>Alt-rate {(m.altRate*100).toFixed(0)}%</span>
                  <span>Streak {m.streak} · manip {(m.manipulation*100).toFixed(0)}%</span>
                  <span>Entry {m.entryPrice.toFixed(4)} · d{m.lastDigit}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* OVER 2 Strategy Scanner */}
      <div className="mb-3 rounded-lg border border-[var(--bull)]/40 bg-[var(--bull)]/8 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--bull)]">
            <TrendingUp size={14} className={scanStatus === "live" ? "pulse-dot" : ""} />
            <span className="text-xs font-semibold uppercase tracking-wider">Over 2 · Strategy Scanner</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider opacity-70 flex items-center gap-1">
            <Volume2 size={11} /> {scanStatus ?? "idle"} · d0&gt;11.5% · d7-9&lt;10% · manip&lt;20%
          </span>
        </div>

        {/* Live meters from top match */}
        {over2Matches.length > 0 && (() => {
          const top = [...over2Matches].sort((a, b) => b.conf - a.conf)[0];
          return (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-[var(--bull)]/30 bg-[var(--bull)]/5 px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider opacity-70">Top Confidence</div>
                <div className="mt-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                  <div className="h-full bg-[var(--bull)]" style={{ width: `${top.conf}%` }} />
                </div>
                <div className="mt-0.5 text-[10px] tabular">{top.name} · {top.conf}%</div>
              </div>
              <div className="rounded-md border border-[var(--warn)]/30 bg-[var(--warn)]/5 px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-wider opacity-70">Manipulation</div>
                <div className="mt-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                  <div className="h-full bg-[var(--warn)]" style={{ width: `${Math.min(100, top.manipulation * 500)}%` }} />
                </div>
                <div className="mt-0.5 text-[10px] tabular">{(top.manipulation * 100).toFixed(1)}% (cap 20%)</div>
              </div>
            </div>
          );
        })()}

        {over2Matches.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-foreground/60">No volatility currently meets Over 2 conditions. Scanning…</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {over2Matches.map((m) => {
              const maxF = Math.max(...m.freq, 1);
              return (
                <li key={m.symbol} className="rounded-md border border-[var(--bull)]/40 bg-[var(--bull)]/8 px-2.5 py-1.5 anim-pop">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[var(--bull)]">{m.name} · OVER 2</span>
                    <span className="tabular text-[10px] opacity-80">{m.conf}% conf · {new Date(m.ts).toLocaleTimeString()}</span>
                  </div>
                  <div className="mt-0.5 grid grid-cols-2 gap-x-3 text-[10px] tabular text-foreground/75">
                    <span>Over 2 {(m.pOver*100).toFixed(1)}%</span>
                    <span>Manip {(m.manipulation*100).toFixed(1)}%</span>
                    <span>d0 {(m.p0*100).toFixed(1)}%</span>
                    <span>d7 {(m.p7*100).toFixed(1)}% · d8 {(m.p8*100).toFixed(1)}% · d9 {(m.p9*100).toFixed(1)}%</span>
                    <span>Entry {m.entryPrice.toFixed(4)}</span>
                    <span>Last digit {m.lastDigit}</span>
                  </div>
                  {/* digit distribution snapshot */}
                  <div className="mt-1.5 grid grid-cols-10 gap-0.5">
                    {m.freq.map((f, d) => (
                      <div key={d} className="text-center">
                        <div className="h-6 flex items-end justify-center">
                          <div
                            className={`w-full rounded-sm ${d <= 2 ? "bg-[var(--bull)]/70" : d >= 7 ? "bg-[var(--bear)]/60" : "bg-foreground/20"}`}
                            style={{ height: `${(f / maxF) * 100}%` }}
                          />
                        </div>
                        <div className="text-[8px] tabular opacity-70">{d}</div>
                      </div>
                    ))}
                  </div>
                  <ManipGate manipulation={m.manipulation} />
                </li>
              );
            })}
          </ul>
        )}

        {/* Recent Over 2 signal history */}
        {over2History.length > 0 && (
          <div className="mt-2 border-t border-[var(--bull)]/20 pt-2">
            <div className="text-[9px] uppercase tracking-wider opacity-60 mb-1">Recent signal history</div>
            <ul className="space-y-0.5 max-h-24 overflow-y-auto">
              {over2History.slice(0, 8).map((h, i) => (
                <li key={`${h.symbol}-${h.ts}-${i}`} className="flex items-center justify-between text-[10px] tabular opacity-80">
                  <span>{new Date(h.ts).toLocaleTimeString()} · {h.name}</span>
                  <span className="text-[var(--bull)]">OVER 2 · {h.conf}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* DBOT: Over 2 + Under 7 Combined Scanner */}
      <div className="mb-3 rounded-lg border-2 border-[var(--warn)]/50 bg-[var(--warn)]/8 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[var(--warn)]">
            <Bot size={14} className={scanStatus === "live" ? "pulse-dot" : ""} />
            <span className="text-xs font-semibold uppercase tracking-wider">DBot · Over 2 + Under 7 Combined</span>
          </div>
          <span className="text-[10px] uppercase tracking-wider opacity-70 flex items-center gap-1">
            <Volume2 size={11} /> both edges aligned · manip&lt;20%
          </span>
        </div>
        {botMatches.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-foreground/60">No market currently satisfies BOTH Over 2 and Under 7 simultaneously. Scanning…</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {botMatches.map((b) => (
              <li key={b.symbol} className="rounded-md border border-[var(--warn)]/50 bg-[var(--warn)]/10 px-2.5 py-1.5 anim-pop">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--warn)]">{b.name} · OVER 2 + UNDER 7</span>
                  <span className="tabular text-[10px] opacity-80">{b.conf}% conf · {new Date(b.ts).toLocaleTimeString()}</span>
                </div>
                <div className="mt-0.5 grid grid-cols-2 gap-x-3 text-[10px] tabular text-foreground/80">
                  <span>Over 2 {(b.pOver2*100).toFixed(1)}%</span>
                  <span>Under 7 {(b.pUnder7*100).toFixed(1)}%</span>
                  <span>Manip {(b.manipulation*100).toFixed(1)}%</span>
                  <span>d0 {(b.p0*100).toFixed(1)}% · d1 {(b.p1*100).toFixed(1)}%</span>
                  <span>d7 {(b.p7*100).toFixed(1)}% · d8 {(b.p8*100).toFixed(1)}% · d9 {(b.p9*100).toFixed(1)}%</span>
                  <span>Entry {b.entryPrice.toFixed(4)} · d{b.lastDigit}</span>
                </div>
                <ManipGate manipulation={b.manipulation} />
              </li>
            ))}
          </ul>
        )}
        {botHistory.length > 0 && (
          <div className="mt-2 border-t border-[var(--warn)]/20 pt-2">
            <div className="text-[9px] uppercase tracking-wider opacity-60 mb-1">Recent bot signals</div>
            <ul className="space-y-0.5 max-h-24 overflow-y-auto">
              {botHistory.slice(0, 8).map((h, i) => (
                <li key={`${h.symbol}-${h.ts}-${i}`} className="flex items-center justify-between text-[10px] tabular opacity-80">
                  <span>{new Date(h.ts).toLocaleTimeString()} · {h.name}</span>
                  <span className="text-[var(--warn)]">O2+U7 · {h.conf}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ul className="space-y-2">



        {signals.map((s, i) => {
          const Icon = s.icon;
          const color = s.tone === "bull" ? "text-[var(--bull)] border-[var(--bull)]/40 bg-[var(--bull)]/8"
            : s.tone === "bear" ? "text-[var(--bear)] border-[var(--bear)]/40 bg-[var(--bear)]/8"
            : s.tone === "warn" ? "text-[var(--warn)] border-[var(--warn)]/40 bg-[var(--warn)]/8"
            : "text-[var(--neon)] border-[var(--neon)]/40 bg-[var(--neon)]/8";
          return (
            <li key={i} className={`rounded-lg border px-3 py-2.5 ${color}`}>
              <div className="flex items-start gap-3">
                <Icon size={16} className="mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold">{s.title}</span>
                    <span className="text-[10px] uppercase tracking-wider tabular opacity-80">{s.conf}% conf</span>
                  </div>
                  <p className="text-xs text-foreground/70 mt-0.5">{s.desc}</p>
                  {s.entry && (
                    <div className="mt-2 rounded-md border border-[var(--bull)]/30 bg-[var(--bull)]/5 p-2">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold opacity-90">
                        <Crosshair size={11} /> Entry Point Confirmed
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] tabular">
                        <div className="flex justify-between"><span className="opacity-70">Contract</span><span className="font-semibold">{s.entry.contract}</span></div>
                        <div className="flex justify-between"><span className="opacity-70">Duration</span><span className="font-semibold">{s.entry.ticks} ticks</span></div>
                        <div className="flex justify-between"><span className="opacity-70">Entry</span><span className="font-semibold">{s.entry.price.toFixed(4)}</span></div>
                        <div className="flex justify-between"><span className="opacity-70">Last digit</span><span className="font-semibold">{s.entry.lastDigit}</span></div>
                        <div className="flex justify-between"><span className="opacity-70">Stake</span><span className="font-semibold">{s.entry.stakePct}% bal</span></div>
                        <div className="flex justify-between"><span className="opacity-70">Payout</span><span className="font-semibold">×{s.entry.payout.toFixed(2)}</span></div>
                      </div>
                      <p className="mt-1.5 text-[10px] opacity-75">Enter NOW on next tick · exit after {s.entry.ticks} ticks · abort if a digit ≥ 7 prints.</p>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
