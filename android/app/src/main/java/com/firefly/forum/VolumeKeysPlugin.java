package com.firefly.forum;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 让前端开关「是否拦截机身音量键」。
 *
 * 音乐页有歌时（前端 VolumeControl 挂载）调 setEnabled(true)：MainActivity 据此
 * 拦截音量键、不调系统音量，转而发 volumebuttons(direction) 事件给前端调播放器音量。
 * 离开音乐页 setEnabled(false)：音量键恢复系统默认（调系统媒体音量、弹系统条）。
 *
 * captured 用 static volatile：供 MainActivity.onKeyDown 同步读取（按键回调不能异步等）。
 */
@CapacitorPlugin(name = "VolumeKeys")
public class VolumeKeysPlugin extends Plugin {

  public static volatile boolean captured = false;

  @PluginMethod
  public void setEnabled(PluginCall call) {
    captured = Boolean.TRUE.equals(call.getBoolean("enabled", false));
    call.resolve();
  }
}
