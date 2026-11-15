"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { summarizeDigits, type TickPoint } from "@/lib/digits";
import { scanDigits } from "@/lib/digit-ai";
import { countTicks, loadTicks, saveTicks } from "@/lib/research-store";
import { loadPaperLedger, recordPaperDecision, settlePaperDecision, type PaperDecision } from "@/lib/paper-ledger";

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
const MAX_TICKS = 1000;
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


type MarketReview = {
  sample: number; chiSquare: number; maxDeviation: number; entropy: number;
  repeatRate: number; longestStreak: number; recentShift: number;
  transitionSupport: number; transitionProbability: number; transitionBaseline: number;
  transitionLift: number; transitionLabel: string;
  status: string; summary: string;
};

function reviewMarket(points: TickPoint[]): MarketReview {
  const digits = points.map(digitOf);
  const n = digits.length;
  const counts = Array.from({ length: 10 }, () => 0);
  digits.forEach((d) => counts[d]++);
  const expected = n / 10;
  const chiSquare = n ? counts.reduce((sum, count) => sum + ((count - expected) ** 2) / expected, 0) : 0;
  const maxDeviation = n ? Math.max(...counts.map((count) => Math.abs((count / n) * 100 - 10))) : 0;
  const entropy = n ? -counts.reduce((sum, count) => {
    if (!count) return sum;
    const p = count / n;
    return sum + p * Math.log2(p);
  }, 0) / Math.log2(10) : 0;
  let repeats = 0;
  let longestStreak = 0;
  let run = 0;
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && digits[i] === digits[i - 1]) repeats++;
    run = i > 0 && digits[i] === digits[i - 1] ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
  }
  const recent = digits.slice(-100);
  const prior = digits.slice(-500, -100);
  const recentCounts = Array.from({ length: 10 }, () => 0);
  const priorCounts = Array.from({ length: 10 }, () => 0);
  recent.forEach((d) => recentCounts[d]++);
  prior.forEach((d) => priorCounts[d]++);
  const recentShift = recent.length && prior.length
    ? Math.max(...recentCounts.map((count, i) => Math.abs(count / recent.length - priorCounts[i] / prior.length) * 100))
    : 0;
  // Exploratory one-step transition scan. This is deliberately not a forecast:
  // the best cell is selected from 100 possible transitions, so it is highly
  // exposed to multiple-testing noise until it survives untouched future data.
  const transitions = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => 0));
  const rowTotals = Array.from({ length: 10 }, () => 0);
  const targetTotals = Array.from({ length: 10 }, () => 0);
  for (let i = 0; i + 1 < digits.length; i++) {
    transitions[digits[i]][digits[i + 1]]++;
    rowTotals[digits[i]]++;
    targetTotals[digits[i + 1]]++;
  }
  let best = { support: 0, probability: 0, baseline: 0, lift: 0, from: -1, to: -1 };
  for (let from = 0; from < 10; from++) {
    if (rowTotals[from] < 1) continue;
    for (let to = 0; to < 10; to++) {
      const probability = transitions[from][to] / rowTotals[from];
      const baseline = n > 1 ? targetTotals[to] / (n - 1) : 0.1;
      const lift = baseline > 0 ? probability / baseline : 0;
      if (lift > best.lift) best = { support: rowTotals[from], probability, baseline, lift, from, to };
    }
  }
  const transitionLabel = best.support < 30
    ? "INSUFFICIENT TRANSITION SUPPORT"
    : `AFTER ${best.from} → ${best.to} · EXPLORATORY ONLY`;
  const status = n < 200 ? "BUILDING SAMPLE" : chiSquare >= 16.92 ? "DISTRIBUTION DEVIATION" : "NO STRONG DEVIATION";
  const summary = n < 200
    ? "Collecting a larger sample before comparing the digit distribution."
    : chiSquare >= 16.92
      ? "The sample differs from a perfectly uniform 10% split. This is descriptive evidence only, not a next-tick edge."
      : "No large overall departure from a uniform 10% split is visible in this sample.";
  return { sample: n, chiSquare, maxDeviation, entropy, repeatRate: n > 1 ? repeats / (n - 1) * 100 : 0, longestStreak, recentShift, transitionSupport: best.support, transitionProbability: best.probability, transitionBaseline: best.baseline, transitionLift: best.lift, transitionLabel, status, summary };
}

export default function Home() {
  const [market, setMarket] = useState("1HZ100V");
  const [ticks, setTicks] = useState<TickPoint[]>([]);
  const [connection, setConnection] = useState("NOT CONNECTED");
  const [note, setNote] = useState("Connect to Deriv to load recent ticks and watch new digits arrive.");
  const [connectRequested, setConnectRequested] = useState(false);
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [latency, setLatency] = useState<number | null>(null);
  const [verifiedSymbols, setVerifiedSymbols] = useState<string[]>([]);
  const [feedError, setFeedError] = useState("");
  const [lastResponse, setLastResponse] = useState("NO SERVER RESPONSE YET");
  const [storedTickCount, setStoredTickCount] = useState(0);
  const [paperLedger, setPaperLedger] = useState<PaperDecision[]>([]);
  const processedTickRef = useRef<string>("");
  const [storageStatus, setStorageStatus] = useState("LOCAL ARCHIVE · LOADING");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stats = useMemo(() => summarizeDigits(ticks, 2), [ticks]);
  const latestDigits = useMemo(() => ticks.slice(-30).map(digitOf), [ticks]);
  const review = useMemo(() => reviewMarket(ticks), [ticks]);
  const aiReview = useMemo(() => scanDigits(ticks), [ticks]);
  useEffect(() => {
    let active = true;
    const latest = ticks[ticks.length - 1];
    // Never create decisions from a historical preload or a disconnected feed.
    if (!latest || connection !== "LIVE") return;
    const key = `${market}:${latest.epoch}:${latest.quote}`;
    if (processedTickRef.current === key) return;
    processedTickRef.current = key;

    const run = async () => {
      try {
        let rows = await loadPaperLedger(market);

        // Settle each pending decision against the earliest later tick we have,
        // not merely the newest tick in a React update batch. This preserves
        // one-tick scoring if several feed messages arrive before a render.
        const pending = rows.filter((row) => row.outcomeDigit === null && row.tickEpoch < latest.epoch);
        for (const row of pending) {
          const nextTick = ticks.find((point) => point.epoch > row.tickEpoch);
          if (nextTick) rows = await settlePaperDecision(market, row.id, digitOf(nextTick));
        }

        const exists = rows.some((row) => row.tickEpoch === latest.epoch && row.tickQuote === latest.quote);
        if (!exists) {
          const evidence = scanDigits(ticks);
          const decision: PaperDecision["decision"] = ticks.length < 300 || evidence.holdoutSamples < 100
            ? "WAIT"
            : evidence.candidate !== null ? "TRADE" : "NO TRADE";
          rows = await recordPaperDecision(market, {
            id: `${market}-${latest.epoch}-${String(latest.quote).replace(".", "-")}`,
            market, tickEpoch: latest.epoch, tickQuote: latest.quote, decision,
            triggerDigit: evidence.triggerDigit, proposedDigit: evidence.proposedCandidate,
            approvedDigit: evidence.candidate, confidence: evidence.confidence,
            holdoutAccuracy: evidence.holdoutAccuracy, holdoutSamples: evidence.holdoutSamples,
            outcomeDigit: null, hit: null,
          });
        }
        if (active) setPaperLedger(rows);
      } catch {
        // Permit retry for this tick if browser storage temporarily fails.
        if (processedTickRef.current === key) processedTickRef.current = "";
      }
    };
    void run();
    return () => {
      active = false;
      if (processedTickRef.current === key) processedTickRef.current = "";
    };
  }, [ticks, market, connection]);

  useEffect(() => {
    let active = true;
    setStorageStatus("LOCAL ARCHIVE · LOADING");
    loadTicks(market, 5000).then((saved) => {
      if (!active) return;
      setTicks((current) => {
        const merged = new Map<string, TickPoint>();
        for (const point of saved) merged.set(`${point.epoch}:${point.quote}`, point);
        for (const point of current) merged.set(`${point.epoch}:${point.quote}`, point);
        return [...merged.values()].sort((a, b) => a.epoch - b.epoch).slice(-MAX_TICKS);
      });
      return countTicks(market).then((count) => {
        if (active) {
          setStoredTickCount(count);
          setStorageStatus("LOCAL ARCHIVE · SAVING");
        }
      });
    }).catch(() => {
      if (active) setStorageStatus("LOCAL ARCHIVE · UNAVAILABLE");
    });
    return () => { active = false; };
  }, [market]);

  useEffect(() => {
    if (!connectRequested) return;

    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let responseTimer: ReturnType<typeof setTimeout> | undefined;
    let liveWatchdog: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let pingSentAt: number | null = null;
    let streamRequested = false;
    const maxDelay = 30000;
    const armLiveWatchdog = () => {
      if (liveWatchdog) clearTimeout(liveWatchdog);
      liveWatchdog = setTimeout(() => {
        if (active && socket?.readyState === WebSocket.OPEN) {
          setFeedError("No live tick has arrived for 20 seconds. Reconnecting to restore the feed.");
          socket.close(4003, "Live tick timeout");
        }
      }, 20000);
    };

    const connect = () => {
      if (!active) return;
      setConnection(attempts === 0 ? "CONNECTING" : `RECONNECTING · ${attempts}`);
      setNote("Connecting to Deriv's current public market-data WebSocket…");
      setFeedError("");
      setLastResponse("WAITING FOR DERIV RESPONSE");
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
        setConnection("CONNECTED · CHECKING MARKETS");
        setNote("Connected. Checking Deriv's active-symbol list before subscribing…");
        socket?.send(JSON.stringify({ ping: 1, req_id: PING_REQ }));
        socket?.send(JSON.stringify({ active_symbols: "brief", req_id: SYMBOLS_REQ }));
        if (responseTimer) clearTimeout(responseTimer);
        responseTimer = setTimeout(() => {
          if (active && socket?.readyState === WebSocket.OPEN && verifiedSymbols.length === 0) {
            setFeedError("Deriv WebSocket opened, but no active-symbol response arrived within 8 seconds. This is an API-response timeout, not a market-symbol rejection.");
            setNote("Connection is open but the server has not answered active_symbols. Check the raw response status below.");
            setLastResponse("TIMEOUT · NO active_symbols RESPONSE");
            socket?.close(4002, "No active-symbol response");
          }
        }, 8000);
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
          setLastResponse(`RECEIVED ${message.msg_type || "MESSAGE"}${message.req_id !== undefined ? ` · req_id ${message.req_id}` : ""}`);
          if (message.error) {
            const detail = `${message.error.code || "API_ERROR"}: ${message.error.message || "Deriv rejected the request"}`;
            setFeedError(detail);
            setNote(`Deriv returned an API error: ${detail}`);
            if (message.req_id === SYMBOLS_REQ || message.req_id === STREAM_REQ) {
              socket?.close(4000, "Deriv API request rejected");
            }
            return;
          }

          if (message.msg_type === "ping") {
            if (pingSentAt !== null) setLatency(Date.now() - pingSentAt);
          }

          if (message.msg_type === "active_symbols" || (message.req_id === SYMBOLS_REQ && Array.isArray(message.active_symbols))) {
            if (responseTimer) clearTimeout(responseTimer);
            const symbols = (message.active_symbols || []).map((item: { symbol?: string; underlying_symbol?: string }) => item.underlying_symbol || item.symbol).filter(Boolean) as string[];
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
              armLiveWatchdog();
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

            saveTicks(market, history).then(() => countTicks(market)).then(setStoredTickCount).catch(() => setStorageStatus("LOCAL ARCHIVE · SAVE FAILED"));
            setTicks((current) => {
              const merged = new Map<string, TickPoint>();
              for (const item of history) merged.set(`${item.epoch}:${item.quote}`, item);
              for (const item of current) merged.set(`${item.epoch}:${item.quote}`, item);
              return [...merged.values()].sort((a, b) => a.epoch - b.epoch).slice(-MAX_TICKS);
            });
            setConnection("HISTORY LOADED · WAITING FOR LIVE TICK");
            setNote("Historical sample loaded. Waiting for the first real-time tick before marking the feed LIVE.");
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
            saveTicks(market, [item]).then(() => countTicks(market)).then(setStoredTickCount).catch(() => setStorageStatus("LOCAL ARCHIVE · SAVE FAILED"));
            setTicks((current) => {
              const next = current.filter((old) => !(old.epoch === item.epoch && old.quote === item.quote));
              return [...next, item].sort((a, b) => a.epoch - b.epoch).slice(-MAX_TICKS);
            });
            setLastTickAt(Date.now());
            setClockNow(Date.now());
            attempts = 0;
            armLiveWatchdog();
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
        if (liveWatchdog) clearTimeout(liveWatchdog);
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
      if (responseTimer) clearTimeout(responseTimer);
      if (liveWatchdog) clearTimeout(liveWatchdog);
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

  const ageSeconds = lastTickAt === null ? null : Math.max(0, Math.floor((clockNow - lastTickAt) / 1000));

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
          <select id="market" value={market} onChange={(event) => { setConnection("CONNECTING"); setTicks([]); setLastTickAt(null); setLatency(null); processedTickRef.current = ""; setMarket(event.target.value); }}>
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
        <div><span>SERVER RESPONSE</span><b>{lastResponse}</b></div>
        <div><span>RESEARCH ARCHIVE</span><b>{storageStatus}</b></div>\n        <div><span>SAVED TICKS · THIS DEVICE</span><b>{storedTickCount.toLocaleString()}</b></div>
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
          <p className="eyebrow">LIVE MARKET ANALYSIS</p><h2>Market review</h2>
          <div className="no-signal">{review.status}</div>
          <p className="muted">{review.summary}</p>
          <div className="divider" />
          <div className="metric"><span>Sample size</span><b>{review.sample} TICKS</b></div>
          <div className="metric"><span>Uniformity test · χ²</span><b>{review.sample ? review.chiSquare.toFixed(2) : "—"}</b></div>
          <div className="metric"><span>Largest digit deviation</span><b>{review.sample ? `${review.maxDeviation.toFixed(1)} pp` : "—"}</b></div>
          <div className="metric"><span>Distribution entropy</span><b>{review.sample ? `${(review.entropy * 100).toFixed(1)}% of max` : "—"}</b></div>
          <div className="metric"><span>Adjacent repeat rate</span><b>{review.sample > 1 ? `${review.repeatRate.toFixed(1)}%` : "—"}</b></div>
          <div className="metric"><span>Longest same-digit run</span><b>{review.sample ? review.longestStreak : "—"}</b></div>
          <div className="metric"><span>Recent-vs-prior shift</span><b>{review.sample >= 500 ? `${review.recentShift.toFixed(1)} pp` : "NEED 500 TICKS"}</b></div>
          <div className="divider" />
          <p className="eyebrow">SEQUENCE HYPOTHESIS SCAN</p>
          <div className="metric"><span>Strongest observed transition</span><b>{review.transitionLabel}</b></div>
          <div className="metric"><span>Conditional frequency</span><b>{review.transitionSupport >= 30 ? `${(review.transitionProbability * 100).toFixed(1)}%` : "INSUFFICIENT DATA"}</b></div>
          <div className="metric"><span>Same target&apos;s sample baseline</span><b>{review.transitionSupport >= 30 ? `${(review.transitionBaseline * 100).toFixed(1)}%` : "—"}</b></div>
          <div className="metric"><span>Observed lift</span><b>{review.transitionSupport >= 30 ? `${review.transitionLift.toFixed(2)}×` : "—"}</b></div>
          <p className="muted analysis-footnote">The χ² comparison uses a 10% uniform reference (9 degrees of freedom; 16.92 is a conventional 5% reference threshold). The transition scan selects the strongest of 100 in-sample pairs, so apparent lift is especially prone to chance and multiple-testing bias. Neither metric predicts the next digit. Only chronological out-of-sample testing can validate an edge.</p>
        </aside>
      </section>


      <section className="panel ai-panel">
        <div className="section-heading">
          <div><p className="eyebrow">CSPRNG-AWARE · ADAPTIVE STATISTICAL SCANNER</p><h2>One-tick prediction evidence</h2></div>
          <span className="tag">EXPANDING WALK-FORWARD</span>
        </div>
        <div className="ai-status">{aiReview.status}</div>
        <div className="ai-grid">
          <div><span>Next-tick candidate</span><b>{aiReview.candidate === null ? "NO SIGNAL" : aiReview.candidate}</b></div>
          <div><span>Current trigger digit</span><b>{aiReview.triggerDigit === null ? "—" : aiReview.triggerDigit}</b></div>
          <div><span>Smoothed conditional estimate</span><b>{aiReview.support ? `${aiReview.confidence.toFixed(1)}%` : "—"}</b></div>
          <div><span>Trigger support</span><b>{aiReview.support}</b></div>
          <div><span>Walk-forward accuracy</span><b>{aiReview.holdoutSamples ? `${aiReview.holdoutAccuracy.toFixed(1)}%` : "—"}</b></div>
          <div><span>95% lower confidence bound</span><b>{aiReview.holdoutSamples ? `${aiReview.lowerBound.toFixed(1)}%` : "—"}</b></div>
          <div><span>Evaluated unseen predictions</span><b>{aiReview.holdoutSamples}</b></div>
          <div><span>Random baseline</span><b>10.0%</b></div>
          <div><span>Observed lift vs baseline</span><b>{aiReview.holdoutSamples ? `${aiReview.lift.toFixed(2)}×` : "—"}</b></div>
        </div>
        <div className="window-heading"><span>ROLLING RANDOMNESS DIAGNOSTICS</span><small>Latest ticks · max 1,000</small></div>
        <div className="window-grid">
          {aiReview.windows.map((window) => <div className="window-card" key={window.size}>
            <b>{window.size.toLocaleString()}</b><small>TICK WINDOW</small>
            <span>{window.sample} observed</span>
            <span>χ² {window.sample ? window.chiSquare.toFixed(1) : "—"}</span>
            <span>Repeat {window.sample > 1 ? `${window.repeatRate.toFixed(1)}%` : "—"}</span>
            <span>Entropy {window.sample ? `${window.entropy.toFixed(1)}%` : "—"}</span>
            <em>{window.status}</em>
          </div>)}
        </div>
        <p className="muted">{aiReview.explanation}</p>
        <p className="analysis-footnote">{aiReview.randomnessNote} A high chi-square score, unusual repeat rate or apparent transition can occur by chance, especially across many windows and markets. These diagnostics do not expose or reverse-engineer Deriv&apos;s CSPRNG and cannot guarantee the next digit. Three-tick forecasts remain disabled until the one-tick model demonstrates repeatable out-of-sample performance.</p>
      </section>


      <section className="panel paper-panel">
        <div className="section-heading">
          <div><p className="eyebrow">AUTONOMOUS DECISION ENGINE · SIMULATION ONLY</p><h2>TRADE / WAIT / NO TRADE</h2></div>
          <span className="tag">REAL ORDERS DISABLED</span>
        </div>
        <p className="muted">DigitLab records one decision for each newly observed tick. The following tick settles the prediction. TRADE is a paper-only candidate that passed the current evidence gate; WAIT means insufficient evaluation data; NO TRADE means the gate was not passed. No Deriv contract is submitted.</p>
        <div className="paper-summary">
          <div><span>TRADE DECISIONS</span><b>{paperLedger.filter((x) => x.decision === "TRADE").length}</b></div>
          <div><span>TRADE WINS</span><b>{paperLedger.filter((x) => x.decision === "TRADE" && x.hit === true).length}</b></div>
          <div><span>TRADE LOSSES</span><b>{paperLedger.filter((x) => x.decision === "TRADE" && x.hit === false).length}</b></div>
          <div><span>SETTLED TRADE ACCURACY</span><b>{(() => { const done = paperLedger.filter((x) => x.decision === "TRADE" && x.hit !== null); return done.length ? `${(done.filter((x) => x.hit).length / done.length * 100).toFixed(1)}%` : "—"; })()}</b></div>
          <div><span>SHADOW CANDIDATE HIT RATE</span><b>{(() => { const done = paperLedger.filter((x) => x.proposedDigit !== null && x.outcomeDigit !== null); return done.length ? `${(done.filter((x) => x.proposedDigit === x.outcomeDigit).length / done.length * 100).toFixed(1)}%` : "—"; })()}</b></div>
          <div><span>WAIT / NO TRADE</span><b>{paperLedger.filter((x) => x.decision !== "TRADE").length}</b></div>
        </div>
        <div className="paper-table">
          <div className="paper-row paper-head"><span>TIME</span><span>DECISION</span><span>TRIGGER</span><span>PROPOSED → ACTUAL</span><span>RESULT</span></div>
          {paperLedger.slice(-12).reverse().map((row) => <div className="paper-row" key={row.id}>
            <span>{new Date(row.tickEpoch * 1000).toLocaleTimeString()}</span>
            <b className={`decision-${row.decision.toLowerCase()}`}>{row.decision}</b>
            <span>{row.triggerDigit ?? "—"}</span>
            <span>{row.proposedDigit ?? "—"} → {row.outcomeDigit ?? "PENDING"}</span>
            <span>{row.hit === null ? (row.outcomeDigit === null ? "PENDING" : "NOT TRADED") : row.hit ? "HIT" : "MISS"}</span>
          </div>)}
          {!paperLedger.length && <p className="muted">Waiting for the next live tick to start the paper decision ledger.</p>}
        </div>
        <p className="analysis-footnote">This ledger is stored locally in this browser and device. The shadow-candidate hit rate measures rejected as well as approved candidates separately. Paper accuracy is not profitability: Deriv contract payout, spread and settlement rules are not simulated here.</p>
      </section>

      <section className="panel methodology">
        <div><p className="eyebrow">METHODOLOGY</p><h2>Frequency is not a forecast.</h2></div>
        <p>The live review measures distribution departure, entropy, repeats, streaks, sample drift and the strongest observed one-step digit transition. Transition lift is a hypothesis generator only—not a signal. This first research archive stores timestamped ticks locally in this browser on this device; it is not yet a shared cloud database and will not follow you to another device or browser. Collect up to 1,000 recent ticks per market by selecting it and leaving the feed connected. The scanner evaluates a one-tick candidate with expanding-window walk-forward testing and abstains unless its conservative confidence bound clears the 10% baseline. The browser archive remains local to this device.</p>
      </section>
      <footer><span>DIGITLAB PREDICTOR</span><span>DERIV PUBLIC MARKET DATA · READ ONLY · PAPER DECISIONS ACTIVE · REAL TRADING DISABLED</span></footer>
    </main>
  );
}
