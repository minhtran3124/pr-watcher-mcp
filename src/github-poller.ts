import type { EventStore, Watch } from "./store.js";

type GithubComment = {
  id: number;
  body?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  user?: { login?: string };
  path?: string;
  line?: number | null;
  original_line?: number | null;
};

type GithubReview = {
  id: number;
  body?: string;
  html_url?: string;
  submitted_at?: string;
  user?: { login?: string };
  state?: string;
};

export async function pollWatch(store: EventStore, watch: Watch, token: string) {
  const base = `https://api.github.com/repos/${watch.owner}/${watch.repo}`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "pr-watcher-mcp/0.1.0",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const since = watch.lastPolledAt;

  async function get<T>(path: string) {
    const url = new URL(`${base}${path}`);
    if (since) url.searchParams.set("since", since);
    url.searchParams.set("per_page", "100");
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
    return await response.json() as T;
  }

  const [issueComments, reviewComments, reviews] = await Promise.all([
    get<GithubComment[]>(`/issues/${watch.prNumber}/comments`),
    get<GithubComment[]>(`/pulls/${watch.prNumber}/comments`),
    get<GithubReview[]>(`/pulls/${watch.prNumber}/reviews`),
  ]);

  let added = 0;
  for (const comment of issueComments) {
    await store.addEvent({ watchId: watch.id, externalId: `issue_comment:${comment.id}`, type: "issue_comment", repo: `${watch.owner}/${watch.repo}`, prNumber: watch.prNumber, author: comment.user?.login, body: comment.body, url: comment.html_url, createdAt: comment.updated_at ?? comment.created_at });
    added++;
  }
  for (const comment of reviewComments) {
    await store.addEvent({ watchId: watch.id, externalId: `review_comment:${comment.id}`, type: "review_comment", repo: `${watch.owner}/${watch.repo}`, prNumber: watch.prNumber, author: comment.user?.login, body: comment.body, file: comment.path, line: comment.line ?? comment.original_line ?? undefined, url: comment.html_url, createdAt: comment.updated_at ?? comment.created_at });
    added++;
  }
  for (const review of reviews) {
    await store.addEvent({ watchId: watch.id, externalId: `review:${review.id}`, type: "review", repo: `${watch.owner}/${watch.repo}`, prNumber: watch.prNumber, author: review.user?.login, body: review.body, url: review.html_url, createdAt: review.submitted_at });
    added++;
  }
  await store.markPolled(watch.id);
  return { added, polledAt: watch.lastPolledAt };
}
