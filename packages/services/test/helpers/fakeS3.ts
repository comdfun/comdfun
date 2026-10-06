/** Tiny in-process S3-compatible server: path-style PUT/GET/HEAD, verifies SigV4 signatures. */
import { createServer, type Server } from "node:http";
import { verifySignature } from "../../src/sigv4.ts";

export interface FakeS3 {
  url: string;
  objects: Map<string, { data: Buffer; contentType: string; meta: Record<string, string> }>;
  requests: { method: string; path: string; signed: boolean }[];
  close(): Promise<void>;
}

export async function startFakeS3(creds: { accessKeyId: string; secretAccessKey: string }, opts: { failFirstPut?: boolean } = {}): Promise<FakeS3> {
  const objects: FakeS3["objects"] = new Map();
  const requests: FakeS3["requests"] = [];
  let failNext = Boolean(opts.failFirstPut);
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const signed = verifySignature({ method: req.method ?? "GET", url, headers: req.headers as any, body, credentials: creds });
    requests.push({ method: req.method ?? "", path: url.pathname, signed });
    if (!signed) {
      res.writeHead(403, { "content-type": "application/xml" }).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
      return;
    }
    const key = decodeURIComponent(url.pathname);
    if (req.method === "PUT") {
      if (failNext) {
        failNext = false;
        res.writeHead(503).end("<Error><Code>SlowDown</Code></Error>");
        return;
      }
      const meta: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (k.startsWith("x-amz-meta-")) meta[k] = String(v);
      objects.set(key, { data: body, contentType: String(req.headers["content-type"] ?? "application/octet-stream"), meta });
      res.writeHead(200, { etag: '"x"' }).end();
      return;
    }
    const obj = objects.get(key);
    if (!obj) {
      res.writeHead(404, { "content-type": "application/xml" }).end(req.method === "HEAD" ? undefined : "<Error><Code>NoSuchKey</Code></Error>");
      return;
    }
    res.writeHead(200, { "content-type": obj.contentType, "content-length": obj.data.length, ...obj.meta });
    res.end(req.method === "HEAD" ? undefined : obj.data);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}`,
    objects,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
