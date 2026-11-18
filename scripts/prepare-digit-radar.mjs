import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
const root = process.cwd();
const archive = resolve(root, "digit-radar-final.zip");
const htmlPath = resolve(root, "public/digitlab.html");
const temp = resolve(root, ".digit-radar-build");
mkdirSync(dirname(htmlPath), { recursive: true });
execFileSync("unzip", ["-oq", archive, "digit-radar-app/public/index.html", "-d", temp]);
let html = readFileSync(resolve(temp, "digit-radar-app/public/index.html"), "utf8");
function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error("Digit Radar patch target missing: " + label);
  return source.replace(before, after);
}
function replaceBlock(source, start, end, replacement, label) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error("Digit Radar block missing: " + label);
  return source.slice(0, a) + replacement + "\n\n" + source.slice(b);
}
html = replaceOnce(html, "<title>Digit Radar</title>", "<title>DigitLab Predictor</title>", "title");
html = replaceOnce(html, "<h1>Digit Radar</h1>", "<h1>DigitLab Predictor</h1>", "brand");
html = replaceOnce(html, "Last-digit statistics, volatility and entry checks for Matches and Differs on Deriv volatility indices.", "Evidence-first last-digit analysis for Deriv synthetic indices. Demo trading only.", "tagline");
html = replaceOnce(html, '<label for="appPw" id="pwRow" hidden style="min-width:200px">Access password<input id="appPw" type="password" autocomplete="current-password"></label>', "", "password field");
html = replaceOnce(html, '<select id="tMode"><option value="demo">Demo account</option><option value="real">Real money account</option></select>', '<select id="tMode"><option value="">Loading demo accounts…</option></select>', "demo account selector");
html = replaceOnce(html, '<div class="banner" id="tBanner" hidden>REAL MONEY ACCOUNT. Trades use real funds.</div>', "", "real money banner");
html = replaceOnce(html, '<label class="chk" id="tRealL" hidden><input type="checkbox" id="tReal"> I understand this trades real money</label>', "", "real money confirmation");
html = replaceOnce(html, "Claude reads the numbers on this page and gives a risk-first view. It cannot see the next tick and will say so.", "Evidence-first analysis of the visible sample. Historical frequencies do not predict the next tick.", "analyst copy");
html = replaceBlock(html, "  function pwHeaders() {", "  function tlog(x) {", [
"  function pwHeaders() {",
"    return { 'content-type': 'application/json' };",
"  }"
].join("\n"), "password headers");
html = replaceBlock(html, "  function loadConfig() {", "  function tsend(obj, cb) {", [
"  var demoAccounts = [];",
"  function loadConfig() {",
"    fetch('/api/deriv/session', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {",
"      demoAccounts = Array.isArray(j.accounts) ? j.accounts : [];",
"      cfg = { trading: { configured: demoAccounts.length > 0, demo: demoAccounts.length > 0, real: false, reason: j.error || 'Sign in to Deriv to load your demo accounts.' } };",
"      var select = $('tMode'), previous = select.value;",
"      select.innerHTML = '';",
"      if (!demoAccounts.length) { var empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Sign in to load demo accounts'; select.appendChild(empty); }",
"      else { demoAccounts.forEach(function (account) { var option = document.createElement('option'); option.value = account.accountId; option.textContent = account.accountId + ' · ' + account.balance.toFixed(2) + ' ' + account.currency; select.appendChild(option); }); if (demoAccounts.some(function (a) { return a.accountId === previous; })) select.value = previous; }",
"      renderAcct();",
"    }).catch(function () { cfg = { trading: { configured: false, demo: false, real: false, reason: 'Could not check the Deriv session.' } }; renderAcct(); });",
"  }",
"  function renderAcct() {",
"    var T = cfg && cfg.trading, connected = !!(tr.ws && tr.ws.readyState === 1 && tr.cur), hasSession = !!(demoAccounts && demoAccounts.length);",
"    $('tConnect').disabled = !!tr.ws && !connected;",
"    $('tConnect').textContent = tr.ws ? 'Disconnect' : hasSession ? 'Connect demo account' : 'Sign in with Deriv';",
"    $('tMode').disabled = !!tr.ws || !hasSession;",
"    $('tBal').textContent = connected && tr.bal != null ? tr.bal.toFixed(2) + ' ' + tr.cur : '';",
"    if (!tr.ws) $('tStatus').textContent = !hasSession ? (T && T.reason ? T.reason : 'Sign in with Deriv to select a demo account.') : 'Demo account ready. Connect to enable demo trading.';",
"    else if (connected) $('tStatus').textContent = 'Connected to Deriv demo. Balance updates live.';",
"    var ro = $('bRun').options[1]; ro.disabled = !connected;",
"    if (!connected && $('bRun').value === 'deriv' && !bot.on) $('bRun').value = 'paper';",
"    renderBotPct();",
"  }"
].join("\n"), "OAuth account/session integration");
html = replaceBlock(html, "  async function tConnect() {", "  /* ----- executors: paper and Deriv ----- */", [
"  async function tConnect() {",
"    if (tr.ws) { tDisconnect('Disconnected.'); return; }",
"    $('tStatus').textContent = 'Checking your Deriv demo session…';",
"    var session;",
"    try { var sr = await fetch('/api/deriv/session', { cache: 'no-store' }); session = await sr.json(); }",
"    catch (e) { $('tStatus').textContent = 'Could not reach the DigitLab server.'; return; }",
"    demoAccounts = Array.isArray(session.accounts) ? session.accounts : [];",
"    if (!session.connected || !demoAccounts.length) { window.top.location.href = '/api/deriv/oauth/start'; return; }",
"    var accountId = $('tMode').value || demoAccounts[0].accountId;",
"    $('tStatus').textContent = 'Requesting a one-time demo connection from Deriv…';",
"    var r = null, j = {};",
"    try { r = await fetch('/api/deriv/otp', { method: 'POST', headers: pwHeaders(), body: JSON.stringify({ accountId: accountId }) }); } catch (e) { r = null; }",
"    if (!r) { $('tStatus').textContent = 'Could not reach the DigitLab server.'; return; }",
"    try { j = await r.json(); } catch (e) { j = {}; }",
"    if (r.status === 401) { window.top.location.href = '/api/deriv/oauth/start'; return; }",
"    if (!r.ok || !j.url) { $('tStatus').textContent = j.error || 'Deriv did not give a demo connection URL.'; tlog('demo otp ' + r.status + ' ' + JSON.stringify(j).slice(0, 200)); return; }",
"    var sock; try { sock = new WebSocket(j.url); } catch (e) { $('tStatus').textContent = 'Could not open the Deriv demo connection.'; return; }",
"    tr.ws = sock; tr.mode = 'demo'; tr.bal = null; tr.cur = ''; tr.wait = {}; renderAcct();",
"    sock.onopen = function () { tlog('open demo'); tsend({ balance: 1, subscribe: 1 }); tr.hb = setInterval(function () { tsend({ ping: 1 }); }, 25000); setTimeout(function () { if (tr.ws === sock && !tr.cur) $('tStatus').textContent = 'Connected, but no balance arrived. Open the connection log.'; }, 8000); };",
"    sock.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } tlog((m.msg_type || 'message') + (m.error ? ' ERROR ' + (m.error.code || '') + ' ' + (m.error.message || '') : '')); var b = pick(m, 'balance'); if (b && typeof b === 'object' && b.balance != null) { tr.bal = +b.balance; tr.cur = b.currency || tr.cur; renderAcct(); } var cb = m.req_id && tr.wait[m.req_id]; if (cb && cb(m)) delete tr.wait[m.req_id]; };",
"    sock.onerror = function () { tlog('socket error'); };",
"    sock.onclose = function () { if (tr.ws === sock) { tr.ws = null; tDisconnect('The Deriv demo connection closed.'); } };",
"  }"
].join("\n"), "demo-only Deriv connector");
html = html.replaceAll("digit-radar-pw", "digitlab-unused-password");
html = html.replaceAll("Choose Deriv account to trade for real.", "Connect your Deriv demo account to enable demo trading.");
html = html.replaceAll("This robot will place real trades on your real account.", "This robot will place trades on your Deriv demo account only.");
html = html.replaceAll("REAL money", "DEMO");
html = html.replaceAll("real money", "demo account");
writeFileSync(htmlPath, html);
console.log("Prepared DigitLab Predictor dashboard from the supplied Digit Radar archive.");
