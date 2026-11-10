import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flattenContents } from '../src/readers/contents.ts';
import { findGroups, findPattern, groupedMatches, selectMatch, textMatches } from '../src/readers/find.ts';

test('literal find searches in both directions and wraps the starting group', () => {
  const pattern = findPattern(' test.+ value ')!;
  const matches = textMatches('TEST.+\nvalue and test.+ value', pattern);
  assert.deepEqual(selectMatch(matches, 'next'), { index: 0, length: 12 });
  assert.deepEqual(selectMatch(matches, 'previous'), { index: 17, length: 12 });
  assert.equal(selectMatch(matches, 'previous', 0), undefined);
  assert.deepEqual([...findGroups(3, 1, 'previous', { group: 1, index: 5, length: 3 })], [
    { group: 1, from: 5 }, { group: 0, from: undefined }, { group: 2, from: undefined }, { group: 1, from: undefined },
  ]);
  assert.deepEqual([...findGroups(3, 1, 'next', { group: 0, index: 5, length: 3 })].map(({ group }) => group), [1, 2, 0]);
});

test('find returns a running count and resolves a global index without reading the same group twice', async () => {
  const pages = ['hit, hit', '', 'hit', 'hit'];
  const reads: number[] = [];
  const index = groupedMatches(findPattern('hit')!, pages.length, async (page) => {
    reads.push(page);
    return pages[page];
  });
  const [matches] = await Promise.all([index.read(2), index.read(2)]);
  const selected = { ...matches[0], group: 2 };
  assert.deepEqual(reads, [2]);
  assert.deepEqual(index.result(selected), { found: true, index: undefined, count: 1, complete: false, counting: true });
  await index.countRest(() => true, () => {});
  assert.deepEqual(reads, [2, 0, 1, 3]);
  assert.deepEqual(index.result(selected), { found: true, index: 3, count: 4, complete: true, counting: false });
});

test('find keeps a partial count when a group cannot be read', async () => {
  const index = groupedMatches(findPattern('hit')!, 2, async (page) => {
    if (page === 0) throw new Error('Unreadable page');
    return 'hit';
  });
  const [match] = await index.read(1);
  await index.countRest(() => true, () => {});
  assert.deepEqual(index.result({ ...match, group: 1 }), {
    found: true, index: undefined, count: 1, complete: false, counting: false,
  });
});

test('contents keeps document order and skips an unlinked or repeated parent', () => {
  type Node = { label: string; children?: Node[] };
  const first: Node = { label: 'First' };
  const nested: Node = { label: 'Nested', children: [first] };
  first.children = [{ label: '', children: [nested] }];
  const entries = flattenContents([first, { label: 'Last' }], (node) => node.children,
    (node, depth) => node.label ? { label: node.label, depth, goTo: async () => {} } : undefined);
  assert.deepEqual(entries.map(({ label, depth }) => [label, depth]), [['First', 0], ['Nested', 2], ['Last', 0]]);
});
