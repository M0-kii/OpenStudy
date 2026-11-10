import type { ReaderContentsEntry } from './index';

export function flattenContents<T>(
  items: readonly T[],
  children: (item: T) => readonly T[] | undefined,
  entry: (item: T, depth: number) => ReaderContentsEntry | undefined,
): ReaderContentsEntry[] {
  const pending = items.map((item) => ({ item, depth: 0 })).reverse();
  const seen = new Set<T>();
  const contents: ReaderContentsEntry[] = [];
  while (pending.length) {
    const { item, depth } = pending.pop()!;
    if (seen.has(item)) continue;
    seen.add(item);
    const record = entry(item, Math.min(depth, 8));
    if (record) contents.push(record);
    const nested = children(item) ?? [];
    for (let index = nested.length - 1; index >= 0; index--) pending.push({ item: nested[index], depth: depth + 1 });
  }
  return contents;
}
