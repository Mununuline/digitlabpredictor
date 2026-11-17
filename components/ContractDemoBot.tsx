"use client";

import { useEffect, useRef, useState } from "react";
import type { ContractScan, DigitContractType } from "@/lib/contract-ai";
import type { TickPoint } from "@/lib/digits";

type DemoAccount = { accountId: string; accountType: "demo"; currency: string; balance: number; status: string };
type Props = { contract: DigitContractType; symbol: string; scan: ContractScan; latestTick: TickPoint | null };\ntype DerivTradeMessage = { error?: { message?: string }; req_id?: number; msg_type?: string; balance?: { balance: number | string; currency?: string }; proposal?: { ask_price: number | string; payout: number | string; id: string }; buy?: { contract_id: string | number }; proposal_open_contract?: { contract_id: string | number; is_sold?: boolean; status?: string; profit?: number | string } };

const CONTRACT_CODE: Record<DigitContractType, string> = {
  MATCHES: "DIGITMATCH", DIFFERS: "DIGITDIFF", EVEN: "DIGITEVEN",
  ODD: "DIGITODD", OVER: "DIGITOVER", UNDER: "DIGITUNDER",
};

export default function ContractDemoBot({ contract, symbol, scan, latestTick }: Props) {
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [oauthConnected, setOauthConnected] = useState(false);
  const [connected, setConnected] = useState(false);
  const [armed, setArmed] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [stake, setStake] = useState("0.35");
  const [status, setStatus] = useState("DISARMED · DEMO ONLY");
  const [message, setMessage] = useState("Connect a Deriv demo account. Real accounts are blocked.");
  const [openTrade, setOpenTrade] = useState("");
  const [dailyPnl, setDailyPnl] = useState(0);
  const [trades, setTrades] = useState(0);
  const [lossStreak, setLossStreak] = useState(0);
  const [lastResult, setLastResult] = useState("NONE");
  const socketRef = useRef<WebSocket | null>(null);
  const armedRef = useRef(false);
  const balanceRef = useRef<number | null>(null);
  const openRef = useRef("");
  const pendingRef = useRef(false);
  const lastTickRef = useRef("");
  const contextRef = useRef<{ barrier: number | null; lower: number; samples: number; symbol: string; qualified: boolean } | null>(null);
  const pnlRef = useRef(0);
  const tradesRef = useRef(0);
  const lossesRef = useRef(0);
  const stakeRef = useRef(Number(stake));
  const currencyRef = useRef(currency);
  const dayRef = useRef(new Date().toISOString().slice(0, 10));

  useEffect(() => { stakeRef.current = Number(stake); }, [stake]);
  useEffect(() => { currencyRef.current = currency; }, [currency]);
  useEffect(() => { balanceRef.current = balance; }, [balance]);
  useEffect(() => { armedRef.current = armed; }, [armed]);

  const loadAccounts = async () => {
    try {
      const response = await fetch("/api/deriv/session", { cache: "no-store" });
      const data = await response.json();
      setOauthConnected(Boolean(data.connected));
      const demo = (data.accounts || []) as DemoAccount[];
      setAccounts(demo);
      if (demo.length && !accountId) setAccountId(demo[0].accountId);
      setMessage(demo.length ? "Demo account available. Select it and connect the demo trading socket." : data.connected ? "No demo account returned. Real accounts are intentionally excluded." : "Deriv is not connected yet. Sign in to load demo accounts.");
    } catch { setMessage("Could not check the Deriv session."); }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("digitlab-contract-risk-v1:" + contract);
      const today = new Date().toISOString().slice(0, 10);
      if (raw) {
        const saved = JSON.parse(raw) as { day?: string; pnl?: number; trades?: number; losses?: number };
        if (saved.day === today) {
          pnlRef.current = Number(saved.pnl) || 0; tradesRef.current = Number(saved.trades) || 0; lossesRef.current = Number(saved.losses) || 0;
          setDailyPnl(pnlRef.current); setTrades(tradesRef.current); setLossStreak(lossesRef.current);
        } else localStorage.setItem("digitlab-contract-risk-v1:" + contract, JSON.stringify({ day: today, pnl: 0, trades: 0, losses: 0 }));
      }
      dayRef.current = today;
    } catch { setMessage("Risk history could not be read. Bot remains subject to current-session safeguards."); }
  }, [contract]);

  useEffect(() => {
    void loadAccounts();
    const timer = window.setInterval(() => { void loadAccounts(); }, 8000);
    return () => window.clearInterval(timer);
  }, []);

  const connectDemo = async () => {
    try {
      if (!accountId) throw new Error("Select a verified demo account first.");
      setStatus("AUTHENTICATING DEMO");
      const response = await fetch("/api/deriv/otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId }) });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || "Could not open demo connection.");
      const url = new URL(data.url);
      if (url.pathname !== "/trading/v1/options/ws/demo") throw new Error("Safety check blocked a non-demo trading endpoint.");
      const socket = new WebSocket(data.url);
      socketRef.current = socket;
      socket.onopen = () => {
        setConnected(true);
        setStatus("CONNECTED · DISARMED");
        setMessage("Demo trading connection is ready. The bot will not trade until you explicitly arm it.");
        socket.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: 801 }));
      };
      socket.onmessage = (event) => {
        let data: DerivTradeMessage;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.error) {
          pendingRef.current = false;
          contextRef.current = null;
          setMessage(data.error.message || "Deriv returned a trading error.");
          if (data.req_id === 801) setStatus("DEMO CONNECTION ERROR");
          return;
        }
        if (data.msg_type === "balance" && data.balance) {
          const amount = Number(data.balance.balance);
          if (Number.isFinite(amount)) { setBalance(amount); balanceRef.current = amount; }
          if (data.balance.currency) { setCurrency(data.balance.currency); currencyRef.current = data.balance.currency; }
        }
        if (data.msg_type === "proposal" && data.proposal) {
          pendingRef.current = false;
          const ctx = contextRef.current;
          contextRef.current = null;
          if (!ctx || !armedRef.current || openRef.current) return;
          const ask = Number(data.proposal.ask_price);
          const payout = Number(data.proposal.payout);
          const probability = ctx.lower / 100;
          const breakEven = payout > 0 ? ask / payout : 1;
          const ev = probability * payout - ask;
          const currentBalance = balanceRef.current;
          const currentStake = stakeRef.current;
          const riskCap = currentBalance === null ? 0 : currentBalance * 0.005;
          const allowed = ctx.qualified && ctx.samples >= 100
            && probability > breakEven && ev > 0 && ask > 0 && payout > ask
            && currentStake > 0 && currentStake <= riskCap
            && pnlRef.current > -5 && lossesRef.current < 3 && tradesRef.current < 8;
          setMessage("Proposal check: conservative win estimate " + (probability * 100).toFixed(1) + "% · break-even " + (breakEven * 100).toFixed(1) + "% · expected value " + ev.toFixed(3) + " " + currencyRef.current + ".");
          if (!allowed) { setStatus("WAIT · EDGE / RISK GATE"); return; }
          setStatus("SUBMITTING DEMO CONTRACT");
          pendingRef.current = true;
          socket.send(JSON.stringify({ buy: data.proposal.id, price: ask, req_id: 802 }));
        }
        if (data.msg_type === "buy" && data.buy) {
          pendingRef.current = false;
          const id = String(data.buy.contract_id);
          openRef.current = id;
          setOpenTrade(id);
          tradesRef.current += 1;
          setTrades(tradesRef.current);
          setStatus("DEMO TRADE OPEN");
          setLastResult("OPEN · #" + id);
          socket.send(JSON.stringify({ proposal_open_contract: 1, contract_id: Number(id), subscribe: 1, req_id: 803 }));
        }
        if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract) {
          const c = data.proposal_open_contract;
          const id = String(c.contract_id || "");
          if (id && id === openRef.current && (c.is_sold || c.status === "won" || c.status === "lost" || c.status === "sold")) {
            const profit = Number(c.profit) || 0;
            pnlRef.current += profit;
            setDailyPnl(pnlRef.current);
            if (profit > 0) lossesRef.current = 0; else lossesRef.current += 1;
            setLossStreak(lossesRef.current);
            try { localStorage.setItem("digitlab-contract-risk-v1:" + contract, JSON.stringify({ day: dayRef.current, pnl: pnlRef.current, trades: tradesRef.current, losses: lossesRef.current })); } catch { /* risk counters remain in memory */ }
            setLastResult((profit >= 0 ? "WON · " : "LOST · ") + profit.toFixed(2) + " " + currencyRef.current);
            openRef.current = "";
            setOpenTrade("");
            if (pnlRef.current <= -5 || lossesRef.current >= 3 || tradesRef.current >= 8) {
              armedRef.current = false; setArmed(false); setStatus("AUTO-STOP · RISK LIMIT");
              setMessage("Bot stopped by its daily loss, consecutive-loss or trade-count protection.");
            } else setStatus(armedRef.current ? "ARMED · DEMO SCANNING" : "DISARMED · DEMO ONLY");
          }
        }
      };
      socket.onerror = () => setMessage("Demo WebSocket error. No trade is confirmed.");
      socket.onclose = () => { setConnected(false); armedRef.current = false; setArmed(false); setStatus("DISCONNECTED · DISARMED"); };
    } catch (error) { setStatus("CONNECTION FAILED"); setMessage(error instanceof Error ? error.message : "Could not connect demo account."); }
  };

  useEffect(() => {
    if (!armed || !connected || !latestTick || !socketRef.current || openTrade || pendingRef.current) return;
    if (scan.status !== "RESEARCH_CANDIDATE" || scan.holdoutSamples < 100 || scan.barrier !== null && (scan.barrier < 0 || scan.barrier > 9)) {
      setStatus("WAIT · NO QUALIFIED SCAN"); return;
    }
    const key = symbol + ":" + latestTick.epoch + ":" + latestTick.quote;
    if (lastTickRef.current === key) return;
    lastTickRef.current = key;
    const amount = Number(stake);
    const currentBalance = balance;
    if (!Number.isFinite(amount) || amount <= 0 || currentBalance === null || amount > currentBalance * 0.005) {
      setStatus("BLOCKED · STAKE LIMIT"); setMessage("Stake must be positive and no more than 0.5% of the confirmed demo balance."); return;
    }
    if (pnlRef.current <= -5 || lossesRef.current >= 3 || tradesRef.current >= 8) {
      armedRef.current = false; setArmed(false); setStatus("AUTO-STOP · RISK LIMIT"); return;
    }
    contextRef.current = { barrier: scan.barrier, lower: scan.lowerBound, samples: scan.holdoutSamples, symbol, qualified: scan.status === "RESEARCH_CANDIDATE" };
    const proposal: Record<string, unknown> = {
      proposal: 1, amount, basis: "stake", contract_type: CONTRACT_CODE[contract],
      currency, duration: 1, duration_unit: "t", underlying_symbol: symbol, subscribe: 1, req_id: 804,
    };
    if (scan.barrier !== null) proposal.barrier = String(scan.barrier);
    pendingRef.current = true;
    setStatus("PRICING · " + symbol);
    socketRef.current.send(JSON.stringify(proposal));
  }, [armed, connected, latestTick, openTrade, scan, contract, symbol, stake, balance, currency]);

  const arm = () => {
    if (!connected || balance === null) { setMessage("Connect a verified demo account and wait for its balance first."); return; }
    if (scan.status !== "RESEARCH_CANDIDATE" || scan.holdoutSamples < 100) { setMessage("This contract has not passed its independent walk-forward evidence gate. The bot remains disarmed."); return; }
    if (Number(stake) <= 0 || Number(stake) > balance * 0.005) { setMessage("Stake must be no more than 0.5% of demo balance."); return; }
    lastTickRef.current = "";
    armedRef.current = true; setArmed(true); setStatus("ARMED · DEMO ONLY");
    setMessage("Bot armed by you. It will request a proposal only after a fresh tick and will buy only if expected value and all risk gates pass.");
  };
  const disarm = () => { armedRef.current = false; setArmed(false); setStatus(openTrade ? "POSITION MONITORED · DISARMED" : "DISARMED · DEMO ONLY"); setMessage(openTrade ? "New entries stopped. The open contract remains monitored to settlement." : "Bot disarmed."); };
  const disconnect = () => {
    if (openRef.current) { setMessage("Wait for the open demo contract to settle before disconnecting."); return; }
    disarm(); socketRef.current?.close(1000, "Demo bot stopped"); socketRef.current = null; setConnected(false); setBalance(null);
  };

  return <section className="panel contract-bot-panel">
    <div className="section-heading"><div><p className="eyebrow">CONTRACT-SPECIFIC EXECUTION BOT</p><h2>{contract} · DEMO BOT</h2></div><span className="tag">REAL ACCOUNTS BLOCKED</span></div>
    <p className="muted">This bot trades only the selected contract on a verified Deriv demo account. It never connects to a real-account endpoint.</p>
    {!oauthConnected ? <button className="scan-button" onClick={() => window.open("/api/deriv/oauth/start", "_blank", "noopener,noreferrer")}>CONNECT DERIV ACCOUNT</button> :
      <div className="bot-connect-row"><select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Select demo account</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.accountId} · {a.currency} · DEMO</option>)}</select>
      <button className="scan-button" onClick={connectDemo} disabled={connected || !accountId}> {connected ? "DEMO CONNECTED" : "CONNECT DEMO BOT"} </button></div>}
    <div className="scan-result-grid">
      <div><span>BOT STATUS</span><b>{status}</b></div><div><span>DEMO BALANCE</span><b>{balance === null ? "—" : balance.toFixed(2) + " " + currency}</b></div>
      <div><span>DEMO P/L TODAY</span><b>{dailyPnl.toFixed(2)} {currency}</b></div><div><span>TRADES / LIMIT</span><b>{trades} / 8</b></div>
      <div><span>LOSS STREAK</span><b>{lossStreak} / 3</b></div><div><span>LAST RESULT</span><b>{lastResult}</b></div>
    </div>
    <label className="stake-control">DEMO STAKE <input type="number" min="0.01" step="0.01" value={stake} onChange={(e) => setStake(e.target.value)} /></label>
    <p className="muted">{message}</p>
    {armed ? <button className="scan-button danger-button" onClick={disarm}>DISARM BOT</button> : <button className="scan-button" onClick={arm} disabled={!connected || scan.status !== "RESEARCH_CANDIDATE"}>ARM {contract} DEMO BOT</button>} {connected && !openTrade && <button className="scan-button" onClick={disconnect}>DISCONNECT DEMO</button>}
    <p className="analysis-footnote">Risk limits: max 0.5% of balance per stake · daily loss stop 5 account units · stop after 3 consecutive losses · maximum 8 trades per session. These controls are browser-side safeguards, not a guarantee against loss.</p>
  </section>;
}
