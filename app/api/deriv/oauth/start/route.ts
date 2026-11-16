import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function base64url(value: Buffer) {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function GET(request: NextRequest) {
  const clientId = process.env.DERIV_OAUTH_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "Deriv OAuth client ID is not configured." }, { status: 503 });

  const redirectUri = process.env.DERIV_OAUTH_REDIRECT_URI || new URL("/", request.url).toString();
  const state = randomBytes(24).toString("hex");
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const url = new URL("https://auth.deriv.com/oauth2/auth");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "trade");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(url);
  const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
  response.cookies.set("digitlab_oauth_state", state, options);
  response.cookies.set("digitlab_pkce_verifier", verifier, options);
  return response;
}