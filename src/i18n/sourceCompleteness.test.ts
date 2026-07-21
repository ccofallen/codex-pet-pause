import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { expect, test } from 'vitest';

const cjk = /[\u3400-\u9fff]/u;

function collectProductionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectProductionFiles(path);
    if (!['.ts', '.tsx'].includes(extname(entry.name)) || entry.name.includes('.test.')) return [];
    if (path.endsWith(join('i18n', 'messages.ts')) || path.endsWith('env.d.ts')) return [];
    return [path];
  });
}

test('keeps fixed CJK production copy inside the translation catalog', () => {
  const root = resolve(process.cwd());
  const files = [
    ...collectProductionFiles(join(root, 'src')),
    join(root, 'index.html'),
    join(root, 'vite.config.ts'),
  ];
  const untranslated = files.flatMap((file) => readFileSync(file, 'utf8').split('\n')
    .map((line, index) => ({ file, line, lineNumber: index + 1 }))
    .filter(({ line }) => cjk.test(line))
    .map(({ file, line, lineNumber }) => `${relative(root, file)}:${lineNumber}: ${line.trim()}`));

  expect(untranslated, untranslated.join('\n')).toEqual([]);
});
