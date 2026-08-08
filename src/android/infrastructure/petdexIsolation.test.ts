import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('Petdex Android surface isolation', () => {
  test('uses a bridge-free non-exported activity in the main app process', () => {
    const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    const activity = readFileSync(
      'android/app/src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexActivity.kt',
      'utf8',
    );
    const declaration = manifest.match(
      /<activity\s+[\s\S]*?android:name="\.petdex\.PetdexActivity"[\s\S]*?\/>/,
    )?.[0] ?? '';

    expect(declaration).toContain('android:exported="false"');
    expect(declaration).not.toContain('android:process=');
    expect(activity).toContain('webView = WebView(this)');
    expect(activity).not.toContain('addJavascriptInterface');
    expect(activity).not.toContain('BridgeActivity');
    expect(activity).not.toContain('registerPlugin');
    expect(activity).not.toContain('com.getcapacitor');
  });
});
