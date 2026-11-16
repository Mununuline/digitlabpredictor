import { NextRequest, NextResponse } from "next/server";
import { decryptSession, DERIV_SESSION_COOKIE } from "@/lib/deriv-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = decryptSession(request.cookies.get(DERIV_SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ connected: false, accounts: [] });
  const response = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as { data?: Array<{ account_id: string; account_type: string; currency: string; balance: number; status?: string }> ; errors?: Array<{ message?: string }> };
  if (!response.ok) return NextResponse.json({ connected: false, error: data.errors?.[0]?.message || "Could not retrieve Deriv accounts." }, { status: response.status });
  const accounts = (data.data || []).filter((account) => account.account_type === "demo").map((account) => ({
    accountId: account.account_id, accountType: "demo", currency: account.currency, balance: account.balance, status: account.status || "active",
  }));
  return NextResponse.json({ connected: true, accounts });
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({ connected: false });
  response.cookies.set(DERIV_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}