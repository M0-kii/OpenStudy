import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLibrary, recoverLibrary, reconnectDocument, takeLibraryWarning, type SavedDocument } from '../src/library.ts';

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

test('a damaged library is backed up before it is replaced', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  try {
    values.set('openstudy.library.v1', '{bad json');
    recoverLibrary();
    assert.equal(values.get('openstudy.library.v1'), '[]');
    assert.equal(values.get('openstudy.library.v1.damaged'), '{bad json');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('skipped saved items are reported instead of vanishing silently', () => {
  const library = normalizeLibrary([{
    path: '/p.pdf', name: 'p.pdf', title: 'P', kind: 'pdf', updatedAt: 1,
    notes: [{ text: 'lost', position: { kind: 'pdf', page: 0, zoom: 1, scroll: 0 } }],
  }]);
  assert.equal(library[0].notes.length, 0);
  assert.match(takeLibraryWarning() ?? '', /skipped 1 saved item/);
  assert.equal(takeLibraryWarning(), undefined);
});
