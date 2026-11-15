"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { summarizeDigits, type TickPoint } from "@/lib/digits";

const MARKETS = [
  { symbol: "1HZ10V", label: "Volatility 10 (1s)" },
  { symbol: "1HZ25V", label: "Volatility 25 (1s)" },
  { symbol: "1HZ50V", label: "Volatility 50 (1s)" },
  { symbol: "1HZ75V", label: "Volatility 75 (1s)" },
  { symbol: "1HZ100V", label: "Volatility 100 (1s)" },
  { symbol: "1HZ150V", label: "Volatility 150 (1s)" },
  { symbol: "1HZ250V", label: "Volatility 250 (1s)" }
];
const APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || "1089";
const MAX_TICKS = 500;
function precisionOf(quote: number | string, reported?: number): number {
  if (Number.isInteger(reported) && reported! >= 0 && reported! <= 10) return reported!;
  const value = String(quote);
  const point = value.indexOf(".");
  return point < 0 ? 0 : Math.min(10, value.length - point - 1);
}

export default function Home() {
  const [market, setMarket] = useState("1HZ100V");
  const [ticks, setTicks] = useState<TickPoint[]>([]);
  const [connection, setConnection] = useState("NOT CONNECTED");
  const [note, setNote] = useState("Connect to Deriv to load recent ticks and watch new digits arrive.");
  const [connectRequested, setConnectRequested] = useState(false);
  const stats = useMemo(() => summarizeDigits(ticks, 2), [ticks]);
  const latestDigits = useMemo(() => ticks.slice(-30).map(t => Number(t.quote.toFixed(t.pipSize ?? 2).replace(".", "").replace("-", "").slice(-1))), [ticks]);

  useEffect(() => {
    if (!connectRequested) return;
    let active = true;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (!active) return;
      setConnection("CONNECTING");
      setNote("Opening Deriv's public, read-only market feed…");
      socket = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(APP_ID)}`);
      socket.onopen = () => {
        if (!active) return;
        setConnection("CONNECTED · LOADING SAMPLE");
        socket?.send(JSON.stringify({ ticks_history: market, count: MAX_TICKS, end: "latest", style: "ticks", subscribe: 1 }));
      };
      socket.onmessage = (event) => {
        if (!active) return;
        try {
          const message = JSON.parse(event.data);
          if (message.error) {
            setConnection("FEED ERROR");
            setNote(message.error.message || "Deriv returned a market-data error.");
            return;
          }
          if (message.history?.prices && message.history?.times) {
            const prices = message.history.prices as (number | string)[];
            const times = message.history.times as number[];
            const p = Number.isInteger(message.pip_size) ? message.pip_size : undefined;
            const initial = prices.map((price, i) => ({ quote: Number(price), epoch: Number(times[i]), pipSize: precisionOf(price, p) }))
              .filter(t => Number.isFinite(t.quote) && Number.isFinite(t.epoch));
            setTicks(initial.slice(-MAX_TICKS));
            setConnection("LIVE");
            setNote("Live market data received. New ticks will appear in the digit tape below.");
          }
          if (message.tick) {
            const t = message.tick;
            const quote = Number(t.quote), epoch = Number(t.epoch);
            if (!Number.isFinite(quote) || !Number.isFinite(epoch)) return;
            const next = { quote, epoch, pipSize: precisionOf(t.quote, Number.isInteger(t.pip_size) ? t.pip_size : undefined) };
            setTicks(current => current.some(x => x.epoch === epoch && x.quote === quote) ? current : [...current, next].slice(-MAX_TICKS));
            setConnection("LIVE");
            setNote("Receiving real-time Deriv ticks. Latest 500 observations are retained.");
          }
        } catch {
          setNote("Could not read a market-feed message. Waiting for the next update.");
        }
      };
      socket.onerror = () => {
        if (active) { setConnection("CONNECTION ERROR"); setNote("Feed connection error. Retrying automatically…"); }
      };
      socket.onclose = () => {
        if (active) { setConnection("RECONNECTING"); retry = setTimeout(connect, 2500); }
      };
    };
    connect();
    return () => {
      active = false;
      if (retry) clearTimeout(retry);
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    };
  }, [market, connectRequested]);

  function toggleFeed() {
    if (connectRequested) {
      setConnectRequested(false); setTicks([]); setConnection("NOT CONNECTED");
      setNote("Feed disconnected.");
    } else { setTicks([]); setConnectRequested(true); }
  }

  return <main className="shell">
    <header className="topbar">
      <Link className="brand" href="/" aria-label="DigitLab Predictor home"><span className="brand-mark">D</span><span>DIGITLAB <b>PREDICTOR</b><small>DERIV · LAST-DIGIT ANALYSIS</small></span></Link>
      <span className="status"><i /> {connection}</span>
    </header>
    <section className="hero"><div><p className="eyebrow">RESEARCH-FIRST MARKET INTELLIGENCE</p><h1>Read the data.<br /><em>Respect the odds.</em></h1><p className="intro">Transparent last-digit statistics for Deriv synthetic indices. Signals stay off until evidence earns them.</p></div><div className="principle-card"><span>OUR OPERATING PRINCIPLE</span><strong>Accuracy first.</strong><strong>Selectivity second.</strong><strong>Prediction volume last.</strong></div></section>
    <section className="controls panel">
      <div className="field"><label htmlFor="market">MARKET</label><select id="market" value={market} onChange={e => setMarket(e.target.value)}>{MARKETS.map(item => <option key={item.symbol} value={item.symbol}>{item.label} · {item.symbol}</option>)}</select></div>
      <div className="field sample-field"><label>OBSERVATIONS</label><strong>{ticks.length}</strong></div>
      <button className="primary-button" onClick={toggleFeed}>{connectRequested ? "DISCONNECT FEED" : "CONNECT LIVE FEED"} <span>↗</span></button>
    </section>
    <section className="grid">
      <article className="panel digit-panel">
        <div className="section-heading"><div><p className="eyebrow">LIVE MARKET SAMPLE</p><h2>Digit distribution</h2></div><span className="tag">DESCRIPTIVE ONLY</span></div>
        <div className="digit-grid">{stats.map(item => <div className="digit-cell" key={item.digit}><strong>{item.digit}</strong><span>{item.count}</span><div className="bar"><i style={{ width: `${Math.min(item.frequency * 100, 100)}%` }} /></div><small>{(item.frequency * 100).toFixed(1)}%</small></div>)}</div>
        <p className="muted">{note}</p>
        <div className="tape-heading"><span>LIVE LAST-DIGIT TAPE</span><small>Newest digit →</small></div>
        <div className="digit-tape" aria-live="polite">{latestDigits.length ? latestDigits.map((digit, i) => <span className="tape-digit" key={i}>{digit}</span>) : <span className="muted">Waiting for the first market tick…</span>}</div>
      </article>
      <aside className="panel signal-panel"><p className="eyebrow">AI SCANNER</p><h2>Signal status</h2><div className="no-signal">NO SIGNAL</div><p className="muted">Predictive output is disabled until sufficient out-of-sample evidence has been collected and validated.</p><div className="divider" /><div className="metric"><span>Candidate digit</span><b>—</b></div><div className="metric"><span>Validated probability</span><b>—</b></div><div className="metric"><span>Confidence</span><b>NOT ESTABLISHED</b></div></aside>
    </section>
    <section className="panel methodology"><div><p className="eyebrow">METHODOLOGY</p><h2>Frequency is not a forecast.</h2></div><p>Observed digit frequencies describe the sample already collected. They do not, by themselves, establish the probability of the next tick. DigitLab will compare any future candidate model against a 10% uniform baseline using walk-forward, unseen data.</p></section>
    <footer><span>DIGITLAB PREDICTOR</span><span>LIVE READ-ONLY MARKET FEED · PREDICTIONS NOT YET ENABLED</span></footer>
  </main>;
}