import { NextRequest, NextResponse } from "next/server";
import { decryptSession, DERIV_SESSION_COOKIE } from "@/lib/deriv-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = decryptSession(request.cookies.get(DERIV_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Deriv session expired. Please reconnect." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { accountId?: string };
  const accountId = body.accountId || "";
  if (!/^[A-Za-z0-9]+$/.test(accountId)) return NextResponse.json({ error: "Invalid demo account selection." }, { status: 400 });

  const accountsResponse = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
    headers: { Authorization: `Bearer ${session.accessToken}` }, cache: "no-store",
  });
  const accountsData = await accountsResponse.json().catch(() => ({})) as { data?: Array<{ account_id: string; account_type: string }> };
  const isDemo = (accountsData.data || []).some((account) => account.account_id === accountId && account.account_type === "demo");
  if (!accountsResponse.ok || !isDemo) return NextResponse.json({ error: "Only an account explicitly identified by Deriv as DEMO can be connected." }, { status: 403 });

  const otpResponse = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`, {
    method: "POST", headers: { Authorization: `Bearer ${session.accessToken}` }, cache: "no-store",
  });
  const otpData = await otpResponse.json().catch(() => ({})) as { data?: { url?: string }; errors?: Array<{ message?: string }> };
  const wsUrl = otpData.data?.url || "";
  if (!otpResponse.ok || !wsUrl.startsWith("wss://api.derivws.com/trading/v1/options/ws/demo?")) {
    return NextResponse.json({ error: otpData.errors?.[0]?.message || "Deriv did not return a demo-only WebSocket URL." }, { status: 502 });
  }
  return NextResponse.json({ url: wsUrl });
}