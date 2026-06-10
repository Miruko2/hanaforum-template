package com.firefly.forum;

import android.os.Bundle;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

/**
 * 机身音量键处理（配合 VolumeKeysPlugin）：
 * - 仅当前端在音乐页调 VolumeKeys.setEnabled(true) 时，拦截音量键、不调系统音量，
 *   改发 volumebuttons(direction) 事件给前端，由前端调「播放器音量」并弹彩色胶囊。
 * - 其余情况放行系统默认（调系统媒体音量、弹系统音量条）。
 * 仅 App 内生效。
 */
public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(VolumeKeysPlugin.class);
    super.onCreate(savedInstanceState);
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (isVolumeKey(keyCode) && VolumeKeysPlugin.captured) {
      if (getBridge() != null) {
        String dir = keyCode == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
        getBridge().triggerWindowJSEvent("volumebuttons", "{\"direction\":\"" + dir + "\"}");
      }
      return true; // consume，阻止系统调音量 / 弹系统条
    }
    return super.onKeyDown(keyCode, event);
  }

  @Override
  public boolean onKeyUp(int keyCode, KeyEvent event) {
    if (isVolumeKey(keyCode) && VolumeKeysPlugin.captured) {
      return true; // consume 抬起，避免系统补处理
    }
    return super.onKeyUp(keyCode, event);
  }

  private boolean isVolumeKey(int keyCode) {
    return keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN;
  }
}
