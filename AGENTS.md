# Repository Guidelines

## Project Structure & Module Organization

- `src/index.ts` starts the MCP server and registers its tools.
- `src/github-webhook.ts` receives and verifies GitHub webhook requests.
- `src/github-poller.ts` implements the REST API polling fallback.
- `src/store.ts` manages the local JSON event store.
- `README.md` documents setup, MCP configuration, and local webhook testing.
- Compiled output is written to `dist/` and local event data to `.data/`; both are ignored.
- There is currently no dedicated test directory.

## Build, Test, and Development Commands

Run these from the repository root:

```bash
npm install       # Install dependencies
npm run dev       # Run TypeScript directly during development
npm run build     # Type-check and compile to dist/
npm start         # Run the compiled MCP server
npm test          # Run Node’s test runner
```

Use Node.js with support for `node --test` when running the test script.

## Coding Style & Naming Conventions

Use strict TypeScript with 2-space indentation, semicolons, and single-purpose modules. Prefer descriptive camelCase for variables and functions, PascalCase for classes or types, and kebab-case for filenames (for example, `github-poller.ts`). Keep configuration in environment variables and validate external input with the existing Zod patterns.

## Testing Guidelines

Tests should use Node’s built-in `node:test` runner and be named with a `.test.ts` or `.test.js` suffix. Add coverage for webhook signature validation, event deduplication, polling behavior, and store acknowledgements. Run `npm run build` and `npm test` before submitting changes.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects that describe the change, such as `Document local ngrok webhook setup`. Pull requests should explain what changed, why it changed, and how it was validated. Include configuration or security implications when relevant; do not commit `.env`, tokens, webhook secrets, `.data/`, or generated `dist/` files.

## Security & Configuration Tips

Keep `GITHUB_TOKEN` and `WEBHOOK_SECRET` local. Webhooks must use the configured secret and `application/json`. For local testing, expose port `8787` with `ngrok http 8787` and use the HTTPS URL ending in `/webhooks/github`.
