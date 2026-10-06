// Same-origin pass-through used by /api/* route handlers. Paid routes on the control plane refuse cross-origin
// browsers, so the browser talks to these handlers and they forward server-to-server (no Origin header).
import { API_URL, MOCK } from "./config";

const FORWARD_REQ = ["authorization", "payment-signature", "content-type", "accept"];
const FORWARD_RES = ["content-type", "payment-required", "payment-response", "retry-after", "cache-control"];

export async function forward(req: Request, path: string): Promise<Response> {
  const method = req.method.toUpperCase();
  const search = new URL(req.url).search;
  let bodyText: string | undefined;
  if (method !== "GET" && method !== "HEAD") bodyText = await req.text();

  if (MOCK) {
    const { mockFetch } = await import("./mock");
    let parsed: unknown;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      return Response.json({ error: "invalid_request", detail: "body is not JSON" }, { status: 400 });
    }
    const r = mockFetch(method, `${path}${search}`, parsed);
    const headers = new Headers({ "content-type": "application/json", "x-mock": "1", ...(r.headers ?? {}) });
    if (r.headers?.["PAYMENT-REQUIRED"]) headers.set("access-control-expose-headers", "PAYMENT-REQUIRED");
    return new Response(r.text ?? JSON.stringify(r.json ?? null), { status: r.status, headers });
  }

  const headers = new Headers();
  for (const h of FORWARD_REQ) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) headers.set("x-forwarded-for", fwd);
  try {
    const res = await fetch(`${API_URL}${path}${search}`, { method, headers, body: bodyText, cache: "no-store" });
    const out = new Headers();
    for (const h of FORWARD_RES) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(await res.arrayBuffer(), { status: res.status, headers: out });
  } catch (e) {
    return Response.json({ error: "upstream_unreachable", detail: (e as Error).message }, { status: 503 });
  }
}
