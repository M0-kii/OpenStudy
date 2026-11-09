import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSettings, saveSettings } from '../src/settings.ts';

test('study settings persist validated values and recover from malformed storage', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  const defaults = { defaultMinutes: 0, showCountdown: true, pdfContinuous: false, sidebarCollapsed: false, theme: 'dark' };
  assert.deepEqual(loadSettings(storage), defaults);

  const changed = { defaultMinutes: 45, showCountdown: false, pdfContinuous: true, sidebarCollapsed: true, theme: 'light' } as const;
  saveSettings(changed, storage);
  assert.deepEqual(loadSettings(storage), changed);

  assert.deepEqual(loadSettings({ getItem: () => '{bad json' }), defaults);
  assert.deepEqual(loadSettings({ getItem: () => { throw new Error('Unavailable'); } }), defaults);
  assert.deepEqual(loadSettings({ getItem: () => '{"defaultMinutes":75,"showCountdown":false}' }), { ...defaults, showCountdown: false });
  assert.deepEqual(loadSettings({ getItem: () => '{"defaultMinutes":"25","showCountdown":0}' }), defaults);
  assert.deepEqual(loadSettings({ getItem: () => '{"defaultMinutes":25,"showCountdown":false}' }), {
    ...defaults, defaultMinutes: 25, showCountdown: false,
  });
  assert.deepEqual(loadSettings({ getItem: () => '{"theme":"unknown"}' }), defaults);
});
