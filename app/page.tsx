"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [frameKey, setFrameKey] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    if (oauthError) {
      setMessage(params.get("error_description") || oauthError);
      window.history.replaceState({}, "", "/");
      return;
    }
    if (!code || !state) return;
    let active = true;
    setMessage("Completing secure Deriv sign-in…");
    fetch("/api/deriv/oauth/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, state }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Deriv sign-in failed.");
      if (!active) return;
      window.history.replaceState({}, "", "/");
      setMessage("");
      setFrameKey((key) => key + 1);
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : "Deriv sign-in failed.");
      window.history.replaceState({}, "", "/");
    });
    return () => { active = false; };
  }, []);

  return (
    <main style={{ margin: 0, minHeight: "100dvh", background: "#091017" }}>
      {message ? <div role="status" style={{ padding: "18px", color: "#e6edf2", fontFamily: "system-ui" }}>{message}</div> : null}
      <iframe key={frameKey} title="DigitLab Predictor dashboard" src="/digitlab.html"
        style={{ display: "block", width: "100%", height: "100dvh", minHeight: "100vh", border: 0 }}
        allow="clipboard-read; clipboard-write" />
    </main>
  );
}
