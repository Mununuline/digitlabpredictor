"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { summarizeDigits, type TickPoint } from "@/lib/digits";

const MARKETS = [
  { symbol: "1HZ10V", label: "Volatility 10 (1s)" },
  { symbol: "1HZ25V", label: "Volatility 25 (1s)" },
  { symbol: "1HZ50V", label: "Volatility 50 (1s)" },
  { symbol: "1HZ75V", label: "Volatility 75 (1s)" },
  { symbol: "1HZ100V", label: "Volatility 100 (1s)" },
  { symbol: "1HZ150V", label: "Volatility 150 (1s)" },
  { symbol: "1HZ250V", label: "Volatility 250 (1s)" },
];

const PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";
const MAX_TICKS = 500;
const HISTORY_REQ = 11;
const SYMBOLS_REQ = 10;
const STREAM_REQ = 12;
const PING_REQ = 90;

function precisionOf(quote: number | string, reported?: number): number {
  if (Number.isInteger(reported) && reported! >= 0 && reported! <= 10) return reported!;
  const value = String(quote);
  const point = value.indexOf(".");
  return point < 0 ? 0 : Math.min(10, value.length - point - 1);
}

function digitOf(tick: TickPoint): number {
  return Number(
    tick.quote
      .toFixed(tick.pipSize ?? 2)
      .replace(".", "")
      .replace("-", "")
      .slice(-1),
  );
}

export default function Home() {
  const [market, setMarket] = useState("1HZ100V");
  const [ticks, setTicks] = useState<TickPoint[]>([]);
  const [connection, setConnection] = useState("NOT CONNECTED");
  const [note, setNote] = useState("Connect to Deriv to load recent ticks and watch new digits arrive.");
  const [connectRequested, setConnectRequested] = useState(false);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [verifiedSymbols, setVerifiedSymbols] = useState<string[]>([]);
  const [feedError, setFeedError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);

  const stats = useMemo(() => summarizeDigits(ticks, 2), [ticks]);
  const latestDigits = useMemo(() => ticks.slice(-30).map(digitOf), [ticks]);

  useEffect(() => {
    if (!connectRequested) return;

    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let pingSentAt: number | null = null;
    let streamRequested = false;
    const maxDelay = 30000;

    const connect = () => {
      if (!active) return;
      setConnection(attempts === 0 ? "CONNECTING" : `RECONNECTING · ${attempts}`);
      setNote("Connecting to Deriv's current public market-data WebSocket…");
      setFeedError("");
      streamRequested = false;

      try {
        socket = new WebSocket(PUBLIC_WS);
        socketRef.current = socket;
      } catch (error) {
        scheduleRetry(error instanceof Error ? error.message : "WebSocket could not be created.");
        return;
      }

      socket.onopen = () => {
        if (!active) return;
        attempts = 0;
        setConnection("CONNECTED · CHECKING MARKETS");
        setNote("Connected. Checking Deriv's active-symbol list before subscribing…");
        socket?.send(JSON.stringify({ active_symbols: "brief", req_id: SYMBOLS_REQ }));
        pingTimer = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            pingSentAt = Date.now();
            socket.send(JSON.stringify({ ping: 1, req_id: PING_REQ }));
          }
        }, 30000);
      };

      socket.onmessage = (event) => {
        if (!active) return;
        try {
          const message = JSON.parse(event.data);
          if (message.error) {
            const detail = `${message.error.code || "API_ERROR"}: ${message.error.message || "Deriv rejected the request"}`;
            setFeedError(detail);
            setNote(`Deriv returned an API error: ${detail}`);
            if (message.req_id === SYMBOLS_REQ || message.req_id === STREAM_REQ) {
              socket?.close(4000, "Deriv API request rejected");
            }
            return;
          }

          if (message.req_id === PING_REQ && message.msg_type === "ping") {
            if (pingSentAt !== null) setLatency(Date.now() - pingSentAt);
          }

          if (message.req_id === SYMBOLS_REQ && message.msg_type === "active_symbols") {
            const symbols = (message.active_symbols || []).map((item: { symbol?: string }) => item.symbol).filter(Boolean) as string[];
            setVerifiedSymbols(symbols);
            if (!symbols.includes(market)) {
              setFeedError(`Selected market ${market} is not in Deriv's active-symbol response.`);
              setConnection("MARKET UNAVAILABLE");
              setNote("The selected symbol was not confirmed as active. Choose another market from the selector.");
              socket?.close(4001, "Selected market unavailable");
              return;
            }
            if (!streamRequested) {
              streamRequested = true;
              setConnection("CONNECTED · SUBSCRIBING");
              setNote(`Market ${market} confirmed active. Loading history and starting the live stream…`);
              socket?.send(JSON.stringify({ ticks: market, subscribe: 1, req_id: STREAM_REQ }));
              socket?.send(JSON.stringify({ ticks_history: market, count: MAX_TICKS, end: "latest", style: "ticks", req_id: HISTORY_REQ }));
            }
          }

          if (message.msg_type === "history" && message.history?.prices && message.history?.times) {
            const prices = message.history.prices as (number | string)[];
            const times = message.history.times as number[];
            const pip = Number.isInteger(message.pip_size) ? message.pip_size : undefined;
            const history = prices.map((price, index) => ({
              quote: Number(price),
              epoch: Number(times[index]),
              pipSize: precisionOf(price, pip),
            })).filter((item) => Number.isFinite(item.quote) && Number.isFinite(item.epoch));

            setTicks((current) => {
              const merged = new Map<string, TickPoint>();
              for (const item of history) merged.set(`${item.epoch}:${item.quote}`, item);
              for (const item of current) merged.set(`${item.epoch}:${item.quote}`, item);
              return [...merged.values()].sort((a, b) => a.epoch - b.epoch).slice(-MAX_TICKS);
            });
            setConnection("LIVE");
            setNote("Historical sample loaded. The live subscription is active; new ticks will update the tape.");
          }

          if (message.msg_type === "tick" && message.tick) {
            const raw = message.tick;
            const quote = Number(raw.quote);
            const epoch = Number(raw.epoch);
            if (!Number.isFinite(quote) || !Number.isFinite(epoch)) return;
            const item = {
              quote,
              epoch,
              pipSize: precisionOf(raw.quote, Number.isInteger(raw.pip_size) ? raw.pip_size : undefined),
            };
            setTicks((current) => {
              const next = current.filter((old) => !(old.epoch === item.epoch && old.quote === item.quote));
              return [...next, item].sort((a, b) => a.epoch - b.epoch).slice(-MAX_TICKS);
            });
            setLastTickAt(Date.now());
            setConnection("LIVE");
            setNote("Receiving real-time ticks from Deriv's public market-data feed.");
          }
        } catch {
          setFeedError("Received a message that could not be parsed as JSON.");
          setNote("Could not read a market-feed message. Waiting for the next update.");
        }
      };

      socket.onerror = () => {
        if (active) {
          setConnection("CONNECTION ERROR");
          setFeedError("Browser WebSocket error. Check network access or whether the connection is blocked.");
          setNote("The browser reported a WebSocket error. The app will retry with increasing delay.");
        }
      };

      socket.onclose = (event) => {
        if (pingTimer) clearInterval(pingTimer);
        if (!active) return;
        const detail = `Connection closed (code ${event.code}; ${event.reason || "no reason supplied"}; clean: ${event.wasClean ? "yes" : "no"}).`;
        setFeedError(detail);
        scheduleRetry(detail);
      };
    };

    const scheduleRetry = (reason: string) => {
      if (!active) return;
      attempts += 1;
      const delay = Math.min(1000 * 2 ** Math.min(attempts - 1, 5), maxDelay);
      setConnection("RECONNECTING");
      setNote(`${reason} Retrying in ${Math.round(delay / 1000)} seconds (attempt ${attempts}).`);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "User disconnected or market changed");
      socketRef.current = null;
    };
  }, [market, connectRequested]);

  function toggleFeed() {
    if (connectRequested) {
      setConnectRequested(false);
      setTicks([]);
      setLastTickAt(null);
      setLatency(null);
      setConnection("NOT CONNECTED");
      setNote("Feed disconnected.");
    } else {
      setTicks([]);
      setLastTickAt(null);
      setLatency(null);
      setConnectRequested(true);
    }
  }

  const ageSeconds = lastTickAt === null ? null : Math.max(0, Math.floor((Date.now() - lastTickAt) / 1000));

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
          <strong>Accuracy first.</strong><strong>Selectivity second.</strong><strong>Prediction volume last.</strong>
        </div>
      </section>

      <section className="controls panel">
        <div className="field">
          <label htmlFor="market">MARKET</label>
          <select id="market" value={market} onChange={(event) => setMarket(event.target.value)}>
            {MARKETS.map((item) => <option key={item.symbol} value={item.symbol}>{item.label} · {item.symbol}</option>)}
          </select>
        </div>
        <div className="field sample-field"><label>OBSERVATIONS</label><strong>{ticks.length} / {MAX_TICKS}</strong></div>
        <button className="primary-button" onClick={toggleFeed}>{connectRequested ? "DISCONNECT FEED" : "CONNECT LIVE FEED"} <span>↗</span></button>
      </section>

      <section className="feed-meta panel">
        <div><span>FEED</span><b>{connection}</b></div>
        <div><span>LATENCY</span><b>{latency === null ? "—" : `${latency} ms`}</b></div>
        <div><span>LAST TICK</span><b>{ageSeconds === null ? "—" : ageSeconds === 0 ? "JUST NOW" : `${ageSeconds}s AGO`}</b></div>
        <div><span>SYMBOL CHECK</span><b>{verifiedSymbols.includes(market) ? "CONFIRMED" : "PENDING"}</b></div>
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
                <strong>{item.digit}</strong><span>{item.count}</span>
                <div className="bar"><i style={{ width: `${Math.min(item.frequency * 100, 100)}%` }} /></div>
                <small>{(item.frequency * 100).toFixed(1)}%</small>
              </div>
            ))}
          </div>
          <p className="muted">{note}</p>
          {feedError && <p className="feed-error" role="status">{feedError}</p>}
          <div className="tape-heading"><span>LIVE LAST-DIGIT TAPE</span><small>Newest digit →</small></div>
          <div className="digit-tape" aria-live="polite">
            {latestDigits.length ? latestDigits.map((digit, index) => <span className="tape-digit" key={index}>{digit}</span>) : <span className="muted">Waiting for the first market tick…</span>}
          </div>
        </article>

        <aside className="panel signal-panel">
          <p className="eyebrow">AI SCANNER</p><h2>Signal status</h2>
          <div className="no-signal">NO SIGNAL</div>
          <p className="muted">Predictive output remains disabled until a model passes out-of-sample testing, calibration, and baseline comparison.</p>
          <div className="divider" />
          <div className="metric"><span>Candidate digit</span><b>—</b></div>
          <div className="metric"><span>Validated probability</span><b>—</b></div>
          <div className="metric"><span>Confidence</span><b>NOT ESTABLISHED</b></div>
          <div className="metric"><span>Benchmark</span><b>10% UNIFORM BASELINE</b></div>
        </aside>
      </section>

      <section className="panel methodology">
        <div><p className="eyebrow">METHODOLOGY</p><h2>Frequency is not a forecast.</h2></div>
        <p>Observed digit frequencies describe the sample already collected. They do not, by themselves, establish the probability of the next tick. DigitLab will compare any future candidate model against a 10% uniform baseline using walk-forward, unseen data.</p>
      </section>
      <footer><span>DIGITLAB PREDICTOR</span><span>DERIV PUBLIC MARKET DATA · READ ONLY · PREDICTIONS NOT YET ENABLED</span></footer>
    </main>
  );
}
