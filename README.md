# DigitLab Predictor

DigitLab Predictor is a Next.js App Router application for research-first last-digit analysis on Deriv synthetic indices.

## Current architecture

- Next.js 15 App Router with React 19.
- Public Deriv market WebSocket for tick history and live market observations.
- Deriv OAuth 2.0 Authorization Code + PKCE for account authentication.
- Encrypted, HTTP-only session cookie; OAuth access tokens are not stored in browser JavaScript.
- Demo accounts only: the account API filters for Deriv accounts explicitly marked `demo`.
- Demo trading credentials are issued through the authenticated Deriv options OTP endpoint and the browser verifies the returned WebSocket path is the demo endpoint before connecting.
- Separate contract scanner and demo bot components for Matches, Differs, Even, Odd, Over and Under.
- Research decisions are not guarantees of future outcomes. No win rate is promised.

## Run locally

Use Node.js 20 or newer.

```bash
npm install
npm run dev
```

## Required Vercel environment variables

Configure these in Vercel Project Settings → Environment Variables:

- `DERIV_OAUTH_CLIENT_ID`
- `DERIV_OAUTH_CLIENT_SECRET` (only if required by your Deriv OAuth app configuration)
- `DERIV_OAUTH_REDIRECT_URI` — currently `https://deriv-digit-lab-kappa.vercel.app/`
- `DERIV_SESSION_SECRET` — a long random secret used to encrypt the server-side session cookie

The app also supports using `DERIV_OAUTH_CLIENT_SECRET` as the session-encryption fallback if `DERIV_SESSION_SECRET` is not set. Keep all secrets server-side. Never add a Deriv API token to the browser or commit secrets to GitHub.

## Deriv sign-in flow

1. The app sends the user to `/api/deriv/oauth/start`.
2. The server creates a random OAuth state and PKCE verifier and stores them in short-lived HTTP-only cookies.
3. Deriv redirects to the configured redirect URI.
4. The app posts the authorization code and state to `/api/deriv/oauth/callback`.
5. The server verifies state, exchanges the code, and stores the access token in an encrypted HTTP-only cookie.
6. `/api/deriv/session` returns demo accounts only.
7. `/api/deriv/otp` verifies the selected account is demo before returning a one-time demo WebSocket URL.

## Build checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Trading safety

- Real-account selection and real-account WebSocket endpoints are not supported by the app's demo bot routes.
- Demo bots remain disarmed until the user explicitly arms them.
- Trade proposals are checked against the scanner's conservative estimate and risk limits before a demo purchase is submitted.
- Statistical confidence is not a guarantee of profit. Synthetic-index last digits may be effectively random; do not assume historical frequencies predict the next tick.

## Deployment

The project is connected to Vercel through GitHub. Pushes to the repair branch should create a Preview deployment. Test the preview before merging or promoting anything to production.
