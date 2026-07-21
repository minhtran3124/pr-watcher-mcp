# PR Watcher MCP — MVP

Local GitHub PR event watcher exposed as an MCP server. It receives GitHub webhook events, stores them in a small JSON event store, and exposes tools for Codex/Claude Code to fetch or wait for new review feedback.

It also includes a polling fallback through GitHub REST API via the `poll_pr_now` MCP tool. Set `GITHUB_TOKEN` for private repositories or to avoid unauthenticated rate limits.

## Run

```bash
npm install
npm run build
npm start
```

The server reads configuration from environment variables (or a local `.env` file). Create `.env` if you want to use one:

```dotenv
GITHUB_TOKEN=github_pat_replace_me
WEBHOOK_SECRET=replace_with_a_generated_secret
WEBHOOK_PORT=8787
```

Keep `.env` private and do not commit it.

The MCP server uses stdio. It also starts the webhook receiver on `127.0.0.1:8787` by default. To receive GitHub webhooks from the internet, put a tunnel/reverse proxy in front of the port and configure the GitHub webhook URL as:

When using this as an MCP server, do not also run a second `npm start` process: Codex starts `dist/index.js` itself. If you already started `npm start`, stop it before connecting the MCP server so the webhook port is not shared.

```text
https://YOUR_PUBLIC_HOST/webhooks/github
```

Use content type `application/json`, a secret matching `WEBHOOK_SECRET`, and subscribe to Pull requests, Pull request reviews, Pull request review comments, and Issue comments.

## `GITHUB_TOKEN`

`GITHUB_TOKEN` is optional for public repositories. It is used by the `poll_pr_now` tool when calling the GitHub REST API. Set it for private repositories or when unauthenticated API rate limits are insufficient. The token is read when the MCP process starts, so restart the process after creating or changing it.

For a least-privilege token, create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):

1. Choose the resource owner and restrict access to the repository (or repositories) being watched.
2. Under **Repository permissions**, grant **Metadata: Read-only**, **Issues: Read-only**, and **Pull requests: Read-only**.
3. Generate the token, copy it once, and set it as `GITHUB_TOKEN` in `.env` or the MCP configuration.

To update or rotate it, generate a replacement token, replace the old value in the environment where this server runs, and restart the server. Revoke the old token after confirming polling works.

## `WEBHOOK_SECRET`

`WEBHOOK_SECRET` is a shared secret used to verify GitHub's `X-Hub-Signature-256` webhook header. Generate a strong random value locally, for example:

```bash
openssl rand -hex 32
```

Use the exact same generated value in both places:

1. Set it as `WEBHOOK_SECRET` in `.env` or the MCP configuration.
2. In the GitHub repository, open **Settings → Webhooks**, create or edit the webhook, and paste it into **Secret**.
3. Save the webhook and restart the MCP server if it was already running.

Do not use `GITHUB_TOKEN` as the webhook secret, and do not commit either value. If the secret is lost or exposed, generate a new one, update both GitHub and the server, then restart the server.

## MCP setup example

```json
{
  "mcpServers": {
    "pr-watcher": {
      "command": "node",
      "args": ["/absolute/path/to/pr-watcher-mcp/dist/index.js"],
      "env": {
        "WEBHOOK_SECRET": "replace-me",
        "WEBHOOK_PORT": "8787"
      }
    }
  }
}
```

## Intended flow

1. Call `watch_pr` for `owner/repo` and PR number.
2. Configure the GitHub webhook to point at the receiver.
3. Call `get_new_pr_events` between coding steps, or use `wait_for_pr_event` with a short timeout.
4. After processing feedback, call `ack_pr_event` with the latest sequence.

If webhooks are not available, call `poll_pr_now` for a watched PR. Polling uses the last successful poll timestamp and deduplicates GitHub comment/review IDs.

This MVP deliberately does not modify GitHub, auto-apply fixes, or post replies. Those should be added behind explicit approval policies after the event path is validated.
