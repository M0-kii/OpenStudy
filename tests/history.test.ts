import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addReading, lastDays, loadHistory } from '../src/history.ts';

test('reading time lands in the current day and per document', () => {
  const now = new Date(2026, 10, 23, 14, 0);
  let entries = addReading([], 120, 'Paper', now);
  entries = addReading(entries, 60, 'Paper', now);
  entries = addReading(entries, 30, 'Novel', now);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].documents, { Paper: 180, Novel: 30 });
  assert.equal(entries[0].seconds, 210);
  assert.equal(entries[0].date, '2026-11-23');
});

test('the week view fills in quiet days', () => {
  const entries = [{ date: '2026-11-23', seconds: 300, documents: {} }];
  const week = lastDays(entries, 7, new Date(2026, 10, 23));
  assert.equal(week.length, 7);
  assert.equal(week.at(-1)?.seconds, 300);
  assert.equal(week[0].seconds, 0);
});

test('malformed stored history is ignored', () => {
  const storage = { getItem: () => '[{"date":"bad","seconds":-1}]' };
  assert.deepEqual(loadHistory(storage), []);
});
