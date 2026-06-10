import { useEffect, useMemo, useState } from "react";
import { Panel } from "../Panel";
import { Bot, KeyRound, Power, Wallet, ShieldAlert, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useDerivAutoTrader, type AutoSignal } from "@/hooks/useDerivAutoTrader";

const TOKEN_KEY = "deriv_api_token_v1";

type Props = {
  signals: AutoSignal[];
};

export function DerivAutoTraderPanel({ signals }: Props) {
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [stake, setStake] = useState(2);
  const [duration, setDuration] = useState(1); // ticks
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
    if (saved) setToken(saved);
  }, []);

  const saveToken = (t: string) => {
    setToken(t);
    if (typeof window !== "undefined") {
      if (t) window.localStorage.setItem(TOKEN_KEY, t);
      else window.localStorage.removeItem(TOKEN_KEY);
    }
  };

  // De-dupe signals by id (a signal can appear across re-renders)
  const stableSignals = useMemo(() => {
    const map = new Map<string, AutoSignal>();
    for (const s of signals) if (!map.has(s.id)) map.set(s.id, s);
    return Array.from(map.values());
  }, [signals]);

  const { status, error, balance, log, stats } = useDerivAutoTrader({
    enabled: enabled && !!token,
    token,
    stake,
    durationTicks: duration,
    signals: stableSignals,
  });

  const isReady = status === "ready";
  const live = balance && !balance.isVirtual;

  return (
    <Panel
      title="Deriv Auto-Trader"
      subtitle="Single trade per over/under signal · DIGITOVER/DIGITUNDER"
      accent="cyan"
    >
      {/* Token + controls */}
      <div className="space-y-2.5">
        <div>
          <label className="text-[10px] uppercase tracking-wider opacity-70 flex items-center gap-1">
            <KeyRound size={11} /> Deriv API token (Trade scope) · stored only in this browser
          </label>
          <div className="mt-1 flex gap-1.5">
            <input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => saveToken(e.target.value)}
              placeholder="paste token from app.deriv.com → Settings → API token"
              className="flex-1 h-8 px-2 rounded-md bg-secondary/40 border border-border/60 text-[11px] tabular focus:outline-none focus:border-[var(--neon)]"
            />
            <button
              onClick={() => setShowToken((s) => !s)}
              className="h-8 px-2 rounded-md bg-secondary border border-border/60 text-[10px] uppercase"
            >
              {showToken ? "hide" : "show"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider opacity-70">Stake (USD)</label>
            <input
              type="number" min={0.35} step={0.5} value={stake}
              onChange={(e) => setStake(Math.max(0.35, Number(e.target.value) || 0))}
              className="w-full mt-1 h-8 px-2 rounded-md bg-secondary/40 border border-border/60 text-[11px] tabular"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider opacity-70">Duration (ticks)</label>
            <input
              type="number" min={1} max={10} step={1} value={duration}
              onChange={(e) => setDuration(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
              className="w-full mt-1 h-8 px-2 rounded-md bg-secondary/40 border border-border/60 text-[11px] tabular"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setEnabled((e) => !e)}
              disabled={!token}
              className={`w-full h-8 rounded-md text-[11px] uppercase tracking-wider flex items-center justify-center gap-1.5 border ${
                enabled
                  ? "bg-[var(--bear)]/15 text-[var(--bear)] border-[var(--bear)]/40"
                  : "bg-[var(--bull)]/15 text-[var(--bull)] border-[var(--bull)]/40"
              } disabled:opacity-40`}
            >
              <Power size={12} /> {enabled ? "Stop" : "Start"}
            </button>
          </div>
        </div>

        {/* Status bar */}
        <div className="rounded-md border border-border/40 bg-secondary/30 px-2.5 py-2 flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2">
            <Bot size={12} className={isReady ? "text-[var(--bull)] pulse-dot" : "opacity-60"} />
            <span className="uppercase tracking-wider opacity-80">{status}</span>
            {balance && (
              <span className="flex items-center gap-1 ml-2">
                <Wallet size={11} className="opacity-60" />
                <span className="tabular">{balance.amount.toFixed(2)} {balance.currency}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] ${balance.isVirtual ? "bg-[var(--bull)]/15 text-[var(--bull)]" : "bg-[var(--warn)]/20 text-[var(--warn)]"}`}>
                  {balance.isVirtual ? "DEMO" : "REAL"}
                </span>
                {balance.loginid && <span className="opacity-60">· {balance.loginid}</span>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 tabular">
            <span className="text-[var(--bull)]">{stats.wins}W</span>
            <span className="text-[var(--bear)]">{stats.losses}L</span>
            <span className="opacity-70">{stats.open} open</span>
            <span className={stats.profit >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"}>
              {stats.profit >= 0 ? "+" : ""}{stats.profit.toFixed(2)}
            </span>
          </div>
        </div>

        {live && (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--warn)]">
            <ShieldAlert size={11}/> Token is for a REAL account. Trades will use real funds.
          </div>
        )}
        {error && (
          <div className="text-[10px] text-[var(--bear)]">⚠ {error}</div>
        )}
      </div>

      {/* Trade log */}
      <div className="mt-3 border-t border-border/40 pt-2">
        <div className="text-[9px] uppercase tracking-wider opacity-60 mb-1 flex items-center justify-between">
          <span>Trade log · 1 trade per signal</span>
          <span className="tabular">{log.length}</span>
        </div>
        {log.length === 0 ? (
          <p className="text-[11px] opacity-60 px-1 py-2">No trades placed yet. Start the trader and wait for a qualifying signal.</p>
        ) : (
          <ul className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
            {log.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-[10px] tabular border border-border/30 bg-secondary/20 rounded px-1.5 py-1">
                <span className="flex items-center gap-1.5">
                  {e.status === "WON" && <CheckCircle2 size={11} className="text-[var(--bull)]"/>}
                  {e.status === "LOST" && <XCircle size={11} className="text-[var(--bear)]"/>}
                  {(e.status === "OPEN" || e.status === "PENDING") && <Clock size={11} className="opacity-60"/>}
                  {e.status === "ERROR" && <ShieldAlert size={11} className="text-[var(--warn)]"/>}
                  <span>{new Date(e.ts).toLocaleTimeString()}</span>
                  <span className="opacity-70">{e.symbol}</span>
                  <span className="px-1 py-0.5 rounded bg-foreground/10">{e.type}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="opacity-70">${e.stake.toFixed(2)}</span>
                  <span className={
                    e.status === "WON" ? "text-[var(--bull)]"
                    : e.status === "LOST" ? "text-[var(--bear)]"
                    : e.status === "ERROR" ? "text-[var(--warn)]"
                    : "opacity-70"
                  }>
                    {e.status === "ERROR" ? (e.error?.slice(0, 28) ?? "error") :
                     e.profit != null ? `${e.profit >= 0 ? "+" : ""}${e.profit.toFixed(2)}` :
                     e.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-2 text-[9px] opacity-60 leading-relaxed">
        Token is stored only in your browser's localStorage and sent directly to wss://ws.derivws.com.
        Trade contracts: OVER 2 → DIGITOVER 2 · UNDER 7 → DIGITUNDER 7 · OVER 5 → DIGITOVER 5 · UNDER 4 → DIGITUNDER 4.
        Digit contracts use tick durations; "1 second" ≈ 1 tick on Volatility 1s indices.
      </p>
    </Panel>
  );
}
