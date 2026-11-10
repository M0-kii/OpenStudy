import type { FindDirection } from './index';

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

export function findText(text: string, pattern: RegExp, direction: FindDirection, from?: number): TextMatch | undefined {
  pattern.lastIndex = direction === 'next' ? from ?? 0 : 0;
  if (direction === 'next') {
    const match = pattern.exec(text);
    return match ? { index: match.index, length: match[0].length } : undefined;
  }

  let previous: TextMatch | undefined;
  for (let match = pattern.exec(text); match && (from === undefined || match.index < from); match = pattern.exec(text)) {
    previous = { index: match.index, length: match[0].length };
  }
  return previous;
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
