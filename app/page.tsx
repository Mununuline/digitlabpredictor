"use client";

import { useMemo, useState } from "react";
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

export default function Home() {
  const [market, setMarket] = useState("1HZ100V");
  const [ticks, setTicks] = useState<TickPoint[]>([]);
  const [connection, setConnection] = useState("NOT CONNECTED");
  const [note, setNote] = useState("Connect a public market feed to begin collecting observations.");

  const stats = useMemo(() => summarizeDigits(ticks, 2), [ticks]);
  const total = ticks.length;

  function connectFeed() {
    setConnection("NOT CONNECTED");
    setNote("Live feed integration is the next build step. No live data or predictions are being simulated.");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="DigitLab Predictor home">
          <span className="brand-mark">D</span>
          <span>DIGITLAB <b>PREDICTOR</b><small>DERIV · LAST-DIGIT ANALYSIS</small></span>
        </Link>
        <span className="status"><i /> {connection}</span>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">RESEARCH-FIRST MARKET INTELLIGENCE</p>
          <h1>Read the data.<br /><em>Respect the odds.</em></h1>
          <p className="intro">Transparent last-digit statistics for Deriv synthetic indices. Signals stay off until evidence earns them.</p>
        </div>
        <div className="principle-card">
          <span>OUR OPERATING PRINCIPLE</span>
          <strong>Accuracy first.</strong>
          <strong>Selectivity second.</strong>
          <strong>Prediction volume last.</strong>
        </div>
      </section>

      <section className="controls panel">
        <div className="field">
          <label htmlFor="market">MARKET</label>
          <select id="market" value={market} onChange={(event) => setMarket(event.target.value)}>
            {MARKETS.map((item) => <option key={item.symbol} value={item.symbol}>{item.label} · {item.symbol}</option>)}
          </select>
        </div>
        <div className="field sample-field">
          <label>OBSERVATIONS</label>
          <strong>{total}</strong>
        </div>
        <button className="primary-button" onClick={connectFeed}>CONNECT LIVE FEED <span>↗</span></button>
      </section>

      <section className="grid">
        <article className="panel digit-panel">
          <div className="section-heading">
            <div><p className="eyebrow">LIVE MARKET SAMPLE</p><h2>Digit distribution</h2></div>
            <span className="tag">DESCRIPTIVE ONLY</span>
          </div>
          <div className="digit-grid">
            {stats.map((item) => (
              <div className="digit-cell" key={item.digit}>
                <strong>{item.digit}</strong>
                <span>{item.count}</span>
                <div className="bar"><i style={{ width: `${Math.min(item.frequency * 100, 100)}%` }} /></div>
                <small>{(item.frequency * 100).toFixed(1)}%</small>
              </div>
            ))}
          </div>
          <p className="muted">{note}</p>
        </article>

        <aside className="panel signal-panel">
          <p className="eyebrow">AI SCANNER</p>
          <h2>Signal status</h2>
          <div className="no-signal">NO SIGNAL</div>
          <p className="muted">Predictive output is disabled until sufficient out-of-sample evidence has been collected and validated.</p>
          <div className="divider" />
          <div className="metric"><span>Candidate digit</span><b>—</b></div>
          <div className="metric"><span>Validated probability</span><b>—</b></div>
          <div className="metric"><span>Confidence</span><b>NOT ESTABLISHED</b></div>
        </aside>
      </section>

      <section className="panel methodology">
        <div><p className="eyebrow">METHODOLOGY</p><h2>Frequency is not a forecast.</h2></div>
        <p>Observed digit frequencies describe the sample already collected. They do not, by themselves, establish the probability of the next tick. DigitLab will compare any future candidate model against a 10% uniform baseline using walk-forward, unseen data.</p>
      </section>

      <footer><span>DIGITLAB PREDICTOR</span><span>EARLY FOUNDATION · LIVE CONNECTION NOT YET IMPLEMENTED</span></footer>
    </main>
  );
}