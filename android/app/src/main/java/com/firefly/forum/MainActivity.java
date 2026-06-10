package com.firefly.forum;

import android.content.Context;
import android.media.AudioManager;
import android.os.Bundle;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

/**
 * 捕获机身硬件音量键：调系统媒体音量（STREAM_MUSIC），并隐藏系统自带音量条
 * （flag = 0），改由前端 <VolumeHud /> 弹出与播放器一致的玻璃胶囊。
 *
 * 每次按键后把最新音量百分比通过 Capacitor bridge 以 "volumebuttons" 事件发给
 * WebView；前端 window.addEventListener("volumebuttons", ...) 接收。
 * 仅 App 内生效——网页版收不到该事件，前端组件静默不显示。
 */
public class MainActivity extends BridgeActivity {

  private AudioManager audioManager;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    audioManager = (AudioManager) getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
      if (audioManager != null) {
        int direction = (keyCode == KeyEvent.KEYCODE_VOLUME_UP)
            ? AudioManager.ADJUST_RAISE
            : AudioManager.ADJUST_LOWER;
        // flag 0：不弹系统自带音量条，改用我们的胶囊
        audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, 0);
        notifyVolume();
      }
      return true; // consume，阻止系统默认处理
    }
    return super.onKeyDown(keyCode, event);
  }

  @Override
  public boolean onKeyUp(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
      return true; // consume 抬起，避免系统补弹音量条
    }
    return super.onKeyUp(keyCode, event);
  }

  private void notifyVolume() {
    if (audioManager == null || getBridge() == null) return;
    int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
    int cur = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
    double pct = max > 0 ? (double) cur / max : 0;
    String json = "{\"volume\":" + pct + ",\"current\":" + cur + ",\"max\":" + max + "}";
    getBridge().triggerWindowJSEvent("volumebuttons", json);
  }
}
