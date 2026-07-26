import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';

const linuxIconSizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const icoIconSizes = [16, 24, 32, 48, 64, 72, 96, 128, 256];
const icnsPngRepresentations = new Map([
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 256],
  ['ic09', 512],
  ['ic14', 512],
  ['ic10', 1024],
]);

async function assertPng(file, width, height) {
  const metadata = await sharp(file).metadata();
  assert.deepEqual(
    [metadata.format, metadata.width, metadata.height],
    ['png', width, height],
    `${file} must be a ${width}x${height} PNG`,
  );
}

async function assertIcoRepresentations(ico) {
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);

  const count = ico.readUInt16LE(4);
  assert.equal(count, icoIconSizes.length);
  assert.ok(6 + count * 16 <= ico.length, 'ICO directory must fit within the file');

  const decodedSizes = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = ico[entryOffset] || 256;
    const height = ico[entryOffset + 1] || 256;
    const byteLength = ico.readUInt32LE(entryOffset + 8);
    const imageOffset = ico.readUInt32LE(entryOffset + 12);

    assert.equal(width, height, `ICO entry ${index} must be square`);
    assert.ok(byteLength > 0, `ICO entry ${index} must not be empty`);
    assert.ok(
      imageOffset >= 6 + count * 16 && imageOffset + byteLength <= ico.length,
      `ICO entry ${index} payload must fit within the file`,
    );

    const metadata = await sharp(
      ico.subarray(imageOffset, imageOffset + byteLength),
    ).metadata();
    assert.deepEqual(
      [metadata.format, metadata.width, metadata.height],
      ['png', width, height],
      `ICO entry ${index} must contain a decodable ${width}x${height} PNG`,
    );
    decodedSizes.push(width);
  }

  assert.deepEqual(decodedSizes.sort((a, b) => a - b), icoIconSizes);
}

async function assertIcnsRepresentations(icns) {
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);

  const chunks = new Map();
  let offset = 8;
  while (offset < icns.length) {
    assert.ok(offset + 8 <= icns.length, 'ICNS chunk header must fit within the file');
    const type = icns.subarray(offset, offset + 4).toString('ascii');
    const byteLength = icns.readUInt32BE(offset + 4);
    assert.ok(byteLength >= 8, `ICNS ${type} chunk length must include its header`);
    assert.ok(offset + byteLength <= icns.length, `ICNS ${type} chunk must fit within the file`);
    assert.equal(chunks.has(type), false, `ICNS ${type} chunk must be unique`);
    chunks.set(type, icns.subarray(offset + 8, offset + byteLength));
    offset += byteLength;
  }
  assert.equal(offset, icns.length);

  for (const [type, size] of icnsPngRepresentations) {
    const payload = chunks.get(type);
    assert.ok(payload, `ICNS must contain ${type}`);
    const metadata = await sharp(payload).metadata();
    assert.deepEqual(
      [metadata.format, metadata.width, metadata.height],
      ['png', size, size],
      `ICNS ${type} must contain a decodable ${size}x${size} PNG`,
    );
  }
}

test('generated brand assets have expected formats and dimensions', async () => {
  const ico = await readFile('build/icons/icon.ico');
  const icns = await readFile('build/icons/icon.icns');

  await assertPng('build/icons/icon.png', 1024, 1024);
  for (const size of linuxIconSizes) {
    await assertPng(`build/icons/png/${size}x${size}.png`, size, size);
  }
  await assertPng('public/icons/pwa-192x192.png', 192, 192);
  await assertPng('public/icons/pwa-512x512.png', 512, 512);
  await assertPng('docs/assets/codex-pet-pause-desktop-cover.png', 1600, 900);
  await assertIcoRepresentations(ico);
  await assertIcnsRepresentations(icns);
});
