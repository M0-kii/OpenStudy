import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flattenContents } from '../src/readers/contents.ts';
import { findGroups, findPattern, findText } from '../src/readers/find.ts';

test('literal find searches in both directions and wraps the starting group', () => {
  const pattern = findPattern(' test.+ value ')!;
  const text = 'TEST.+\nvalue and test.+ value';
  assert.deepEqual(findText(text, pattern, 'next'), { index: 0, length: 12 });
  assert.deepEqual(findText(text, pattern, 'previous'), { index: 17, length: 12 });
  assert.equal(findText(text, pattern, 'previous', 0), undefined);
  assert.deepEqual([...findGroups(3, 1, 'previous', { group: 1, index: 5, length: 3 })], [
    { group: 1, from: 5 }, { group: 0, from: undefined }, { group: 2, from: undefined }, { group: 1, from: undefined },
  ]);
  assert.deepEqual([...findGroups(3, 1, 'next', { group: 0, index: 5, length: 3 })].map(({ group }) => group), [1, 2, 0]);
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
