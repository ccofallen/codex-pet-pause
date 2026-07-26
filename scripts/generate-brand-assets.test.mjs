import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';

test('generated brand assets have expected formats and dimensions', async () => {
  const icon = await sharp('build/icons/icon.png').metadata();
  const pwa192 = await sharp('public/icons/pwa-192x192.png').metadata();
  const cover = await sharp('docs/assets/codex-pet-pause-desktop-cover.png').metadata();
  const ico = await readFile('build/icons/icon.ico');
  const icns = await readFile('build/icons/icon.icns');

  assert.deepEqual([icon.width, icon.height], [1024, 1024]);
  assert.deepEqual([pwa192.width, pwa192.height], [192, 192]);
  assert.deepEqual([cover.width, cover.height], [1600, 900]);
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
});
