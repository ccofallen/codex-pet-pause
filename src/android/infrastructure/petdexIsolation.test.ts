import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('Petdex Android surface isolation', () => {
  test('backgrounds the isolated Petdex task on Back instead of tearing down its renderer', () => {
    const activity = readFileSync(
      'android/app/src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexActivity.kt',
      'utf8',
    );

    expect(activity).toContain('onBackPressedDispatcher.addCallback(');
    expect(activity).toContain('moveTaskToBack(true)');
  });

  test('uses a bridge-free non-exported activity in its private process', () => {
    const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    const activity = readFileSync(
      'android/app/src/main/java/io/elevenlabs/codexpetpause/petdex/PetdexActivity.kt',
      'utf8',
    );
    const declaration = manifest.match(
      /<activity\b(?=[^>]*android:name="\.petdex\.PetdexActivity")[^>]*\/>/,
    )?.[0] ?? '';
    const configureIndex = activity.indexOf('PetdexWebViewDataDirectory.configure()');

    expect(declaration).toContain('android:exported="false"');
    expect(declaration).toContain('android:process=":petdex"');
    expect(activity.indexOf('WebView.setDataDirectorySuffix("petdex")')).toBeGreaterThanOrEqual(0);
    expect(configureIndex).toBeGreaterThanOrEqual(0);
    expect(configureIndex).toBeLessThan(
      activity.indexOf('WebView.setWebContentsDebuggingEnabled(false)'),
    );
    expect(configureIndex).toBeLessThan(
      activity.indexOf('webView = WebView(this)'),
    );
    expect(activity).toContain('webView = WebView(this)');
    expect(activity).toContain('cacheMode = WebSettings.LOAD_DEFAULT');
    expect(activity).not.toContain('addJavascriptInterface');
    expect(activity).not.toContain('BridgeActivity');
    expect(activity).not.toContain('registerPlugin');
    expect(activity).not.toContain('com.getcapacitor');
  });
});
