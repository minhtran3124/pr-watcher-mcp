import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type Watch = {
  id: string;
  owner: string;
  repo: string;
  prNumber: number;
  createdAt: string;
  cursor: number;
  lastPolledAt?: string;
};

export type PrEvent = {
  id: string;
  externalId?: string;
  sequence: number;
  watchId: string;
  type: string;
  repo: string;
  prNumber: number;
  author?: string;
  body?: string;
  file?: string;
  line?: number;
  url?: string;
  createdAt: string;
  raw?: unknown;
};

type State = { watches: Watch[]; events: PrEvent[]; nextSequence: number };

const EMPTY: State = { watches: [], events: [], nextSequence: 1 };

export class EventStore {
  private state: State = structuredClone(EMPTY);
  private writeQueue = Promise.resolve();

  constructor(private readonly path: string) {}

  async init() {
    try {
      this.state = JSON.parse(await readFile(this.path, "utf8")) as State;
    } catch {
      await this.persist();
    }
  }

  private async persist() {
    await mkdir(dirname(this.path), { recursive: true });
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writeQueue = this.writeQueue.then(() => writeFile(this.path, snapshot));
    await this.writeQueue;
  }

  async addWatch(owner: string, repo: string, prNumber: number) {
    const existing = this.state.watches.find(
      (w) => w.owner === owner && w.repo === repo && w.prNumber === prNumber,
    );
    if (existing) return existing;
    const watch: Watch = {
      id: randomUUID(), owner, repo, prNumber, createdAt: new Date().toISOString(), cursor: 0,
    };
    this.state.watches.push(watch);
    await this.persist();
    return watch;
  }

  listWatches() { return this.state.watches; }
  getWatch(id: string) { return this.state.watches.find((w) => w.id === id); }

  async addEvent(event: Omit<PrEvent, "id" | "sequence" | "createdAt"> & { createdAt?: string }) {
    const duplicate = this.state.events.find((e) =>
      (event.externalId && e.externalId === event.externalId) ||
      (!event.externalId && e.watchId === event.watchId && e.type === event.type && e.body === event.body && e.url === event.url)
    );
    if (duplicate) return duplicate;
    const saved: PrEvent = {
      ...event,
      id: randomUUID(),
      sequence: this.state.nextSequence++,
      createdAt: event.createdAt ?? new Date().toISOString(),
    };
    this.state.events.push(saved);
    await this.persist();
    return saved;
  }

  async getNewEvents(watchId: string, afterSequence = 0) {
    const events = this.state.events.filter((e) => e.watchId === watchId && e.sequence > afterSequence);
    const watch = this.getWatch(watchId);
    if (watch && events.length) {
      watch.cursor = Math.max(watch.cursor, ...events.map((e) => e.sequence));
      await this.persist();
    }
    return events;
  }

  async ack(watchId: string, sequence: number) {
    const watch = this.getWatch(watchId);
    if (!watch) return false;
    watch.cursor = Math.max(watch.cursor, sequence);
    await this.persist();
    return true;
  }

  async markPolled(watchId: string, at = new Date().toISOString()) {
    const watch = this.getWatch(watchId);
    if (!watch) return false;
    watch.lastPolledAt = at;
    await this.persist();
    return true;
  }

  getEventsSince(watchId: string, sequence: number) {
    return this.state.events.filter((e) => e.watchId === watchId && e.sequence > sequence);
  }
}
