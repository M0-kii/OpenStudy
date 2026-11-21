import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPosition } from '../src/position.ts';

test('a saved position is only accepted when it matches the document', () => {
  const pdf = { kind: 'pdf', page: 12, zoom: 1, scroll: 0, fit: 'page' };
  assert.deepEqual(readPosition(pdf, 'pdf'), pdf);
  assert.equal(readPosition(pdf, 'epub'), undefined);
  assert.equal(readPosition({ ...pdf, page: 0 }, 'pdf'), undefined);
  assert.equal(readPosition({ ...pdf, zoom: -1 }, 'pdf'), undefined);
  assert.deepEqual(readPosition({ ...pdf, fit: 'sideways' }, 'pdf'), { kind: 'pdf', page: 12, zoom: 1, scroll: 0 });
});

test('markdown and epub positions need usable numbers', () => {
  assert.deepEqual(readPosition({ kind: 'markdown', scroll: 40, zoom: 1.5 }, 'markdown'), { kind: 'markdown', scroll: 40, zoom: 1.5 });
  assert.equal(readPosition({ kind: 'markdown', scroll: NaN, zoom: 1 }, 'markdown'), undefined);
  assert.equal(readPosition({ kind: 'epub', cfi: 'epubcfi(/2/4)', fontSize: 20, lineHeight: 1.6, width: 680 }, 'epub').kind, 'epub');
  assert.equal(readPosition({ kind: 'epub', cfi: 'nope', fontSize: 20, lineHeight: 1.6, width: 680 }, 'epub'), undefined);
});
