import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FindLifecycle, findMessage, type FindHost } from '../src/readers/find-lifecycle.ts';

function host(overrides: Partial<FindHost> = {}) {
  const messages: string[] = [];
  const base: FindHost = {
    query: () => 'alpha',
    hidden: () => false,
    message: (text) => messages.push(text),
    busy: () => false,
    search: async () => ({ found: true, count: 2, index: 1, complete: true, counting: false }),
  };
  return { life: new FindLifecycle({ ...base, ...overrides }), messages };
}

test('progress messages follow the count state', () => {
  assert.equal(findMessage({ found: false, count: 0, complete: true, counting: false }), 'No matches');
  assert.equal(findMessage({ found: true, count: 4, index: 2, complete: true, counting: false }), '2 of 4');
  assert.equal(findMessage({ found: true, count: 4, counting: true, complete: false }), '4 found. Counting…');
});

test('a stale query is never reported', async () => {
  const { life, messages } = host({ query: () => 'beta' });
  await life.run('alpha', 'next');
  assert.deepEqual(messages, []);
});

test('a search attempted while busy runs once the reader frees up', async () => {
  let busy = true;
  const searched: string[] = [];
  const { life, messages } = host({
    busy: () => busy,
    search: async (query) => { searched.push(query); return { found: true, count: 1, complete: true, counting: false }; },
  });
  await life.run('alpha', 'next');
  assert.deepEqual(searched, []);
  busy = false;
  life.runQueued();
  await Promise.resolve();
  assert.deepEqual(searched, ['alpha']);
  assert.equal(messages.at(-1), '1 matches');
});
