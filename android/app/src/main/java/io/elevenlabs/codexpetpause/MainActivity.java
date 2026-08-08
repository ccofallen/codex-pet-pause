package io.elevenlabs.codexpetpause;

import com.getcapacitor.BridgeActivity;
import io.elevenlabs.codexpetpause.bridge.AndroidHostPlugin;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(android.os.Bundle savedInstanceState) {
    registerPlugin(AndroidHostPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
