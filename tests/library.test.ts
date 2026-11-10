import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconnectDocument, type SavedDocument } from '../src/library.ts';

test('reconnecting preserves saved work and rejects an existing history entry', () => {
  const position = { kind: 'pdf', page: 12, zoom: 1, scroll: 0 } as const;
  const original: SavedDocument = {
    path: '/old/paper.pdf', name: 'paper.pdf', title: 'Paper', kind: 'pdf',
    position, label: 'Page 12', updatedAt: 1, notes: [{ text: 'Check this', position, label: 'Page 12' }],
  };
  const other = { ...original, path: '/other.pdf' };
  const library = [original, other];
  const moved = reconnectDocument(library, original, { path: '/new/renamed.pdf', name: 'renamed.pdf', kind: 'pdf' });
  assert.deepEqual(moved.library, [{ ...original, path: '/new/renamed.pdf', name: 'renamed.pdf' }, other]);
  assert.equal(library[0].path, '/old/paper.pdf');
  assert.throws(() => reconnectDocument(library, original, other), /own reading history/);
  assert.throws(() => reconnectDocument(library, original, { ...other, kind: 'epub' }), /same format/);
});
