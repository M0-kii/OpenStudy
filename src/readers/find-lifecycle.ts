import type { FindDirection, FindResult } from './index';

export interface FindHost {
  query(): string;
  hidden(): boolean;
  message(text: string): void;
  busy(): boolean;
  search(query: string, direction: FindDirection, onProgress: (result: FindResult) => void): Promise<FindResult | undefined>;
}

export function findMessage(result: FindResult): string {
  if (!result.found && result.complete) return 'No matches';
  if (result.complete) return result.index === undefined ? `${result.count} matches` : `${result.index} of ${result.count}`;
  if (result.counting) return `${result.count} found. Counting…`;
  return `${result.count} found in readable text`;
}

export class FindLifecycle {
  private queued: { query: string; direction: FindDirection } | undefined;
  private host: FindHost;

  constructor(host: FindHost) {
    this.host = host;
  }

  private stale(query: string): boolean {
    return this.host.hidden() || this.host.query() !== query;
  }

  report(query: string, result: FindResult): void {
    if (!this.stale(query)) this.host.message(findMessage(result));
  }

  async run(query: string, direction: FindDirection): Promise<void> {
    if (!query || this.stale(query)) return;
    if (this.host.busy()) {
      this.queued = { query, direction };
      return;
    }
    this.host.message('Searching…');
    try {
      const result = await this.host.search(query, direction, (value) => this.report(query, value));
      if (result) this.report(query, result);
    } catch {
      if (!this.stale(query)) this.host.message('Search failed');
    }
  }

  runQueued(): void {
    const next = this.queued;
    this.queued = undefined;
    if (next) void this.run(next.query, next.direction);
  }

  clear(): void {
    this.queued = undefined;
  }
}
