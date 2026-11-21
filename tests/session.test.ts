import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readingView } from '../src/session.ts';

const base = { label: 'Chapter 2', canPrevious: true, canNext: false };

test('a paged PDF shows the jump control and resolves the automatic fit', () => {
  const view = readingView({
    ...base,
    position: { kind: 'pdf', page: 4, scroll: 0, zoom: 1, fit: 'auto' },
    pageCount: 12,
  }, true);
  assert.deepEqual([view.showPageJump, view.page, view.total, view.zoomLabel], [true, '4', '12', 'Fit width']);
  assert.equal(readingView({
    ...base,
    position: { kind: 'pdf', page: 4, scroll: 0, zoom: 1, fit: 'auto' },
    pageCount: 12,
  }, false).zoomLabel, 'Fit page');
});

test('a custom zoom hides the fit label and a scroll document hides the jump control', () => {
  const pdf = readingView({ ...base, position: { kind: 'pdf', page: 4, scroll: 0, zoom: 1.4, fit: 'custom' } }, false);
  assert.equal(pdf.zoomLabel, '140%');
  assert.equal(pdf.showPageJump, false);
  const markdown = readingView({ ...base, position: { kind: 'markdown', scroll: 80, zoom: 1.2 } }, false);
  assert.deepEqual([markdown.showPageJump, markdown.zoomLabel], [false, '120%']);
});

test('an epub exposes its layout without page navigation', () => {
  const view = readingView({
    ...base,
    position: { kind: 'epub', cfi: 'epubcfi(/2/4)', fontSize: 22, lineHeight: 1.7, width: 700 },
  }, false);
  assert.deepEqual(view.epubLayout, { fontSize: 22, lineHeight: 1.7, width: 700 });
  assert.equal(view.zoomLabel, '22px');
  assert.equal(view.showPageJump, false);
});
