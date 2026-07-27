import { execFile as execFileCallback } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Arch } from 'builder-util';

const execFileAsync = promisify(execFileCallback);

export async function afterPack(
  context,
  { execFile = execFileAsync } = {},
) {
  if (context.electronPlatformName !== 'darwin' || context.arch !== Arch.arm64) {
    return;
  }

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  await execFile('xattr', ['-cr', appPath]);
  await execFile('codesign', ['--force', '--deep', '--sign', '-', appPath]);
}
