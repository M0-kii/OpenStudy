import { findPattern, indexText, matchRange, textMatches } from './readers/find.ts';
import type { ReadingPosition } from './readers/index.ts';

export const highlightColors = ['sage', 'rose', 'slate'] as const;
export type HighlightColor = typeof highlightColors[number];

export const highlightInk: Record<HighlightColor, string> = {
  sage: '#86a891',
  rose: '#c98f8f',
  slate: '#8fa6bd',
};

export interface SavedHighlight {
  text: string;
  color: HighlightColor;
  position: ReadingPosition;
}

let stored: SavedHighlight[] = [];

export function setHighlights(items: SavedHighlight[]): void {
  stored = items;
}

export function highlightFromSelection(color: HighlightColor, position: ReadingPosition | undefined, view: Window = window): SavedHighlight | undefined {
  if (!position) return undefined;
  const text = view.getSelection()?.toString().replace(/\s+/gu, ' ').trim();
  if (!text || text.length > 500) return undefined;
  return { text, color, position: { ...position } };
}

interface HighlightSet { add(range: Range): void }
interface HighlightView extends Window {
  Highlight?: new (...ranges: Range[]) => HighlightSet;
  CSS?: { highlights?: { set(name: string, value: HighlightSet): void } };
}

export function applyHighlights(root: Element, view: Window): void {
  const target = view as HighlightView;
  if (!target.CSS?.highlights || !target.Highlight) return;
  const index = indexText(root);
  for (const color of highlightColors) {
    const marks = new target.Highlight();
    for (const item of stored) {
      if (item.color !== color) continue;
      const pattern = findPattern(item.text);
      if (!pattern) continue;
      for (const match of textMatches(index.text, pattern)) {
        const range = matchRange(index, match);
        if (range) marks.add(range);
      }
    }
    target.CSS.highlights.set(`openstudy-${color}`, marks);
  }
}
