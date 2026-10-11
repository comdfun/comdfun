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
  // A deadline, for the same reason the server client has one: without it a control plane that accepts the
  // connection and then says nothing leaves the browser's button spinning for minutes with no way to tell the
  // person what went wrong. A button that fails in eight seconds can be pressed again; one that hangs cannot.
  // Reads get a short leash. Writes get a longer one and are never retried here, because a POST that times out
  // may well have been carried out upstream, and the caller has to be told that rather than have it repeated.
  const idempotent = method === "GET" || method === "HEAD";
  try {
    const res = await fetch(`${API_URL}${path}${search}`, {
      method,
      headers,
      body: bodyText,
      cache: "no-store",
      signal: AbortSignal.timeout(idempotent ? 8_000 : 20_000),
    });
    const out = new Headers();
    for (const h of FORWARD_RES) {
      const v = res.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(await res.arrayBuffer(), { status: res.status, headers: out });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return Response.json(
        {
          error: "upstream_timeout",
          detail: idempotent
            ? "The control plane did not answer in time. Try again in a moment."
            : "The control plane did not answer in time, so this may or may not have gone through. Reload before trying again.",
        },
        { status: 504 },
      );
    }
    return Response.json({ error: "upstream_unreachable", detail: err.message }, { status: 503 });
  }
}
