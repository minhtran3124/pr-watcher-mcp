import "dotenv/config";
import { resolve } from "node:path";
import { EventStore } from "./store.js";
import { startWebhookServer } from "./github-webhook.js";
import { pollWatch } from "./github-poller.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const store = new EventStore(resolve(process.env.EVENT_STORE_PATH ?? ".data/events.json"));
const webhookPort = Number(process.env.WEBHOOK_PORT ?? 8787);
const webhookSecret = process.env.WEBHOOK_SECRET ?? "";
const githubToken = process.env.GITHUB_TOKEN ?? "";
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES ?? 1_048_576);

await store.init();
startWebhookServer(store, webhookPort, webhookSecret, maxBodyBytes);

const server = new McpServer({ name: "pr-watcher", version: "0.1.0" });

server.registerTool("watch_pr", {
  description: "Start watching a GitHub pull request. Configure GitHub webhook delivery to /webhooks/github.",
  inputSchema: { owner: z.string(), repo: z.string(), pr_number: z.number().int().positive() },
}, async ({ owner, repo, pr_number }) => ({
  content: [{ type: "text", text: JSON.stringify(await store.addWatch(owner, repo, pr_number), null, 2) }],
}));

server.registerTool("list_watches", {
  description: "List pull requests currently watched by this local watcher.",
}, async () => ({ content: [{ type: "text", text: JSON.stringify(store.listWatches(), null, 2) }] }));

server.registerTool("get_new_pr_events", {
  description: "Return unconsumed GitHub events for a watch. Pass after_sequence for stateless polling.",
  inputSchema: { watch_id: z.string(), after_sequence: z.number().int().nonnegative().optional() },
}, async ({ watch_id, after_sequence }) => {
  const watch = store.getWatch(watch_id);
  if (!watch) return { isError: true, content: [{ type: "text", text: "watch not found" }] };
  const events = await store.getNewEvents(watch_id, after_sequence ?? watch.cursor);
  return { content: [{ type: "text", text: JSON.stringify({ has_new_events: events.length > 0, events }, null, 2) }] };
});

server.registerTool("ack_pr_event", {
  description: "Advance a watch cursor after the agent has processed events.",
  inputSchema: { watch_id: z.string(), sequence: z.number().int().positive() },
}, async ({ watch_id, sequence }) => ({
  content: [{ type: "text", text: JSON.stringify({ acknowledged: await store.ack(watch_id, sequence) }) }],
}));

server.registerTool("poll_pr_now", {
  description: "Poll GitHub REST API now for new comments and reviews on a watched PR. Requires GITHUB_TOKEN for private repos or higher rate limits.",
  inputSchema: { watch_id: z.string() },
}, async ({ watch_id }) => {
  const watch = store.getWatch(watch_id);
  if (!watch) return { isError: true, content: [{ type: "text", text: "watch not found" }] };
  try {
    const result = await pollWatch(store, watch, githubToken);
    const events = store.getEventsSince(watch_id, watch.cursor);
    return { content: [{ type: "text", text: JSON.stringify({ ...result, has_new_events: events.length > 0, events }, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "poll failed" }] };
  }
});

server.registerTool("wait_for_pr_event", {
  description: "Wait up to timeout_seconds for a new event. Use short timeouts; this is an optional polling convenience.",
  inputSchema: { watch_id: z.string(), after_sequence: z.number().int().nonnegative().optional(), timeout_seconds: z.number().int().min(1).max(60).optional() },
}, async ({ watch_id, after_sequence, timeout_seconds }) => {
  const watch = store.getWatch(watch_id);
  if (!watch) return { isError: true, content: [{ type: "text", text: "watch not found" }] };
  const cursor = after_sequence ?? watch.cursor;
  const deadline = Date.now() + (timeout_seconds ?? 20) * 1000;
  while (Date.now() < deadline) {
    const events = store.getEventsSince(watch_id, cursor);
    if (events.length) return { content: [{ type: "text", text: JSON.stringify({ has_new_events: true, events }, null, 2) }] };
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  return { content: [{ type: "text", text: JSON.stringify({ has_new_events: false, events: [] }) }] };
});

await server.connect(new StdioServerTransport());
