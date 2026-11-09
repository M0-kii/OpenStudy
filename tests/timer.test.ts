import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockLabel, StudyTimer } from '../src/timer.ts';

test('study time pauses during a break and stays at zero after finishing', () => {
  const timer = new StudyTimer(1);
  timer.resume(0);
  timer.resume(2000);
  timer.pause(16_200);
  assert.equal(clockLabel(timer.milliseconds(90_000)), '0:44');
  timer.resume(90_000);
  assert.equal(timer.milliseconds(133_000), 800);
  assert.equal(timer.milliseconds(140_000), 0);
  timer.pause(140_000);
  timer.resume(145_000);
  assert.equal(timer.milliseconds(150_000), 0);
});
