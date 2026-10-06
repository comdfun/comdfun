/**
 * WS /agent. challenge → signed hello (device key + challenge nonce) → checks: active enrollment for the token,
 * on-chain ownerOf(tokenId) still equals the enrolled wallet, ERC-8004 registration bound → welcome (+ open leases
 * to resume). Then signed frames: heartbeat, progress, submission, cancel, disconnect. One session per seat.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CLOSE, DEFAULT_PREMIUM_MODEL_RE, WS_PATH, WS_PROTOCOL, isPremiumRuntime, randomHex, verifyFrame,
  type ClientFrame, type HelloBody, type ServerFrame,
} from "@company/protocol";
import type { App } from "./app.ts";
import { EngineError, type Session } from "./engine.ts";
import { ApiError } from "./errors.ts";
import { iso } from "./store.ts";
import { API_VERSION } from "./config.ts";

const MAX_SKEW_MS = 5 * 60_000;

export function attachAgentWs(server: Server, app: App) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== WS_PATH) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => connection(app, ws));
  });
  return wss;
}

function connection(app: App, ws: WebSocket) {
  const nonce = randomHex(32);
  let session: Session | null = null;
  let lastSeq = 0;
  let lastSeenSave = 0;
  const send = (f: ServerFrame) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(f)); };
  const fail = (code: number, error: string, detail: string) => {
    send({ type: "error", error, detail });
    send({ type: "disconnect", code, reason: error });
    ws.close(code, error.slice(0, 120));
  };
  send({ type: "challenge", nonce, serverTime: app.now(), protocol: WS_PROTOCOL, heartbeatMs: app.cfg.heartbeatMs });

  ws.on("message", async (data) => {
    let f: ClientFrame<any>;
    try { f = JSON.parse(String(data)); } catch { return send({ type: "error", error: "invalid_frame", detail: "frames are JSON" }); }
    if (!f || typeof f !== "object" || typeof f.type !== "string" || typeof f.id !== "string") return send({ type: "error", error: "invalid_frame", detail: "type and id are required" });
    const ack = (ok: boolean, extra: { error?: string; detail?: string; data?: unknown } = {}) => send({ type: "ack", ref: f.id, ok, ...extra });

    if (!session) {
      if (f.type !== "hello") return fail(CLOSE.authFailed, "hello_required", "send a signed hello first");
      try {
        session = await hello(app, f as ClientFrame<HelloBody>, nonce, send, (code, reason) => ws.close(code, reason));
        lastSeq = f.seq;
      } catch (e) {
        const err = e as HelloError;
        return fail(err.code ?? CLOSE.authFailed, err.error ?? "auth_failed", err.message);
      }
      return;
    }

    try {
      if (!verifyFrame(f, nonce, session.deviceKey)) throw new EngineError("invalid_signature", "frame signature does not verify");
      if (!Number.isInteger(f.seq) || f.seq <= lastSeq) throw new EngineError("replay", "seq must increase");
      if (Math.abs(app.now() - Number(f.ts)) > MAX_SKEW_MS) throw new EngineError("clock_skew", "frame timestamp too far from server time");
      lastSeq = f.seq;
      session.lastHeartbeat = app.now();
      if (app.now() - lastSeenSave > 60_000) {
        lastSeenSave = app.now();
        const seat = app.pairing.seat(session.tokenId);
        seat.lastSeenAt = iso(app.now());
        app.pairing.seats.save(seat);
      }
      switch (f.type) {
        case "heartbeat": {
          session.paused = !!f.body?.paused;
          const active = app.engine.openLeases(session.deviceKey).map((l) => l.leaseId);
          send({ type: "heartbeat", serverTime: app.now(), active });
          ack(true);
          if (!session.paused) app.engine.tick();
          break;
        }
        case "progress": {
          const r = app.engine.onProgress(session, String(f.body?.leaseId), typeof f.body?.note === "string" ? f.body.note : undefined);
          send({ type: "lease", leaseId: String(f.body.leaseId), expiresAt: r.expiresAt });
          ack(true, { data: r });
          break;
        }
        case "submission":
          ack(true, { data: app.engine.submit(session, f.body) });
          break;
        case "cancel":
          app.engine.onCancel(session, String(f.body?.leaseId), f.body?.reason);
          ack(true);
          break;
        case "disconnect":
          ack(true);
          app.engine.removeSession(session);
          ws.close(CLOSE.normal, "bye");
          break;
        default:
          throw new EngineError("invalid_frame", `unknown frame type ${f.type}`);
      }
    } catch (e) {
      const code = e instanceof EngineError || e instanceof ApiError ? (e as any).code : "server_error";
      ack(false, { error: code, detail: (e as Error).message });
    }
  });

  ws.on("close", () => {
    if (session) {
      app.engine.removeSession(session);
      app.event("seat.disconnected", { tokenId: session.tokenId });
    }
  });
  ws.on("error", () => undefined);
}

class HelloError extends Error {
  code: number;
  error: string;
  constructor(code: number, error: string, detail: string) {
    super(detail);
    this.code = code;
    this.error = error;
  }
}

async function hello(app: App, f: ClientFrame<HelloBody>, nonce: string, send: (f: ServerFrame) => void, close: (code: number, reason: string) => void): Promise<Session> {
  const deviceKey = String(f.deviceKey ?? "");
  if (!verifyFrame(f, nonce, deviceKey)) throw new HelloError(CLOSE.authFailed, "auth_failed", "hello signature does not verify");
  const b = f.body;
  if (!b || b.nonce !== nonce) throw new HelloError(CLOSE.authFailed, "auth_failed", "hello must carry the challenge nonce");
  const enr = app.pairing.activeEnrollment(deviceKey);
  if (!enr) throw new HelloError(CLOSE.notEnrolled, "not_enrolled", "this device is not enrolled; run `company pair`");
  if (String(b.tokenId) !== enr.tokenId) throw new HelloError(CLOSE.authFailed, "auth_failed", `this device is enrolled for Counsel #${enr.tokenId}`);
  let owner: string | null;
  try {
    owner = await app.pairing.ownerOf(enr.tokenId);
  } catch (e) {
    const cached = app.pairing.seat(enr.tokenId).owner;
    if (!cached) throw new HelloError(CLOSE.serverError, "ownership_unavailable", `could not read ownerOf: ${(e as Error).message}`);
    owner = cached;
  }
  if (!owner || owner.toLowerCase() !== enr.wallet.toLowerCase()) {
    app.pairing.revoke(enr, "Counsel transferred since pairing");
    throw new HelloError(CLOSE.ownershipChanged, "ownership_changed", "the enrolled wallet no longer holds this Counsel; pair again");
  }
  const seat = app.pairing.seat(enr.tokenId);
  if (app.cfg.requireRegistration && !seat.agentId) throw new HelloError(CLOSE.notRegistered, "not_registered", `register Counsel #${enr.tokenId} as an ERC-8004 agent first: ${app.cfg.publicApiUrl}/agents/register-intent?tokenId=${enr.tokenId}`);

  const prev = app.engine.sessionForToken(enr.tokenId);
  if (prev) {
    prev.send({ type: "disconnect", code: CLOSE.superseded, reason: "superseded by a newer connection for this seat" });
    prev.close(CLOSE.superseded, "superseded");
    app.engine.removeSession(prev);
  }
  const rt = b.runtime ?? { name: "unknown", version: null, model: null, effort: null, premium: false };
  const re = app.cfg.premiumModels ?? DEFAULT_PREMIUM_MODEL_RE;
  // re-check what the worker claims: a top-tier model AND high reasoning effort (mock runtimes are taken at their word)
  const premium = rt.name === "mock" ? !!rt.premium : !!rt.premium && isPremiumRuntime({ model: rt.model ?? null, effort: rt.effort ?? null }, re);
  const skills = new Set((Array.isArray(b.skills) ? b.skills : []).filter((s) => typeof s === "string" && app.skills.runnable(s)));
  const now = app.now();
  const s: Session = {
    id: randomUUID(),
    deviceKey,
    tokenId: enr.tokenId,
    wallet: enr.wallet,
    agentId: seat.agentId,
    runtime: { name: String(rt.name).slice(0, 40), version: rt.version ? String(rt.version).slice(0, 40) : null, model: rt.model ? String(rt.model).slice(0, 80) : null, effort: rt.effort ? String(rt.effort).slice(0, 20) : null, premium },
    tools: { foundry: !!b.tools?.foundry, docker: !!b.tools?.docker, image: !!b.tools?.image, audio: !!b.tools?.audio, video: !!b.tools?.video, node: String(b.tools?.node ?? "") },
    skills,
    concurrency: Math.max(1, Math.min(8, Number(b.concurrency) || 1)),
    premium,
    paused: !!b.paused,
    version: String(b.version ?? "unknown").slice(0, 40),
    connectedAt: now,
    lastHeartbeat: now,
    lastAssignedAt: 0,
    send,
    close,
  };
  Object.assign(seat, { lastSeenAt: iso(now), connectedAt: iso(now), version: s.version, runtime: s.runtime, wallet: enr.wallet, deviceKey, updatedAt: iso(now) });
  app.pairing.seats.save(seat);
  send({ type: "welcome", sessionId: s.id, deviceKey, tokenId: s.tokenId, agentId: s.agentId, wallet: s.wallet, concurrency: s.concurrency, heartbeatMs: app.cfg.heartbeatMs, premium, leases: app.engine.openLeases(deviceKey), serverVersion: API_VERSION });
  app.event("seat.connected", { tokenId: s.tokenId, runtime: s.runtime.name, model: s.runtime.model, premium, concurrency: s.concurrency, skills: skills.size });
  app.engine.addSession(s);
  return s;
}
