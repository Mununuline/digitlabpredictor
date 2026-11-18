'use strict';
// Digit Radar server. No dependencies.
// - Serves the page.
// - Proxies analyst questions to the Anthropic API (the API key never reaches the browser).
// - Hands the browser a one-time Deriv trading WebSocket URL. The Deriv token never leaves this server.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* no .env file, use real environment */ }

const env = process.env;
const PORT = Number(env.PORT) || 3000;
const KEY = env.ANTHROPIC_API_KEY || '';
const MODEL = env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const PASS = env.APP_PASSWORD || '';
const PUBLIC = path.join(__dirname, 'public');

const D = {
  token: env.DERIV_API_TOKEN || '',
  appId: env.DERIV_APP_ID || '',
  demo: env.DERIV_ACCOUNT_DEMO || '',
  real: env.DERIV_ACCOUNT_REAL || '',
  allowReal: env.DERIV_ALLOW_REAL === '1',
  maxStake: Number(env.MAX_STAKE) > 0 ? Number(env.MAX_STAKE) : 10,
  base: (env.DERIV_API_BASE || 'https://api.derivws.com').replace(/\/+$/, '')
};
const WS_PREFIX = 'wss://api.derivws.com/';
const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;

function tradingStatus() {
  const s = { configured: false, demo: false, real: false, maxStake: D.maxStake, reason: '' };
  if (!PASS) s.reason = 'Set APP_PASSWORD on the server before turning trading on.';
  else if (!D.token || !D.appId) s.reason = 'Add DERIV_API_TOKEN and DERIV_APP_ID to the server settings.';
  else {
    s.demo = ID_RE.test(D.demo);
    s.real = D.allowReal && ID_RE.test(D.real);
    s.configured = s.demo || s.real;
    if (!s.configured) s.reason = 'Add DERIV_ACCOUNT_DEMO (and DERIV_ACCOUNT_REAL with DERIV_ALLOW_REAL=1 for real money).';
  }
  return s;
}

const SYSTEM = 'You are the analyst inside Digit Radar, a tool for traders of Deriv digit contracts (Matches, Differs, Over, Under, Even and Odd) on synthetic volatility indices. ' +
  'Facts you must respect: these indices come from a random number generator, last digits are independent and uniform, and no past pattern predicts the next digit. ' +
  'Never claim to predict a digit, never promise profit, never say a digit is due. ' +
  'Help the trader decide using only the numbers in the snapshot: say whether the sample shows any skew beyond chance (chi-square against the 5 percent critical value), compare the sample win rate with the break-even win rate, read the paper test only as far as its trade count supports, treat volatility as context only, and when realTrades has logged trades, compare the real net result of the trader with the fair-odds expectation and say plainly when it sits inside the range of luck. If scanResults are present, discuss them, and remind the trader that the most frequent digit, the least frequent digit and the best barrier are all picked from the same data, so some apparent strength appears by chance. ' +
  'If the data source is simulated ticks, say the stats come from simulated ticks. ' +
  'Open with a one-line verdict, for example: No edge shown. Skip this trade. Then give 2 to 4 short points and one concrete risk suggestion such as stake as a small share of balance, a loss limit, a trade cap, or stopping after a losing streak. ' +
  'Plain text only, no markdown, under 200 words.';

// ---- small helpers ----
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, max) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > max) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}
// Behind one proxy (Render, Railway, Fly) the last X-Forwarded-For entry is the real client.
function clientIp(req) {
  const parts = String(req.headers['x-forwarded-for'] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : (req.socket.remoteAddress || '');
}
const buckets = new Map();
function limited(name, ip, max, windowMs) {
  const key = name + '|' + ip, now = Date.now();
  const list = (buckets.get(key) || []).filter(function (t) { return now - t < windowMs; });
  list.push(now); buckets.set(key, list);
  return list.length > max;
}
setInterval(function () { buckets.clear(); fails.clear(); }, 15 * 60 * 1000).unref();

const fails = new Map();
function passOk(req) {
  const a = crypto.createHash('sha256').update(String(req.headers['x-app-password'] || '')).digest();
  const b = crypto.createHash('sha256').update(PASS).digest();
  return crypto.timingSafeEqual(a, b);
}
// Returns true when the caller may continue. When no APP_PASSWORD is set, only the analyst is open.
function checkAuth(req, res) {
  if (!PASS) return true;
  const ip = clientIp(req), now = Date.now();
  const list = (fails.get(ip) || []).filter(function (t) { return now - t < 600000; });
  if (list.length >= 10) { send(res, 429, { error: 'Too many wrong passwords. Wait ten minutes.' }); return false; }
  if (passOk(req)) return true;
  list.push(now); fails.set(ip, list);
  send(res, 401, { error: 'Wrong or missing access password.' });
  return false;
}

// ---- analyst ----
async function analyze(req, res) {
  if (!checkAuth(req, res)) return;
  if (!KEY) return send(res, 503, { error: 'The analyst is not set up. Add ANTHROPIC_API_KEY to the server settings and restart.' });
  if (limited('analyze', clientIp(req), 8, 60000)) return send(res, 429, { error: 'Too many questions in a short time. Wait a minute and try again.' });

  let data;
  try { data = JSON.parse(await readBody(req, 20000)); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
  const q = typeof data.question === 'string' ? data.question.slice(0, 400) : '';
  if (!q || !data.snapshot || typeof data.snapshot !== 'object') return send(res, 400, { error: 'Missing question or snapshot.' });
  const snap = JSON.stringify(data.snapshot);
  if (snap.length > 9000) return send(res, 400, { error: 'Snapshot too large.' });

  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, 40000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 600, system: SYSTEM,
        messages: [{ role: 'user', content: 'Trader question: ' + q + '\n\nSnapshot JSON:\n' + snap }]
      })
    });
    const out = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      console.error('Anthropic API error', r.status, out && out.error && out.error.message);
      const msg = r.status === 401 ? 'The server API key was rejected. Check ANTHROPIC_API_KEY.'
        : r.status === 429 ? 'The analyst is busy. Try again in a moment.'
        : 'The analyst is unavailable right now. Try again shortly.';
      return send(res, 502, { error: msg });
    }
    const text = (out.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
    return send(res, 200, { text: text || 'The analyst returned an empty answer. Ask again.' });
  } catch (e) {
    console.error('Analyst request failed', e && e.message);
    return send(res, 502, { error: 'The analyst is unavailable right now. Try again shortly.' });
  } finally { clearTimeout(timer); }
}

// ---- Deriv ----
async function derivCall(method, p) {
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, 15000);
  try {
    const r = await fetch(D.base + p, {
      method: method, signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + D.token, 'Deriv-App-ID': D.appId }
    });
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    return { status: r.status, body: body };
  } finally { clearTimeout(timer); }
}
function derivError(body, status) {
  let m = '';
  if (body && typeof body === 'object') {
    m = (body.error && (body.error.message || body.error.code)) || body.message || (body.errors && body.errors[0] && (body.errors[0].message || body.errors[0].detail)) || '';
  }
  return 'Deriv refused the request (' + status + ').' + (m ? ' ' + String(m).slice(0, 200) : '');
}
function tradingGate(req, res) {
  if (!checkAuth(req, res)) return false;
  const s = tradingStatus();
  if (!PASS) { send(res, 403, { error: s.reason }); return false; }
  if (!D.token || !D.appId) { send(res, 503, { error: s.reason }); return false; }
  return true;
}
async function derivAccounts(req, res) {
  if (!tradingGate(req, res)) return;
  if (limited('accounts', clientIp(req), 10, 60000)) return send(res, 429, { error: 'Too many requests. Wait a minute.' });
  try {
    const r = await derivCall('GET', '/trading/v1/options/accounts');
    return send(res, 200, { status: r.status, body: r.body });
  } catch (e) { return send(res, 502, { error: 'Could not reach Deriv.' }); }
}
async function derivOtp(req, res) {
  if (!tradingGate(req, res)) return;
  const s = tradingStatus();
  if (!s.configured) return send(res, 503, { error: s.reason });
  if (limited('otp', clientIp(req), 8, 60000)) return send(res, 429, { error: 'Too many connection attempts. Wait a minute.' });
  let data;
  try { data = JSON.parse(await readBody(req, 2000)); } catch (e) { return send(res, 400, { error: 'Bad request.' }); }
  const mode = data && data.mode === 'real' ? 'real' : 'demo';
  if (mode === 'real' && !s.real) return send(res, 403, { error: 'Real-money trading is switched off on this server. Set DERIV_ALLOW_REAL=1 and DERIV_ACCOUNT_REAL to enable it.' });
  if (mode === 'demo' && !s.demo) return send(res, 403, { error: 'No demo account is set. Add DERIV_ACCOUNT_DEMO.' });
  const id = mode === 'real' ? D.real : D.demo;
  try {
    const r = await derivCall('POST', '/trading/v1/options/accounts/' + encodeURIComponent(id) + '/otp');
    const url = r.body && r.body.data && r.body.data.url;
    if (r.status < 200 || r.status >= 300 || typeof url !== 'string') return send(res, 502, { error: derivError(r.body, r.status) });
    if (url.indexOf(WS_PREFIX) !== 0 || url.indexOf(mode === 'real' ? '/ws/real' : '/ws/demo') < 0) return send(res, 502, { error: 'Deriv returned an unexpected connection URL.' });
    return send(res, 200, { url: url, mode: mode });
  } catch (e) {
    console.error('OTP request failed', e && e.message);
    return send(res, 502, { error: 'Could not reach Deriv.' });
  }
}

// ---- static files ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' wss://api.derivws.com wss://ws.derivws.com; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function handler(req, res) {
  const url = (req.url || '/').split('?')[0];
  if (url === '/api/analyze') return req.method === 'POST' ? analyze(req, res) : send(res, 405, { error: 'Use POST.' });
  if (url === '/api/deriv/otp') return req.method === 'POST' ? derivOtp(req, res) : send(res, 405, { error: 'Use POST.' });
  if (url === '/api/deriv/accounts') return req.method === 'GET' ? derivAccounts(req, res) : send(res, 405, { error: 'Use GET.' });
  if (url === '/api/config') return send(res, 200, { analyst: !!KEY, passwordRequired: !!PASS, trading: tradingStatus() });
  if (url === '/api/health') return send(res, 200, { ok: true });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (file.indexOf(PUBLIC + path.sep) !== 0) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'content-security-policy': CSP
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}


module.exports = handler;

if (require.main === module) http.createServer(handler).listen(PORT, function () {
  const t = tradingStatus();
  console.log('Digit Radar running at http://localhost:' + PORT);
  console.log(KEY ? 'Analyst: on (' + MODEL + ')' : 'Analyst: off, add ANTHROPIC_API_KEY');
  console.log(t.configured ? 'Trading: demo ' + (t.demo ? 'on' : 'off') + ', real ' + (t.real ? 'ON' : 'off') + ', max stake ' + t.maxStake : 'Trading: off. ' + t.reason);
  if (!PASS) console.log('Warning: no APP_PASSWORD set. Set one before putting this site online.');
});
