"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { scanDigitContract, type DigitContractType } from "@/lib/contract-ai";
import { getLastDigit, type TickPoint } from "@/lib/digits";
import ContractDemoBot from "@/components/ContractDemoBot";

const MARKETS = [
  { symbol: "1HZ10V", label: "Volatility 10" }, { symbol: "1HZ25V", label: "Volatility 25" },
  { symbol: "1HZ50V", label: "Volatility 50" }, { symbol: "1HZ75V", label: "Volatility 75" },
  { symbol: "1HZ100V", label: "Volatility 100" }, { symbol: "1HZ150V", label: "Volatility 150" },
  { symbol: "1HZ250V", label: "Volatility 250" },
];
const CONTRACTS: DigitContractType[] = ["MATCHES", "DIFFERS", "EVEN", "ODD", "OVER", "UNDER"];
const WS = "wss://api.derivws.com/trading/v1/options/ws/public";

function getPrecision(value: number | string, reported?: number): number {
  if (Number.isInteger(reported) && reported! >= 0 && reported! <= 10) return reported!;
  const s = String(value), i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(10, s.length - i - 1);
}

export default function ContractScannerPage() {
  const [contract, setContract] = useState<DigitContractType>("MATCHES");
  const [symbol, setSymbol] = useState("1HZ100V");
  const [ticks, setTicks] = useState<TickPoint[]>([]);
  const [feed, setFeed] = useState("CONNECTING");
  const [error, setError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const scan = useMemo(() => scanDigitContract(ticks, contract), [ticks, contract]);
  const latestTick = ticks.length ? ticks[ticks.length - 1] : null;
  const latestDigit = latestTick ? getLastDigit(latestTick.quote, latestTick.pipSize ?? 2) : null;
  const selected = MARKETS.find((m) => m.symbol === symbol)!;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("contract") as DigitContractType | null;
    const s = params.get("symbol");
    if (c && CONTRACTS.includes(c)) setContract(c);
    if (s && MARKETS.some((m) => m.symbol === s)) setSymbol(s);
  }, []);

  useEffect(() => {
    setTicks([]);
    setError("");
    setFeed("CONNECTING");
    const socket = new WebSocket(WS);
    socketRef.current = socket;
    socket.onopen = () => {
      setFeed("LOADING HISTORY");
      socket.send(JSON.stringify({ ticks_history: symbol, count: 1000, end: "latest", style: "ticks", req_id: 901 }));
      socket.send(JSON.stringify({ ticks: symbol, subscribe: 1, req_id: 902 }));
    };
    socket.onmessage = (event) => {
      let data: Record<string, any>;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.error) { setError(data.error.message || "Deriv market feed error."); setFeed("FEED ERROR"); return; }
      if (data.msg_type === "history" && data.history?.prices && data.history?.times) {
        const prices: (number | string)[] = data.history.prices;
        const times: number[] = data.history.times;
        const precision = getPrecision(prices[prices.length - 1] ?? 0, data.history.pip_size);
        setTicks(prices.map((quote, i) => ({ quote: Number(quote), epoch: Number(times[i]), pipSize: precision })).filter((t) => Number.isFinite(t.quote) && Number.isFinite(t.epoch)).slice(-1000));
        setFeed("LIVE · HISTORY LOADED");
      }
      if (data.msg_type === "tick" && data.tick) {
        const q = data.tick.quote;
        const point: TickPoint = { quote: Number(q), epoch: Number(data.tick.epoch), pipSize: getPrecision(q, data.tick.pip_size) };
        if (!Number.isFinite(point.quote) || !Number.isFinite(point.epoch)) return;
        setTicks((current) => {
          const last = current[current.length - 1];
          if (last && last.epoch === point.epoch && last.quote === point.quote) return current;
          return [...current, point].slice(-1000);
        });
        setFeed("LIVE · STREAMING");
      }
    };
    socket.onerror = () => { setError("Could not connect to Deriv's public market feed."); setFeed("FEED ERROR"); };
    socket.onclose = () => setFeed((v) => v.startsWith("FEED ERROR") ? v : "DISCONNECTED");
    return () => { socket.close(1000, "Scanner closed"); socketRef.current = null; };
  }, [symbol]);

  const candidate = scan.barrier === null ? (contract === "EVEN" ? "EVEN" : "ODD") : String(scan.barrier);
  const confidence = scan.holdoutSamples ? scan.lowerBound : 0;

  return <main className="shell contract-scanner-page">
    <header className="topbar clean-topbar"><Link className="brand" href="/"><span className="brand-mark">D</span><span>DIGITLAB <b>PREDICTOR</b><small>INDEPENDENT CONTRACT SCANNER</small></span></Link><span className="status"><i />{feed}</span></header>
    <section className="market-strip">
      <div className="market-strip-heading"><span>DEEP SCAN CONFIGURATION</span><small>{ticks.length} / 1000 TICKS</small></div>
      <div className="scanner-config-row">
        <label>MARKET<select value={symbol} onChange={(e) => setSymbol(e.target.value)}>{MARKETS.map((m) => <option key={m.symbol} value={m.symbol}>{m.label} · {m.symbol}</option>)}</select></label>
        <label>CONTRACT<select value={contract} onChange={(e) => setContract(e.target.value as DigitContractType)}>{CONTRACTS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      </div>
      <p className="muted">Independent scan for {selected.label} · {symbol}. This page uses a separate live feed and a contract-specific walk-forward model.</p>
    </section>
    <section className="panel scanner-confidence-panel">
      <div className="ai-next-header"><div><p className="eyebrow">01 · AI DEEP SCAN</p><h1>{contract} MARKET SCANNER</h1></div><span className={scan.status === "RESEARCH_CANDIDATE" ? "scan-state complete" : "scan-state"}>{scan.decision}</span></div>
      <div className="confidence-hero"><div><span>CONSERVATIVE CONFIDENCE FLOOR</span><strong>{scan.holdoutSamples ? confidence.toFixed(1) + "%" : "—"}</strong><small>95% Wilson lower confidence bound · not a guaranteed win rate</small></div><div><span>MODEL WIN PROBABILITY</span><strong>{scan.holdoutSamples ? scan.predictedWinProbability.toFixed(1) + "%" : "—"}</strong><small>Current candidate estimate</small></div></div>
      <div className="scan-result-grid">
        <div><span>SELECTED BARRIER / OUTCOME</span><b>{candidate}</b></div>
        <div><span>UNSEEN HIT RATE</span><b>{scan.holdoutSamples ? scan.holdoutAccuracy.toFixed(1) + "%" : "—"}</b></div>
        <div><span>CONTRACT BASELINE</span><b>{scan.holdoutSamples ? scan.baselineProbability.toFixed(1) + "%" : "—"}</b></div>
        <div><span>EDGE LOWER BOUND</span><b>{scan.holdoutSamples ? (scan.edgeLowerBound >= 0 ? "+" : "") + scan.edgeLowerBound.toFixed(1) + " pp" : "—"}</b></div>
        <div><span>UNSEEN TESTS</span><b>{scan.holdoutSamples}</b></div>
        <div><span>RECENT HIT RATE</span><b>{scan.recentSamples ? scan.recentAccuracy.toFixed(1) + "%" : "—"}</b></div>
        <div><span>LATEST DIGIT</span><b>{latestDigit === null ? "—" : latestDigit}</b></div>
        <div><span>LIVE TICKS</span><b>{ticks.length}</b></div>
      </div>
      <p className="muted contract-reason">{error || scan.reason}</p>
      <p className="analysis-footnote">{scan.methodology}</p>
      <div className="next-phase"><span>02 · AI DECISION</span><p>{scan.status === "RESEARCH_CANDIDATE" ? "Research candidate only. The demo bot may request a live proposal, but it will buy only when the conservative probability exceeds the contract break-even rate and all risk checks pass." : "WAIT / NO TRADE. Keep collecting ticks. The scanner will not lower its evidence threshold to force a signal."}</p></div>
    </section>
    <ContractDemoBot contract={contract} symbol={symbol} scan={scan} latestTick={latestTick} />
    <p className="analysis-footnote">Real-money execution is disabled. Demo execution requires a separate Deriv login, an explicit connection and a deliberate ARM action. Statistical confidence is not a promise of profit.</p>
  </main>;
}
