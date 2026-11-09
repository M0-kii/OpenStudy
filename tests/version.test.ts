import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const cargoVersion = (section?: string) => section?.match(/^version = "([^"]+)"$/m)?.[1];

test('application versions and the release tag agree', () => {
  const { version } = JSON.parse(read('package.json'));
  assert.ok(typeof version === 'string' && version.length > 0, 'package.json must specify a version');

  const crate = read('src-tauri/Cargo.toml').split(/^\[/m).find((section) => section.startsWith('package]'));
  const lockedCrate = read('src-tauri/Cargo.lock').split(/^\[\[package\]\]/m)
    .find((section) => /^name = "openstudy"$/m.test(section));
  assert.equal(JSON.parse(read('src-tauri/tauri.conf.json')).version, version, 'Tauri bundle version');
  assert.equal(cargoVersion(crate), version, 'Cargo package version');
  assert.equal(cargoVersion(lockedCrate), version, 'Cargo lockfile version');

  if (process.env.GITHUB_REF_TYPE === 'tag') {
    assert.equal(process.env.GITHUB_REF_NAME, `v${version}`, 'release tag');
  }
});
