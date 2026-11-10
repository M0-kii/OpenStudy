import assert from 'node:assert/strict';
import { test } from 'node:test';
import { batteryAlertLevel } from '../src/battery.ts';

test('only reports valid low or critical battery levels while discharging', () => {
  assert.equal(batteryAlertLevel(null), 0);
  assert.equal(batteryAlertLevel({ percent: 5, charging: true }), 0);
  assert.equal(batteryAlertLevel({ percent: -1, charging: false }), 0);
  assert.equal(batteryAlertLevel({ percent: 21, charging: false }), 0);
  assert.equal(batteryAlertLevel({ percent: 20, charging: false }), 1);
  assert.equal(batteryAlertLevel({ percent: 10, charging: false }), 2);
});
