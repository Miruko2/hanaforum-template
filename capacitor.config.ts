import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.firefly.forum',
  appName: '萤火虫之国',
  // 远程加载模式：APK 启动后 WebView 直接打开 server.url（线上域名）
  // webDir 仅作为占位 + 极端兜底（详见 capacitor-shell/index.html 注释）
  webDir: 'capacitor-shell',
  server: {
    // 让 APK 永远跟 Web 同步：改前端不用重打 APK，用户刷新就拿到最新版
    // 代价：断网 → 显示 capacitor-shell 的"正在连接"占位
    url: 'https://forum.hanakos.cc',
    androidScheme: 'https',
    cleartext: true, // 允许HTTP明文通信，便于调试
    allowNavigation: ['*'],
  },
  android: {
    allowMixedContent: true, // 允许混合内容便于调试
    captureInput: false, // 修改为 false 以解决中文输入问题
    webContentsDebuggingEnabled: true, // 启用WebView调试
    initialFocus: true,
    backgroundColor: "#FFFFFF",
  },
  plugins: {
    CapacitorCookies: {
      enabled: true, // 确保启用Cookie
    },
    CapacitorHttp: {
      enabled: true,
    },
    WebView: {
      serverAssets: ['public'],
      allowFileAccess: true,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#488AFF",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
  loggingBehavior: 'debug',
};

export default config;
