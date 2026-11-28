import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onPaperChange, paperTheme, setPaper } from '../src/paper.ts';

test('paper listeners see the new theme and unsubscribe cleanly', () => {
  const seen: string[] = [];
  const stop = onPaperChange((paper) => seen.push(paper));
  try {
    setPaper('night');
    assert.equal(paperTheme().background, '#1b1a16');
    assert.deepEqual(seen, ['night']);
  } finally {
    stop();
  }
  setPaper('paper');
  assert.deepEqual(seen, ['night']);
});
