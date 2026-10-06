/** A small router over node:http: path params, JSON bodies with per-route limits, CORS, errors. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, E } from "./errors.ts";

export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  ip: string;
  raw: IncomingMessage;
  body: Buffer;
  /** Parsed JSON body ({} when empty); throws invalid_request on bad JSON. */
  json<T = any>(): T;
  bearer: string | null;
}

export interface Res {
  status: number;
  body?: unknown;
  raw?: Buffer | string;
  headers?: Record<string, string>;
}

export type Handler = (req: Req) => Promise<Res> | Res;

export interface RouteOpts {
  /** max body bytes (default 64 KiB) */
  limit?: number;
  /** CORS: "public" (any origin, reads), "paid" (allow-listed origins only), "none" */
  cors?: "public" | "paid" | "none";
  /** rate-limit bucket */
  bucket?: "read" | "paid" | "quote" | "device" | "none";
}

interface Route { method: string; parts: string[]; handler: Handler; opts: RouteOpts }

export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, handler: Handler, opts: RouteOpts = {}) {
    this.routes.push({ method, parts: path.split("/").filter(Boolean), handler, opts });
    return this;
  }
  get(path: string, h: Handler, o?: RouteOpts) { return this.on("GET", path, h, o); }
  post(path: string, h: Handler, o?: RouteOpts) { return this.on("POST", path, h, o); }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | { allowed: string[] } | null {
    const segs = path.split("/").filter(Boolean);
    const allowed: string[] = [];
    for (const r of this.routes) {
      const params = matchParts(r.parts, segs);
      if (!params) continue;
      if (r.method === method || (method === "HEAD" && r.method === "GET")) return { route: r, params };
      allowed.push(r.method);
    }
    return allowed.length ? { allowed } : null;
  }
}

function matchParts(parts: string[], segs: string[]): Record<string, string> | null {
  if (parts.length !== segs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let s: string;
    try { s = decodeURIComponent(segs[i]); } catch { return null; }
    if (p.startsWith(":")) {
      // ":hash.json" → param "hash" must end with ".json"
      const dot = p.indexOf(".");
      if (dot > 0) {
        const suffix = p.slice(dot);
        if (!s.endsWith(suffix)) return null;
        params[p.slice(1, dot)] = s.slice(0, -suffix.length);
      } else params[p.slice(1)] = s;
    } else if (p !== s) return null;
  }
  return params;
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Res {
  return { status, body, headers };
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const len = Number(req.headers["content-length"] ?? 0);
  if (len > limit) {
    req.resume();
    throw E.tooLarge(limit);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > limit) throw E.tooLarge(limit);
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const f = req.headers["x-forwarded-for"];
    const first = (Array.isArray(f) ? f[0] : f)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

export function bearerOf(req: IncomingMessage): string | null {
  const a = req.headers.authorization;
  if (!a) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(a);
  return m ? m[1] : null;
}

export function send(res: ServerResponse, r: Res, head = false) {
  const headers: Record<string, string> = { ...(r.headers ?? {}) };
  let payload: Buffer | string | undefined;
  if (r.raw !== undefined) payload = r.raw;
  else if (r.body !== undefined) {
    payload = JSON.stringify(r.body);
    headers["content-type"] ??= "application/json; charset=utf-8";
  }
  if (payload !== undefined) headers["content-length"] = String(Buffer.byteLength(payload));
  headers["x-content-type-options"] ??= "nosniff";
  res.writeHead(r.status, headers);
  res.end(head ? undefined : payload);
}

export function errorRes(e: unknown): Res {
  if (e instanceof ApiError) return { status: e.status, body: e.toJSON(), headers: e.headers };
  const err = e as Error;
  return { status: 500, body: { error: "internal", detail: err?.message ?? "internal error" } };
}

export function parseLimit(q: URLSearchParams, dflt: number, max = 500, min = 1): number {
  const v = q.get("limit");
  if (v === null || v === "") return dflt;
  const n = Number(v);
  if (!Number.isInteger(n)) throw E.invalidQuery("limit must be an integer");
  return Math.max(min, Math.min(max, n));
}

/** `before` cursor: exclusive creation time (ISO or epoch ms). */
export function parseBefore(q: URLSearchParams): number | null {
  const v = q.get("before");
  if (!v) return null;
  const n = /^[0-9]+$/.test(v) ? Number(v) : Date.parse(v);
  if (!Number.isFinite(n)) throw E.invalidQuery("before must be an ISO time or epoch ms");
  return n;
}

export function parseSince(q: URLSearchParams): number | null {
  const v = q.get("since");
  if (!v) return null;
  const n = /^[0-9]+$/.test(v) ? Number(v) : Date.parse(v);
  if (!Number.isFinite(n)) throw E.invalidQuery("since must be an ISO time or epoch ms");
  return n;
}
