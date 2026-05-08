import {NextResponse} from "next/server";

const SPONSOR_URL = process.env.SPONSOR_SERVICE_URL ?? "http://localhost:4000";

/**
 * Server-side proxy to the off-chain sponsor service. Avoids exposing the
 * service URL to the browser and lets the dashboard add per-session policy
 * (e.g. rate-limit the same IP). The proxy is intentionally thin — the policy
 * decision lives in the sponsor service.
 */
export async function POST(req: Request) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({error: "invalid_json"}, {status: 400});
    }

    const upstream = await fetch(`${SPONSOR_URL}/sponsor`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(body),
    });

    const text = await upstream.text();
    const headers: Record<string, string> = {};
    const ct = upstream.headers.get("content-type");
    if (ct) headers["content-type"] = ct;
    return new NextResponse(text, {status: upstream.status, headers});
}
