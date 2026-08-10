package io.elevenlabs.codexpetpause;

import android.content.Intent;
import android.content.ComponentName;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import io.elevenlabs.codexpetpause.bridge.AndroidHostPlugin;
import io.elevenlabs.codexpetpause.web.RendererRecoveryGate;

public class MainActivity extends BridgeActivity {
  private final RendererRecoveryGate rendererRecoveryGate = new RendererRecoveryGate();
  final WebViewListener rendererRecoveryListener = createRendererRecoveryListener(
      rendererRecoveryGate,
      this::finish,
      () -> startActivity(recoveryLaunchIntent(getIntent(), getComponentName()))
  );

  @Override
  public void onCreate(android.os.Bundle savedInstanceState) {
    registerPlugin(AndroidHostPlugin.class);
    super.onCreate(savedInstanceState);
    getBridge().addWebViewListener(rendererRecoveryListener);
  }

  static boolean handleRendererLoss(
      RendererRecoveryGate gate,
      Runnable finishActivity,
      Runnable relaunchActivity
  ) {
    if (gate.tryBegin()) {
      finishActivity.run();
      relaunchActivity.run();
    }
    return true;
  }

  static WebViewListener createRendererRecoveryListener(
      RendererRecoveryGate gate,
      Runnable finishActivity,
      Runnable relaunchActivity
  ) {
    return new WebViewListener() {
      @Override
      public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
        return handleRendererLoss(gate, finishActivity, relaunchActivity);
      }
    };
  }

  static Intent recoveryLaunchIntent(Intent existingIntent, ComponentName componentName) {
    Intent launchIntent = new Intent(existingIntent);
    launchIntent.setComponent(componentName);
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    return launchIntent;
  }
}
