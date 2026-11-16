"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DigitAIReview } from "@/lib/digit-ai";
import type { TickPoint } from "@/lib/digits";

type DemoAccount = { accountId: string; accountType: "demo"; currency: string; balance: number; status: string };
type Props = { market: string; ticks: TickPoint[]; review: DigitAIReview };

const MAX_CONSECUTIVE_LOSSES = 3;
const MAX_TRADES_PER_DAY = 8;

export default function DemoTradingBots({ market, ticks, review }: Props) {
  const [oauthConnected, setOauthConnected] = useState(false);
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [balance, setBalance] = useState<number | null>(null);
  const [botStatus, setBotStatus] = useState("DISARMED · DEMO ONLY");
  const [message, setMessage] = useState("Connect your Deriv account to load demo accounts. Real accounts are excluded.");
  const [wsConnected, setWsConnected] = useState(false);
  const [armed, setArmed] = useState(false);
  const [stake, setStake] = useState("0.35");
  const [dailyLossLimit, setDailyLossLimit] = useState("5");
  const dailyLossLimitRef = useRef(5);
  const [dailyPnl, setDailyPnl] = useState(0);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [tradesToday, setTradesToday] = useState(0);
  const [consecutiveLosses, setConsecutiveLosses] = useState(0);
  const [openTrade, setOpenTrade] = useState<string | null>(null);
  const [lastTrade, setLastTrade] = useState("NONE");
  const [lastEdge, setLastEdge] = useState("Waiting for a validated signal and a live proposal.");
  const socketRef = useRef<WebSocket | null>(null);
  const reviewRef = useRef(review);
  const marketRef = useRef(market);
  const stakeRef = useRef(Number(stake));
  const accountRef = useRef({ accountId, currency });
  const balanceRef = useRef<number | null>(balance);
  const armedRef = useRef(armed);
  const openTradeRef = useRef<string | null>(null);
  const proposalPendingRef = useRef(false);
  const lastTickKeyRef = useRef("");
  const reqIdRef = useRef(400);
  const dailyRef = useRef({ day: new Date().toISOString().slice(0, 10), pnl: 0, trades: 0, lossesInRow: 0, wins: 0, losses: 0 });
  const settledContractRef = useRef<string | null>(null);

  useEffect(() => { reviewRef.current = review; }, [review]);
  useEffect(() => { marketRef.current = market; }, [market]);
  useEffect(() => { stakeRef.current = Number(stake); }, [stake]);
  useEffect(() => { accountRef.current = { accountId, currency }; }, [accountId, currency]);
  useEffect(() => { balanceRef.current = balance; }, [balance]);
  useEffect(() => { armedRef.current = armed; }, [armed]);
  useEffect(() => { dailyLossLimitRef.current = Number(dailyLossLimit); }, [dailyLossLimit]);
  useEffect(() => { openTradeRef.current = openTrade; }, [openTrade]);

  const loadSession = useCallback(async () => {
    const response = await fetch("/api/deriv/session", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load Deriv session.");
    setOauthConnected(Boolean(data.connected));
    setAccounts(data.accounts || []);
    if (data.accounts?.length) {
      setAccountId((current: string) => data.accounts.some((a: DemoAccount) => a.accountId === current) ? current : data.accounts[0].accountId);
      setCurrency(data.accounts[0].currency);
    }
    if (!data.connected) setMessage("Connect your Deriv account to load demo accounts.");
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("digitlab-demo-risk-v1");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.day === dailyRef.current.day) {
          dailyRef.current = { ...dailyRef.current, ...parsed };
          setDailyPnl(Number(parsed.pnl) || 0);
          setTradesToday(Number(parsed.trades) || 0);
          setConsecutiveLosses(Number(parsed.lossesInRow) || 0);
          setWins(Number(parsed.wins) || 0);
          setLosses(Number(parsed.losses) || 0);
        }
      }
    } catch { /* retain safe defaults */ }
    void loadSession().catch((error) => setMessage(error.message));
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code || state) {
      if (!code || !state) {
        setMessage("Incomplete Deriv OAuth callback. Restart account connection.");
        window.history.replaceState({}, "", window.location.pathname);
        return;
      }
      setMessage("Verifying secure Deriv login…");
      fetch("/api/deriv/oauth/callback", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, state }),
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Deriv authorization failed.");
        await loadSession();
        setMessage("Deriv connected. Select a DEMO account to continue.");
      }).catch((error) => setMessage(error.message))
        .finally(() => window.history.replaceState({}, "", window.location.pathname));
    }
  }, [loadSession]);

  const disconnectDemo = () => {
    if (openTradeRef.current) { setMessage("An open demo contract is still being monitored. Wait for settlement before disconnecting."); return; }
    setArmed(false);
    armedRef.current = false;
    socketRef.current?.close(1000, "Demo bot stopped");
    socketRef.current = null;
    setWsConnected(false);
    setOpenTrade(null);
    openTradeRef.current = null;
    setBotStatus("DISARMED · DEMO ONLY");
    setMessage("Demo trading connection closed. The bot is disarmed.");
  };

  const connectDemo = async () => {
    try {
      if (!accountId) throw new Error("Select a verified demo account first.");
      setBotStatus("AUTHENTICATING DEMO");
      setMessage("Requesting a one-time demo WebSocket credential…");
      const response = await fetch("/api/deriv/otp", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || "Could not open demo connection.");
      const url = new URL(data.url);
      if (url.pathname !== "/trading/v1/options/ws/demo") throw new Error("Safety check blocked a non-demo trading endpoint.");
      const socket = new WebSocket(data.url);
      socketRef.current = socket;
      socket.onopen = () => {
        setWsConnected(true);
        setBotStatus("DEMO CONNECTED · DISARMED");
        setMessage("Authenticated demo session connected. Trading remains disarmed until you explicitly arm it.");
        socket.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: 401 }));
      };
      socket.onmessage = (event) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: Record<string, any>;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.error) {
          proposalPendingRef.current = false;
          setMessage(data.error.message || "Deriv returned a trading error.");
          if (data.req_id === 401) setBotStatus("DEMO AUTH ERROR");
          return;
        }
        if (data.msg_type === "balance" && data.balance) {
          const nextBalance = Number(data.balance.balance);
          if (Number.isFinite(nextBalance)) setBalance(nextBalance);
          if (data.balance.currency) setCurrency(data.balance.currency);
        }
        if (data.msg_type === "proposal" && data.proposal) {
          proposalPendingRef.current = false;
          const proposal = data.proposal;
          const ask = Number(proposal.ask_price);
          const payout = Number(proposal.payout);
          const conservativeProbability = reviewRef.current.lowerBound / 100;
          const breakEven = payout > 0 ? ask / payout : 1;
          const expectedValue = conservativeProbability * payout - ask;
          setLastEdge(`Conservative estimate ${(conservativeProbability * 100).toFixed(2)}% · break-even ${(breakEven * 100).toFixed(2)}% · expected value ${expectedValue.toFixed(3)} ${accountRef.current.currency}`);
          const availableBalance = balanceRef.current;
          const currentStake = stakeRef.current;
          const riskCap = availableBalance === null ? 0 : availableBalance * 0.005;
          const lossCap = dailyLossLimitRef.current;
          const canTrade = armedRef.current && reviewRef.current.candidate !== null
            && conservativeProbability > breakEven && expectedValue > 0
            && Number.isFinite(ask) && Number.isFinite(payout) && payout > ask
            && currentStake > 0 && currentStake <= riskCap && currentStake <= Math.max(0, lossCap + dailyRef.current.pnl)
            && dailyRef.current.pnl > -lossCap
            && dailyRef.current.lossesInRow < MAX_CONSECUTIVE_LOSSES
            && dailyRef.current.trades < MAX_TRADES_PER_DAY
            && !openTradeRef.current;
          if (!canTrade) {
            setBotStatus("WAIT · RISK / EDGE GATE");
            setMessage("Proposal rejected: the conservative out-of-sample probability must exceed the contract break-even rate, and every risk limit must pass.");
            return;
          }
          setBotStatus("EXECUTING DEMO CONTRACT");
          socket.send(JSON.stringify({ buy: proposal.id, price: ask, req_id: 402 }));
          setMessage("Proposal passed the conservative edge and risk checks. Submitting one demo contract.");
        }
        if (data.msg_type === "buy" && data.buy) {
          const id = String(data.buy.contract_id);
          openTradeRef.current = id;
          settledContractRef.current = null;
          setOpenTrade(id);
          dailyRef.current.trades += 1;
          setTradesToday(dailyRef.current.trades);
          try { localStorage.setItem("digitlab-demo-risk-v1", JSON.stringify(dailyRef.current)); } catch { /* ignore storage failure */ }
          setLastTrade(`OPEN · #${id}`);
          setBotStatus("DEMO TRADE OPEN");
          socket.send(JSON.stringify({ proposal_open_contract: 1, contract_id: Number(id), subscribe: 1, req_id: 403 }));
        }
        if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract) {
          const contract = data.proposal_open_contract;
          const contractId = String(contract.contract_id || "");
          if ((contract.is_sold || contract.status === "won" || contract.status === "lost" || contract.status === "sold") && contractId && settledContractRef.current !== contractId) {
            settledContractRef.current = contractId;
            const profit = Number(contract.profit) || 0;
            dailyRef.current.pnl += profit;
            setDailyPnl(dailyRef.current.pnl);
            if (profit > 0) {
              dailyRef.current.wins += 1;
              dailyRef.current.lossesInRow = 0;
              setConsecutiveLosses(0);
              setWins((n) => n + 1);
            } else {
              dailyRef.current.losses += 1;
              dailyRef.current.lossesInRow += 1;
              setConsecutiveLosses(dailyRef.current.lossesInRow);
              setLosses((n) => n + 1);
            }
            setWins(dailyRef.current.wins);
            setLosses(dailyRef.current.losses);
            try { localStorage.setItem("digitlab-demo-risk-v1", JSON.stringify(dailyRef.current)); } catch { /* ignore storage failure */ }
            setLastTrade(`${profit >= 0 ? "WON" : "LOST"} · ${profit.toFixed(2)} ${accountRef.current.currency}`);
            openTradeRef.current = null;
            setOpenTrade(null);
            if (dailyRef.current.pnl <= -dailyLossLimitRef.current || dailyRef.current.lossesInRow >= MAX_CONSECUTIVE_LOSSES || dailyRef.current.trades >= MAX_TRADES_PER_DAY) {
              setArmed(false);
              armedRef.current = false;
              setBotStatus("AUTO-STOP · RISK LIMIT");
              setMessage("The Risk Guardian stopped the demo bot after a configured loss, streak or daily trade limit.");
            } else {
              setBotStatus(armedRef.current ? "ARMED · DEMO SCANNING" : "DISARMED · DEMO ONLY");
            }
          }
        }
      };
      socket.onerror = () => setMessage("Demo WebSocket error. Trading has not been confirmed.");
      socket.onclose = () => {
        setWsConnected(false);
        setArmed(false);
        armedRef.current = false;
        setBotStatus("DISCONNECTED · DISARMED");
      };
    } catch (error) {
      setBotStatus("CONNECTION FAILED");
      setMessage(error instanceof Error ? error.message : "Could not connect to demo account.");
    }
  };

  useEffect(() => {
    const latest = ticks[ticks.length - 1];
    if (!latest || !armed || !wsConnected || !socketRef.current || openTrade || proposalPendingRef.current) return;
    const key = `${market}:${latest.epoch}:${latest.quote}`;
    if (lastTickKeyRef.current === key) return;
    lastTickKeyRef.current = key;
    const current = review;
    if (current.candidate === null || current.holdoutSamples < 100 || current.lowerBound <= 10) {
      setBotStatus("SCANNING · NO QUALIFIED EDGE");
      return;
    }
    const currentStake = Number(stake);
    const currentBalance = balance;
    if (!Number.isFinite(currentStake) || currentStake <= 0 || currentBalance === null || currentStake > currentBalance * 0.005 || currentStake > Math.max(0, Number(dailyLossLimit) + dailyRef.current.pnl)) {
      setBotStatus("BLOCKED · STAKE LIMIT");
      setMessage("Stake must be positive and no greater than 0.5% of the latest demo balance.");
      return;
    }
    if (dailyRef.current.pnl <= -Number(dailyLossLimit) || dailyRef.current.lossesInRow >= MAX_CONSECUTIVE_LOSSES || dailyRef.current.trades >= MAX_TRADES_PER_DAY) {
      setArmed(false);
      armedRef.current = false;
      setBotStatus("AUTO-STOP · RISK LIMIT");
      return;
    }
    proposalPendingRef.current = true;
    setBotStatus("DEEPSCAN · PRICING OPPORTUNITY");
    const reqId = ++reqIdRef.current;
    socketRef.current.send(JSON.stringify({
      proposal: 1, amount: currentStake, basis: "stake", contract_type: "DIGITMATCH",
      barrier: String(current.candidate), currency, duration: 1, duration_unit: "t",
      underlying_symbol: market, req_id: reqId,
    }));
  }, [ticks, market, review, armed, wsConnected, openTrade, stake, balance, currency, dailyLossLimit]);

  useEffect(() => () => {
    socketRef.current?.close(1000, "Component unmounted");
  }, []);

  const armBot = () => {
    if (!wsConnected) { setMessage("Connect a demo account before arming the bot."); return; }
    if (balance === null) { setMessage("Waiting for a confirmed demo balance."); return; }
    if (Number(stake) <= 0 || Number(stake) > balance * 0.005) { setMessage("Stake must be no more than 0.5% of demo balance."); return; }
    const today = new Date().toISOString().slice(0, 10);
    if (dailyRef.current.day !== today) {
      dailyRef.current = { day: today, pnl: 0, trades: 0, lossesInRow: 0, wins: 0, losses: 0 };
      setDailyPnl(0); setTradesToday(0); setConsecutiveLosses(0); setWins(0); setLosses(0);
      try { localStorage.setItem("digitlab-demo-risk-v1", JSON.stringify(dailyRef.current)); } catch { /* ignore storage failure */ }
    }
    if (dailyRef.current.pnl <= -Number(dailyLossLimit) || dailyRef.current.lossesInRow >= MAX_CONSECUTIVE_LOSSES || dailyRef.current.trades >= MAX_TRADES_PER_DAY) {
      setBotStatus("AUTO-STOP · RISK LIMIT");
      setMessage("Daily risk stop is active. Do not reset counters to resume trading.");
      return;
    }
    lastTickKeyRef.current = "";
    setArmed(true);
    armedRef.current = true;
    setBotStatus("ARMED · DEMO SCANNING");
    setMessage("Demo bot armed. It will only buy when a validated signal clears the live proposal break-even and risk gates.");
  };

  return (
    <section className="panel bots-panel">
      <div className="section-heading">
        <div><p className="eyebrow">MULTI-AGENT EXECUTION SYSTEM · PHASE 1</p><h2>AI trading bots · Demo only</h2></div>
        <span className="tag">REAL ACCOUNT BLOCKED</span>
      </div>
      <p className="muted">Five coordinated agents: Market Scout, DeepScan AI, Opportunity Hunter, Risk Guardian and Execution Bot. The first execution strategy is a one-tick DIGITMATCH demo contract; it must clear the actual proposal break-even rate before any purchase.</p>
      <div className="bot-agents">
        {[
          ["MARKET SCOUT", wsConnected ? `MONITORING · ${market}` : "AWAITING LIVE FEED"],
          ["DEEPSCAN AI", review.candidate === null ? "NO VALIDATED EDGE" : `CANDIDATE · DIGIT ${review.candidate}`],
          ["OPPORTUNITY HUNTER", armed ? "CHECKING PROPOSAL EV" : "STANDBY"],
          ["RISK GUARDIAN", `MAX 0.5% · ${MAX_CONSECUTIVE_LOSSES} LOSSES`],
          ["EXECUTION BOT", openTrade ? "POSITION OPEN" : "DEMO ONLY · ARMED BY USER"],
        ].map(([name, status]) => <div className="bot-agent" key={name}><span>{name}</span><b>{status}</b></div>)}
      </div>
      <div className="demo-connect-row">
        {!oauthConnected ? <button className="primary-button" onClick={() => { window.location.href = "/api/deriv/oauth/start"; }}>CONNECT DERIV ACCOUNT ↗</button> :
          <><span className="demo-connected">DERIV OAUTH CONNECTED</span><select value={accountId} onChange={(e) => { setAccountId(e.target.value); const a = accounts.find((x) => x.accountId === e.target.value); if (a) setCurrency(a.currency); }} aria-label="Select demo account">
            {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.accountId} · DEMO · {a.currency} {a.balance.toFixed(2)}</option>)}
          </select>
          {!wsConnected ? <button className="primary-button" onClick={() => void connectDemo()}>CONNECT DEMO EXECUTION</button> : <button className="secondary-button" onClick={disconnectDemo}>DISCONNECT DEMO</button>}</>}
      </div>
      <div className="ai-grid">
        <div><span>DEMO BALANCE</span><b>{balance === null ? "—" : `${currency} ${balance.toFixed(2)}`}</b></div>
        <div><span>DAILY DEMO P/L</span><b>{dailyPnl >= 0 ? "+" : ""}{dailyPnl.toFixed(2)} {currency}</b></div>
        <div><span>DEMO WINS / LOSSES</span><b>{wins} / {losses}</b></div>
        <div><span>TRADES TODAY</span><b>{tradesToday} / {MAX_TRADES_PER_DAY}</b></div>
        <div><span>CONSECUTIVE LOSSES</span><b>{consecutiveLosses} / {MAX_CONSECUTIVE_LOSSES}</b></div>
        <div><span>OPEN DEMO POSITION</span><b>{openTrade ? openTrade : "NONE"}</b></div>
      </div>
      <div className="bot-settings">
        <label>STAKE PER TRADE ({currency})<input type="number" min="0.01" step="0.01" value={stake} onChange={(e) => setStake(e.target.value)} disabled={armed} /></label>
        <label>DAILY LOSS STOP ({currency})<input type="number" min="0.01" step="0.01" value={dailyLossLimit} onChange={(e) => setDailyLossLimit(e.target.value)} disabled={armed} /></label>
        <div className="risk-note">Hard gates: stake ≤ 0.5% of current demo balance · stop after 3 consecutive losses · maximum 8 demo trades/day · one open position.</div>
      </div>
      <div className="bot-status">{botStatus}</div>
      <div className="demo-connect-row">
        {!armed ? <button className="primary-button" onClick={armBot} disabled={!wsConnected}>ARM DEMO BOTS</button> :
          <button className="stop-button" onClick={() => { setArmed(false); armedRef.current = false; setBotStatus("DISARMED · DEMO ONLY"); setMessage("Bots stopped. Any open contract will still be monitored until settlement."); }}>STOP NEW TRADES</button>}
        <span className="muted">{lastTrade}</span>
      </div>
      <p className="muted" role="status">{message}</p>
      <p className="analysis-footnote">Latest proposal gate: {lastEdge} The model&apos;s lower confidence bound is compared with the quoted break-even probability; historical digit accuracy is not assumed to equal profitability. Daily counters are held in this browser session and must be migrated to durable server-side risk storage before unattended operation. Demo trading only; no real-account WebSocket or real-money order path exists in this component.</p>
    </section>
  );
}
