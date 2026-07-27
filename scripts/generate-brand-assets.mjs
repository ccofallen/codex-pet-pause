import { mkdir, readFile, writeFile } from 'node:fs/promises';
import png2icons from 'png2icons';
import sharp from 'sharp';

await mkdir('build/icons/png', { recursive: true });
await mkdir('public/icons', { recursive: true });
await mkdir('docs/assets', { recursive: true });

const iconSvg = await readFile('build/brand/codex-pet-pause-icon.svg');
const iconPng = await sharp(iconSvg).resize(1024, 1024).png().toBuffer();
await writeFile('build/icons/icon.png', iconPng);

for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  await sharp(iconPng)
    .resize(size, size)
    .png()
    .toFile(`build/icons/png/${size}x${size}.png`);
}

for (const size of [192, 512]) {
  await sharp(iconPng)
    .resize(size, size)
    .png()
    .toFile(`public/icons/pwa-${size}x${size}.png`);
}

const ico = png2icons.createICO(iconPng, png2icons.BICUBIC, 0, true);
const icns = png2icons.createICNS(iconPng, png2icons.BICUBIC, 0);
if (ico === null || icns === null) {
  throw new Error('Native icon conversion failed');
}
await writeFile('build/icons/icon.ico', ico);
await writeFile('build/icons/icon.icns', icns);

const coverSvg = await readFile('build/brand/codex-pet-pause-cover.svg');
await sharp(coverSvg)
  .resize(1600, 900)
  .png()
  .toFile('docs/assets/codex-pet-pause-desktop-cover.png');
