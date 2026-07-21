import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  process.env.VERIFY_DOCUMENTATION_ROOT ?? dirname(fileURLToPath(import.meta.url)),
  process.env.VERIFY_DOCUMENTATION_ROOT ? '.' : '..',
);
const documents = [
  'README.md',
  'README.zh-CN.md',
  'docs/DEPLOYMENT.md',
  'docs/DEPLOYMENT.zh-CN.md',
];

const requiredLinks = {
  'README.md': ['README.zh-CN.md', 'docs/DEPLOYMENT.md', 'docs/ASSET-PROVENANCE.md', 'docs/assets/codex-pet-pause.png', 'LICENSE'],
  'README.zh-CN.md': ['README.md', 'docs/DEPLOYMENT.zh-CN.md', 'docs/ASSET-PROVENANCE.md', 'docs/assets/codex-pet-pause.png', 'LICENSE'],
};

const requiredTerms = {
  'docs/DEPLOYMENT.md': [
    /Node\.js\s*`?>?=?\s*22\.12\.0/i,
    /npm ci/,
    /npm run build/,
    /`dist\//,
    /GitHub Pages/,
    /Vercel/,
    /Netlify/,
    /Nginx/,
    /HTTPS/,
    /(?:closing the (?:tab or )?browser|browser stops reminders)/i,
  ],
  'docs/DEPLOYMENT.zh-CN.md': [
    /Node\.js\s*`?>?=?\s*22\.12\.0/i,
    /npm ci/,
    /npm run build/,
    /`dist\//,
    /GitHub Pages/,
    /Vercel/,
    /Netlify/,
    /Nginx/,
    /HTTPS/,
    /关闭(?:标签页或)?关闭?浏览器|关闭浏览器后提醒会停止/,
  ],
};

const markdownLink = /!?\[[^\]]*\]\(([^\s)]+)(?:\s+['"][^'"]*['"])?\)/g;
const referenceDefinition = /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(?:<([^>]+)>|(\S+))/gim;
const fullReferenceLink = /(?<!!)\[([^\]\n]+)\]\[([^\]\n]*)\]/g;
const shortcutReferenceLink = /(?<!!)\[([^\]\n]+)\](?![\[(])/g;
const externalLink = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const failures = [];

function readDocument(file) {
  return readFileSync(resolve(repositoryRoot, file), 'utf8');
}

function checkRequiredLinks(file, content) {
  for (const target of requiredLinks[file] ?? []) {
    if (!content.includes(`](${target})`)) {
      failures.push(`${file} must link to ${target}`);
    }
  }
}

function checkRequiredTerms(file, content) {
  for (const term of requiredTerms[file] ?? []) {
    if (!term.test(content)) {
      failures.push(`${file} is missing required deployment guidance: ${term}`);
    }
  }
}

function normalizeReferenceLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function checkLocalTarget(file, documentDirectory, rawTarget, checkedTargets) {
  const target = rawTarget.replace(/^<|>$/g, '').split(/[?#]/, 1)[0];
  if (target === '' || externalLink.test(target)) {
    return;
  }

  const key = `${file}\u0000${target}`;
  if (checkedTargets.has(key)) {
    return;
  }
  checkedTargets.add(key);

  if (!existsSync(resolve(documentDirectory, decodeURIComponent(target)))) {
    failures.push(`${file} links to missing local file: ${rawTarget}`);
  }
}

function checkRelativeLinks(file, content) {
  const documentDirectory = dirname(resolve(repositoryRoot, file));
  const checkedTargets = new Set();
  for (const match of content.matchAll(markdownLink)) {
    checkLocalTarget(file, documentDirectory, match[1], checkedTargets);
  }

  const definitions = new Map();
  for (const match of content.matchAll(referenceDefinition)) {
    const label = normalizeReferenceLabel(match[1]);
    const target = match[2] ?? match[3];
    definitions.set(label, target);
    checkLocalTarget(file, documentDirectory, target, checkedTargets);
  }

  for (const match of content.matchAll(fullReferenceLink)) {
    const label = normalizeReferenceLabel(match[2] === '' ? match[1] : match[2]);
    const target = definitions.get(label);
    if (target === undefined) {
      failures.push(`${file} uses undefined reference link: ${label}`);
    } else {
      checkLocalTarget(file, documentDirectory, target, checkedTargets);
    }
  }

  for (const match of content.matchAll(shortcutReferenceLink)) {
    const target = definitions.get(normalizeReferenceLabel(match[1]));
    if (target !== undefined) {
      checkLocalTarget(file, documentDirectory, target, checkedTargets);
    }
  }
}

for (const file of documents) {
  const content = readDocument(file);
  checkRequiredLinks(file, content);
  checkRequiredTerms(file, content);
  checkRelativeLinks(file, content);
}

if (failures.length > 0) {
  console.error('Documentation verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Documentation verification passed for ${documents.length} documents.`);
}
