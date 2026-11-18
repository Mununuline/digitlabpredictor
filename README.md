# Digit Radar

A trading workspace for Deriv digit contracts on the synthetic volatility indices: market scans, a trade journal, and rule-following robots that run on paper or on your Deriv account.

## What it does

- **Scan**: pick a market, tap Scan on a contract card (Matches, Differs, Even, Odd, Over, Under) and get a decision digit with a strength rating.
- **Trade**: manual Matches/Differs. Digits shown with their share of recent ticks (green most often, red least, cream latest tick), target digit, 1/2/5/10 ticks, stake and a max loss that locks trading when reached. Paper or your Deriv account.
- **Robots**: connect a Deriv account, pick a strategy (Adaptive, Differs Guard, Even/Odd Lean, Over/Under Barrier, Matches Hunter), set limits, press Start. A deep scan ranks all ten volatility markets. Auto market mode moves the robot to the best-ranked one and rescans every 5 minutes.
- **Analysis, Journal, Setup**: distribution and skew tests, break-even economics, paper test, a journal that compares your results with luck, and an optional Claude analyst.

## Deep scan and Matches

- Reads up to 5000 ticks per market from Deriv's public feed (no login needed), or streams all ten markets live so rescans are instant.
- The Matches deep scan tests the most frequent digit in every market against a threshold that allows for comparing 100 digit-market pairs, checks that the digit still stands out in a half of the data it was not chosen from, and replays "pick the hot digit of the previous 500 ticks" across the whole history to get an out-of-sample hit rate against the 10.5% break-even.
- For random digits, expect "None" almost everywhere. A real edge would pass again on a later scan.

## Honest limits

- The last digit of a Deriv synthetic index is random. Nothing here predicts it, and no win rate is promised.
- Deriv pays slightly less than fair odds, so rule-following loses a small amount on average. Robots limit the cost; they do not remove it.
- Adaptive re-tests every rule on recent ticks and **sits out when none beats break-even**. That is the adaptation, and it is most of the time.
- Stakes are fixed. There is no martingale or recovery staking. Stop loss, target profit, max consecutive losses and max trades are always on.
- Stop and loss limits run in your browser tab. Closing the tab stops the robot, but an already open contract still settles at Deriv.
- The Deriv connection was tested against a mock of Deriv's API, not the live service. Start on demo and read the connection log (Robots, Deriv account).

## Run it

Node 18 or newer, nothing to install:

```
cp .env.example .env     # fill it in
npm start                # http://localhost:3000
```

## Connect Deriv

1. In your Deriv account, register an app to get an app id, and create an API token with **Read and Trade scopes only**. Never tick Payments or Admin.
2. Set in `.env` or your host: `APP_PASSWORD` (required for trading), `DERIV_API_TOKEN`, `DERIV_APP_ID`, `DERIV_ACCOUNT_DEMO`.
3. Find your account ids: `curl -H "x-app-password: YOURPASSWORD" https://YOURSITE/api/deriv/accounts`.
4. Open Robots, enter the password at the top, choose Demo account, Connect.

The token never reaches the browser. The server trades only through a one-time connection URL.

**Real money is off by default.** To allow it you must set `DERIV_ALLOW_REAL=1` and `DERIV_ACCOUNT_REAL` on the server, then tick the confirmation box and tap Start twice in the page. `MAX_STAKE` (default 10) caps every trade.

Optional: `ANTHROPIC_API_KEY` turns on the analyst.

## Put it online with Vercel (no GitHub needed)

From the unzipped folder, in a terminal (Node 18+):

```
npx vercel          # log in when asked, accept the defaults, creates the project
npx vercel --prod   # publishes it
```

Then in the Vercel dashboard, open the project, go to Settings, Environment Variables, and add `APP_PASSWORD`, `DERIV_API_TOKEN`, `DERIV_APP_ID`, `DERIV_ACCOUNT_DEMO` (and optionally `ANTHROPIC_API_KEY`). Run `npx vercel --prod` once more so they take effect.

On Vercel each request may run on a fresh server, so the failed-password lockout and rate limits are best-effort. Use a long `APP_PASSWORD`.

## Put it online elsewhere

Render (`render.yaml`), Railway, Fly.io, or Docker (`Dockerfile`). Set the environment variables above in the host's dashboard. Always set `APP_PASSWORD` before sharing the link.

## Files

- `server.js`: static site, analyst proxy, Deriv one-time-connection and account routes.
- `public/index.html`: the whole app.
- `.env.example`, `Dockerfile`, `render.yaml`.
