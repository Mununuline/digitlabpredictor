import { NextRequest, NextResponse } from "next/server";
import { encryptSession, DERIV_SESSION_COOKIE, sessionCookieOptions } from "@/lib/deriv-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { code?: string; state?: string };
  const expectedState = request.cookies.get("digitlab_oauth_state")?.value;
  const verifier = request.cookies.get("digitlab_pkce_verifier")?.value;
  if (!body.code || !body.state || !expectedState || body.state !== expectedState || !verifier) {
    return NextResponse.json({ error: "OAuth state verification failed. Restart Deriv login." }, { status: 400 });
  }

  const clientId = process.env.DERIV_OAUTH_CLIENT_ID;
  if (!clientId || !(process.env.DERIV_SESSION_SECRET || process.env.DERIV_OAUTH_CLIENT_SECRET)) return NextResponse.json({ error: "Deriv OAuth server configuration is incomplete." }, { status: 503 });
  const redirectUri = process.env.DERIV_OAUTH_REDIRECT_URI || new URL("/", request.url).toString();
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code: body.code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });

  const tokenResponse = await fetch("https://auth.deriv.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    cache: "no-store",
  });
  const tokenData = await tokenResponse.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!tokenResponse.ok || !tokenData.access_token) {
    return NextResponse.json({ error: tokenData.error_description || tokenData.error || "Deriv token exchange failed." }, { status: 502 });
  }

  const expiresIn = Math.max(60, Number(tokenData.expires_in) || 3600);
  const response = NextResponse.json({ connected: true });
  response.cookies.set(DERIV_SESSION_COOKIE, encryptSession({ accessToken: tokenData.access_token, expiresAt: Date.now() + expiresIn * 1000 }), sessionCookieOptions(expiresIn));
  response.cookies.set("digitlab_oauth_state", "", { path: "/", maxAge: 0 });
  response.cookies.set("digitlab_pkce_verifier", "", { path: "/", maxAge: 0 });
  return response;
}