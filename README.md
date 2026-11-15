# DigitLab Predictor

A research-first Deriv synthetic-index last-digit analysis application.

## Product principles

1. **Accuracy first.**
2. **Selectivity second.**
3. **Prediction volume last.**

DigitLab distinguishes descriptive statistics from genuine out-of-sample predictive evidence. Historical digit frequency is not a next-tick prediction. When evidence is insufficient, the application must return **NO SIGNAL**.

## Safety boundaries

- No real-money trading or trade placement.
- Demo account support only, with strict VRTC account-ID enforcement.
- Never expose OAuth tokens, client secrets, or credentials in browser code or source control.
- Live data, OAuth, and balance are not labelled verified until a successful connection and response have actually been observed.

## Roadmap

- [ ] Next.js application shell and analysis dashboard.
- [ ] Resilient Deriv public tick-stream client.
- [ ] Rolling digit statistics with transparent sample sizes.
- [ ] Walk-forward, out-of-sample evaluation against the 10% uniform baseline.
- [ ] Selective signal rules; default to NO SIGNAL when evidence is weak.
- [ ] Demo-only OAuth and authenticated balance display.
- [ ] AI-assisted explanations grounded in measured data.

No accuracy claim should be made until independently evaluated on unseen observations.