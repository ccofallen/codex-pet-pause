import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { verifyDesktopWorkflow } from './verify-desktop-workflow.mjs';

const validWorkflow = {
  on: {
    push: {
      branches: ['main'],
      tags: ['v*'],
    },
    pull_request: {},
    workflow_dispatch: {},
  },
  permissions: { contents: 'write' },
  jobs: {
    validate: {},
    package: {
      needs: 'validate',
      strategy: {
        matrix: {
          include: [
            {
              id: 'mac-arm64',
              os: 'macos-latest',
              artifact: 'release/*-mac-arm64.dmg',
            },
            {
              id: 'mac-x64',
              os: 'macos-latest',
              artifact: 'release/*-mac-x64.dmg',
            },
            {
              id: 'windows-x64',
              os: 'windows-latest',
              artifact: 'release/*-windows-x64.exe',
            },
            {
              id: 'linux-x64',
              os: 'ubuntu-latest',
              artifact: 'release/*-linux-x64.AppImage\nrelease/*-linux-x64.deb\n',
            },
          ],
        },
      },
    },
    release: {
      needs: 'package',
      if: "github.ref_type == 'tag' && startsWith(github.ref, 'refs/tags/v')",
    },
  },
};

test('workflow validates, packages every target, and publishes tags', async () => {
  const workflow = parse(await readFile('.github/workflows/build-desktop.yml', 'utf8'));
  assert.deepEqual(verifyDesktopWorkflow(workflow), []);
});

test('accepts the in-memory release workflow contract', () => {
  assert.deepEqual(verifyDesktopWorkflow(validWorkflow), []);
});

test('rejects a workflow that does not publish v* tags', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.on.push.tags = ['release-*'];
  assert.ok(verifyDesktopWorkflow(invalid).some((failure) => failure.includes('v* tags')));
});

test('rejects a workflow with a missing native package target', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.package.strategy.matrix.include.pop();
  assert.ok(verifyDesktopWorkflow(invalid).some((failure) => failure.includes('linux-x64')));
});

test('rejects a release that does not wait for packaging', () => {
  const invalid = structuredClone(validWorkflow);
  invalid.jobs.release.needs = 'validate';
  assert.ok(verifyDesktopWorkflow(invalid).some((failure) => failure.includes('package job')));
});
