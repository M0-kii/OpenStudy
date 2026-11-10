import type { FindDirection, FindResult } from './index';

export interface TextMatch {
  index: number;
  length: number;
}

export interface GroupMatch extends TextMatch {
  group: number;
}

export function findPattern(query: string): RegExp | undefined {
  query = query.trim();
  if (!query) return undefined;
  const words = query.split(/\s+/u).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(words.join('\\s+'), 'giu');
}

export const emptyFindResult: FindResult = { found: false, count: 0, complete: true, counting: false };

export function textMatches(text: string, pattern: RegExp): TextMatch[] {
  return Array.from(text.matchAll(pattern), (match) => ({ index: match.index, length: match[0].length }));
}

export function selectMatch(matches: readonly TextMatch[], direction: FindDirection, from?: number): TextMatch | undefined {
  return direction === 'next'
    ? matches.find((match) => from === undefined || match.index >= from)
    : matches.findLast((match) => from === undefined || match.index < from);
}

export function groupedMatches(pattern: RegExp, size: number, readText: (group: number) => Promise<string>) {
  const groups = new Map<number, readonly TextMatch[] | null>();
  const pending = new Map<number, Promise<readonly TextMatch[]>>();
  // prefix[n] holds the number of matches before group n, when all earlier groups were readable.
  const prefix = [0];
  let count = 0;
  let incomplete = false;

  async function read(group: number): Promise<readonly TextMatch[]> {
    if (groups.has(group)) return groups.get(group) ?? [];
    const existing = pending.get(group);
    if (existing) return existing;
    const loading = readText(group).then((text) => textMatches(text, pattern)).then((matches) => {
      groups.set(group, matches);
      count += matches.length;
      for (let adjacent = groups.get(prefix.length - 1); adjacent; adjacent = groups.get(prefix.length - 1)) {
        prefix.push(prefix.at(-1)! + adjacent.length);
      }
      return matches;
    }).catch(() => {
      incomplete = true;
      groups.set(group, null);
      return [];
    }).finally(() => pending.delete(group));
    pending.set(group, loading);
    return loading;
  }

  function result(match?: GroupMatch): FindResult {
    const before = match && prefix[match.group];
    const matches = match && groups.get(match.group);
    const rank = match && matches?.findIndex(({ index }) => index === match.index);
    const index = before !== undefined && rank !== undefined && rank >= 0 ? before + rank + 1 : undefined;
    const counting = groups.size < size;
    return { found: !!match, index, count, complete: !counting && !incomplete, counting };
  }

  async function countRest(active: () => boolean, update: () => void): Promise<void> {
    let nextUpdate = Date.now() + 200;
    for (let group = 0; group < size && active(); group++) {
      if (groups.has(group)) continue;
      // Yield between groups so input and rendering can proceed during a long count.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!active()) return;
      await read(group);
      if (active() && groups.size < size && Date.now() >= nextUpdate) {
        update();
        nextUpdate = Date.now() + 200;
      }
    }
    if (active()) update();
  }

  return { query: pattern.source, read, result, countRest };
}

export function* findGroups(count: number, start: number, direction: FindDirection, previous?: GroupMatch) {
  if (count === 0) return;
  const step = direction === 'next' ? 1 : -1;
  const sameGroup = previous?.group === start;
  for (let offset = 0; offset < count + Number(sameGroup); offset++) {
    const group = (start + step * offset + count) % count;
    const from = offset === 0 && sameGroup ? previous.index + (step === 1 ? previous.length : 0) : undefined;
    yield { group, from };
  }
}

interface TextSlice {
  node: Text;
  start: number;
  end: number;
}

interface TextIndex {
  text: string;
  slices: TextSlice[];
}

const textBlock = 'address, article, blockquote, dd, div, dt, figcaption, h1, h2, h3, h4, h5, h6, li, p, pre, section, td, th';

export function indexText(root: Element, separateRuns = false): TextIndex {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const slices: TextSlice[] = [];
  let text = '';
  let previousBlock: Element | null | undefined;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.data || node.parentElement?.closest('script, style, [hidden]')) continue;
    const block = separateRuns ? undefined : node.parentElement?.closest(textBlock);
    if (slices.length && (separateRuns || block !== previousBlock)) text += ' ';
    const start = text.length;
    text += node.data;
    slices.push({ node, start, end: text.length });
    previousBlock = block;
  }
  return { text, slices };
}

export function matchRange(index: TextIndex, match: TextMatch): Range | undefined {
  const from = index.slices.find((slice) => match.index >= slice.start && match.index < slice.end);
  const end = match.index + match.length;
  const to = index.slices.find((slice) => end > slice.start && end <= slice.end);
  if (!from || !to) return undefined;
  const range = from.node.ownerDocument.createRange();
  range.setStart(from.node, match.index - from.start);
  range.setEnd(to.node, end - to.start);
  return range;
}

export function highlightMatch(range: Range, page: HTMLElement): () => void {
  const view = page.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (view?.CSS?.highlights && view.Highlight) {
    const highlight = new view.Highlight(range);
    view.CSS.highlights.set('openstudy-find', highlight);
    return () => {
      if (view.CSS.highlights.get('openstudy-find') === highlight) view.CSS.highlights.delete('openstudy-find');
    };
  }

  const origin = page.getBoundingClientRect();
  const markers = Array.from(range.getClientRects(), (rect) => {
    const marker = page.ownerDocument.createElement('span');
    marker.className = 'find-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.style.cssText = `left:${rect.left - origin.left}px;top:${rect.top - origin.top}px;width:${rect.width}px;height:${rect.height}px`;
    return marker;
  });
  page.append(...markers);
  return () => { for (const marker of markers) marker.remove(); };
}
