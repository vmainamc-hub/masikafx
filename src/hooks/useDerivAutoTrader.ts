// Deriv auto-trader for over/under signals.
// - Connects to Deriv WS, authorizes with user-supplied API token
// - Places ONE trade per unique signal id; prevents overlapping trade per symbol
// - Supports DIGITOVER / DIGITUNDER contracts only
//
// Signals can come from any scanner; caller normalizes them into AutoSignal.

import { useEffect, useRef, useState } from "react";

const APP_ID = 1089;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

export type AutoSignalType = "OVER2" | "UNDER7" | "OVER5" | "UNDER4";

export type AutoSignal = {
  id: string;          // stable unique id per signal emission
  symbol: string;      // deriv symbol
  type: AutoSignalType;
  conf?: number;
};

export type TradeLogEntry = {
  id: string;
  ts: number;
  symbol: string;
  type: AutoSignalType;
  stake: number;
  status: "PENDING" | "OPEN" | "WON" | "LOST" | "ERROR";
  contractId?: number;
  buyPrice?: number;
  payout?: number;
  profit?: number;
  error?: string;
};

type Options = {
  enabled: boolean;
  token: string;
  stake: number;       // USD
  durationTicks: number;
  signals: AutoSignal[];
};

const CONTRACT_MAP: Record<AutoSignalType, { contract_type: "DIGITOVER" | "DIGITUNDER"; barrier: string }> = {
  OVER2:  { contract_type: "DIGITOVER",  barrier: "2" },
  UNDER7: { contract_type: "DIGITUNDER", barrier: "7" },
  OVER5:  { contract_type: "DIGITOVER",  barrier: "5" },
  UNDER4: { contract_type: "DIGITUNDER", barrier: "4" },
};

const formatDerivError = (err: any) => {
  const code = err?.code ? `${err.code}: ` : "";
  const message = err?.message || "Deriv request failed";
  return `${code}${message}`;
};

export function useDerivAutoTrader({ enabled, token, stake, durationTicks, signals }: Options) {
  const [status, setStatus] = useState<"idle" | "connecting" | "authorizing" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<{ amount: number; currency: string; loginid?: string; isVirtual?: boolean } | null>(null);
  const [log, setLog] = useState<TradeLogEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reqIdRef = useRef(1);
  const pendingReqs = useRef<Map<number, (msg: any) => void>>(new Map());
  const placedSignalIds = useRef<Set<string>>(new Set());
  const openBySymbol = useRef<Set<string>>(new Set());
  const contractToLog = useRef<Map<number, string>>(new Map()); // contractId -> log id
  const reqToLog = useRef<Map<number, string>>(new Map());      // buy req_id -> log id

  // Stable refs for the latest values used inside the persistent WS handler
  const stakeRef = useRef(stake);
  const durRef = useRef(durationTicks);
  useEffect(() => { stakeRef.current = stake; }, [stake]);
  useEffect(() => { durRef.current = durationTicks; }, [durationTicks]);

  const send = (payload: any, onReply?: (msg: any) => void) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const req_id = reqIdRef.current++;
    if (onReply) pendingReqs.current.set(req_id, onReply);
    ws.send(JSON.stringify({ ...payload, req_id }));
    return req_id;
  };

  const appendLog = (entry: TradeLogEntry) => setLog((prev) => [entry, ...prev].slice(0, 100));
  const updateLog = (id: string, patch: Partial<TradeLogEntry>) =>
    setLog((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  // Connect / auth lifecycle
  useEffect(() => {
    const cleanToken = token.trim();
    if (!enabled || !cleanToken) {
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      setStatus("idle");
      setError(null);
      return;
    }

    setStatus("connecting");
    setError(null);
    let ws: WebSocket;
    try { ws = new WebSocket(WS_URL); } catch (e: any) {
      setStatus("error");
      setError(e?.message ?? "ws init failed");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("authorizing");
      send({ authorize: cleanToken }, (msg) => {
        if (msg.error) {
          setStatus("error");
          setError(formatDerivError(msg.error));
          return;
        }
        const auth = msg.authorize;
        setBalance({
          amount: Number(auth.balance),
          currency: auth.currency,
          loginid: auth.loginid,
          isVirtual: !!auth.is_virtual,
        });
        setStatus("ready");
        // subscribe to balance + open contracts
        send({ balance: 1, subscribe: 1 });
        send({ proposal_open_contract: 1, subscribe: 1 });
      });
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }

      // Resolve any specific request callback first
      if (msg.req_id && pendingReqs.current.has(msg.req_id)) {
        const cb = pendingReqs.current.get(msg.req_id)!;
        pendingReqs.current.delete(msg.req_id);
        cb(msg);
      }

      // Balance subscription
      if (msg.msg_type === "balance" && msg.balance) {
        setBalance((prev) => ({
          amount: Number(msg.balance.balance),
          currency: msg.balance.currency,
          loginid: prev?.loginid,
          isVirtual: prev?.isVirtual,
        }));
      }

      // Buy response (also captured via req_id callback below in placeTrade,
      // but mirror here in case ordering differs)
      if (msg.msg_type === "buy" && msg.buy) {
        const logId = msg.req_id ? reqToLog.current.get(msg.req_id) : undefined;
        if (logId) {
          updateLog(logId, {
            status: "OPEN",
            contractId: msg.buy.contract_id,
            buyPrice: Number(msg.buy.buy_price),
            payout: Number(msg.buy.payout),
          });
          contractToLog.current.set(msg.buy.contract_id, logId);
          reqToLog.current.delete(msg.req_id);
        }
      }

      // Contract settlement
      if (msg.msg_type === "proposal_open_contract" && msg.proposal_open_contract) {
        const c = msg.proposal_open_contract;
        const logId = contractToLog.current.get(c.contract_id);
        if (c.is_sold && logId) {
          const profit = Number(c.profit);
          updateLog(logId, {
            status: profit > 0 ? "WON" : "LOST",
            profit,
          });
          // free up the symbol slot
          openBySymbol.current.delete(c.underlying);
          contractToLog.current.delete(c.contract_id);
        }
      }

      if (msg.error && !msg.req_id) {
        // ambient error
        setError(formatDerivError(msg.error));
      }
    };

    ws.onerror = () => { setStatus("error"); setError("ws error"); };
    ws.onclose = () => {
      if (wsRef.current === ws) {
        wsRef.current = null;
        setStatus((s) => (s === "error" ? s : "idle"));
      }
    };

    return () => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ forget_all: ["balance", "proposal_open_contract"] }));
        ws.close();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token]);

  // Reset placed-signal tracking when toggled off so the next session can trade again
  useEffect(() => {
    if (!enabled) {
      placedSignalIds.current.clear();
      openBySymbol.current.clear();
      contractToLog.current.clear();
      reqToLog.current.clear();
    }
  }, [enabled]);

  // React to incoming signals -> place trades
  useEffect(() => {
    if (status !== "ready") return;
    for (const sig of signals) {
      if (placedSignalIds.current.has(sig.id)) continue;
      if (openBySymbol.current.has(sig.symbol)) continue; // one trade per symbol at a time
      placedSignalIds.current.add(sig.symbol + ":init"); // noop marker, real id below
      placedSignalIds.current.add(sig.id);
      openBySymbol.current.add(sig.symbol);
      placeTrade(sig);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, status]);

  const placeTrade = (sig: AutoSignal) => {
    const map = CONTRACT_MAP[sig.type];
    const logId = `${sig.id}-${Date.now()}`;
    appendLog({
      id: logId,
      ts: Date.now(),
      symbol: sig.symbol,
      type: sig.type,
      stake: stakeRef.current,
      status: "PENDING",
    });

    const reqId = send(
      {
        buy: 1,
        price: stakeRef.current,
        parameters: {
          amount: stakeRef.current,
          basis: "stake",
          contract_type: map.contract_type,
          currency: balance?.currency || "USD",
          duration: durRef.current,
          duration_unit: "t",
          symbol: sig.symbol,
          barrier: map.barrier,
        },
      },
      (msg) => {
        if (msg.error) {
          updateLog(logId, { status: "ERROR", error: formatDerivError(msg.error) });
          openBySymbol.current.delete(sig.symbol);
          return;
        }
        if (msg.buy) {
          updateLog(logId, {
            status: "OPEN",
            contractId: msg.buy.contract_id,
            buyPrice: Number(msg.buy.buy_price),
            payout: Number(msg.buy.payout),
          });
          contractToLog.current.set(msg.buy.contract_id, logId);
        }
      }
    );
    if (reqId !== undefined) reqToLog.current.set(reqId, logId);
  };

  const stats = log.reduce(
    (acc, e) => {
      if (e.status === "WON") { acc.wins++; acc.profit += e.profit ?? 0; }
      else if (e.status === "LOST") { acc.losses++; acc.profit += e.profit ?? 0; }
      else if (e.status === "OPEN" || e.status === "PENDING") { acc.open++; }
      return acc;
    },
    { wins: 0, losses: 0, open: 0, profit: 0 }
  );

  return { status, error, balance, log, stats };
}
