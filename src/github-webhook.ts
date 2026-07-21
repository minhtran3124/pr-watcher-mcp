import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { EventStore } from "./store.js";

function verifySignature(secret: string, body: string, signature?: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readBody(req: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function startWebhookServer(store: EventStore, port: number, secret: string, maxBodyBytes: number) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/webhooks/github") {
      res.writeHead(404); res.end("not found"); return;
    }
    try {
      const body = await readBody(req, maxBodyBytes);
      if (secret && !verifySignature(secret, body, req.headers["x-hub-signature-256"] as string | undefined)) {
        res.writeHead(401); res.end("invalid signature"); return;
      }
      const payload = JSON.parse(body) as Record<string, any>;
      const repo = payload.repository?.full_name as string | undefined;
      const prNumber = payload.pull_request?.number as number | undefined;
      if (repo && prNumber) {
        const [owner, name] = repo.split("/");
        const watch = store.listWatches().find((w) => w.owner === owner && w.repo === name && w.prNumber === prNumber);
        if (watch) {
          const comment = payload.comment;
          const review = payload.review;
          const eventType = req.headers["x-github-event"] ?? "unknown";
          await store.addEvent({
            watchId: watch.id,
            externalId: comment?.id
              ? `${eventType === "issue_comment" ? "issue_comment" : "review_comment"}:${comment.id}`
              : review?.id ? `review:${review.id}` : undefined,
            type: String(eventType),
            repo,
            prNumber,
            author: comment?.user?.login ?? review?.user?.login,
            body: comment?.body ?? review?.body,
            file: comment?.path,
            line: comment?.line ?? comment?.original_line,
            url: comment?.html_url ?? review?.html_url ?? payload.pull_request?.html_url,
            raw: payload,
          });
        }
      }
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify({ accepted: true }));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "bad request" }));
    }
  });
  server.on("error", (error) => {
    // Do not terminate the stdio MCP server if the optional webhook port is busy.
    console.error(`GitHub webhook unavailable on port ${port}: ${error.message}`);
  });
  server.listen(port, "127.0.0.1", () => console.error(`GitHub webhook listening on http://127.0.0.1:${port}`));
  return server;
}
