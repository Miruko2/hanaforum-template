import bundleAnalyzer from '@next/bundle-analyzer'

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
const isCapacitor = process.env.CAPACITOR_BUILD === 'true'

const nextConfig = {
  // 基础配置
  reactStrictMode: true,
  swcMinify: true,

  // Capacitor 构建时使用静态导出
  ...(isCapacitor && { output: 'export', trailingSlash: true }),
  
  // ESLint 配置引用了未安装的 prettier/tailwindcss plugin，先保持非阻塞；
  // TypeScript 错误已清零，开启严格构建。
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Web 部署（Vercel）走 npm + --legacy-peer-deps，dep tree 恰好兼容，开启严格检查；
    // Capacitor 构建在本地 pnpm 环境下，@types/react 18.3.29 与 Radix 1.1.x
    // 的 forwardRef props 推断不兼容，产生一堆"className/children 不存在"假错。
    // 代码本身在 Vercel 上跑得好好的，跳过 TS 检查不影响 APK 产物正确性。
    // 治本路径：删 package-lock.json + pnpm overrides 钉 @types/react@18.2.x（技术债）
    ignoreBuildErrors: isCapacitor,
  },
  
  // 图像配置 - dev 模式跳过优化（避免单实例服务端转码拖慢页面），
  // Capacitor 静态导出关闭，仅生产 Web 构建启用 next image 优化。
  images: {
    unoptimized: isCapacitor || process.env.NODE_ENV !== "production",
    // 以下配置在build时不起作用，但可以在开发模式下帮助优化
    // 精简变体数（原 7+8 档）→ 降低 Vercel Image Optimization 的 transformation 次数：
    // 每多一个尺寸/格式档，同一源图就可能多生成一份、多吃一次 transformation 额度。
    deviceSizes: [640, 1080, 1920],
    imageSizes: [64, 128, 256],
    // 只留 webp：原 webp+avif 会让同一源图按浏览器各生成一份（×2 transformation）；
    // webp 覆盖率足够，去掉 avif 直接砍掉一半图片转换消耗。
    formats: ['image/webp'],
    minimumCacheTTL: 86400, // 24小时缓存
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    // 安全：之前是 hostname:'**' 接受任意 HTTPS 主机，相当于把 /_next/image
    // 端点变成开放代理，攻击者能用它去 SSRF / 流量放大。改成显式白名单。
    // 注（2026-06-11）：Vercel Image Optimization 免费额度爆掉（5K/月）后，帖子图
    // （post-card-image/cinema-mode/post-timeline）与音乐封面（TrackCover）已全部
    // 改为原生 <img> 直连（帖子图走 640px 缩略图约定，见 lib/post-image-thumb）。
    // 白名单保留是为了兜底——若还有零散 next/image 引用这些主机不至于直接报错。
    // 以后接 OAuth 或别的 CDN，往这里加对应 hostname。
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '**.music.126.net',
      },
    ],
  },
  
  // 移除所有实验性功能，避免冲突
  experimental: {
    // 只保留必要的滚动恢复
    scrollRestoration: true,
    // 启用内存缓存优化
    optimizeCss: true,
    // 优化大型包的导入，减少 bundle 体积
    // ⚠️ 临时禁用：定位 Vercel 构建时 micromatch 栈溢出（疑似长列表触发递归）
    // optimizePackageImports: [
    //   'lucide-react',
    //   'date-fns',
    //   '@radix-ui/react-accordion',
    //   '@radix-ui/react-alert-dialog',
    //   '@radix-ui/react-avatar',
    //   '@radix-ui/react-checkbox',
    //   '@radix-ui/react-collapsible',
    //   '@radix-ui/react-context-menu',
    //   '@radix-ui/react-dialog',
    //   '@radix-ui/react-dropdown-menu',
    //   '@radix-ui/react-hover-card',
    //   '@radix-ui/react-label',
    //   '@radix-ui/react-menubar',
    //   '@radix-ui/react-navigation-menu',
    //   '@radix-ui/react-popover',
    //   '@radix-ui/react-progress',
    //   '@radix-ui/react-radio-group',
    //   '@radix-ui/react-scroll-area',
    //   '@radix-ui/react-select',
    //   '@radix-ui/react-separator',
    //   '@radix-ui/react-slot',
    //   '@radix-ui/react-switch',
    //   '@radix-ui/react-tabs',
    //   '@radix-ui/react-toast',
    //   '@radix-ui/react-tooltip',
    // ],
  },
  
  // 性能优化: 在生产环境中移除console.log
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  
  // 自定义webpack配置，优化资源加载
  webpack: (config, { dev, isServer }) => {
    // 只在客户端构建中应用以下优化
    if (!isServer) {
      // 优化图片资源
      config.module.rules.push({
        test: /\.(png|jpe?g|gif|webp)$/i,
        use: [
          {
            loader: 'image-webpack-loader',
            options: {
              disable: dev,
              mozjpeg: {
                progressive: true,
                quality: 80,
              },
              optipng: {
                enabled: true,
              },
              pngquant: {
                quality: [0.65, 0.90],
                speed: 4,
              },
              gifsicle: {
                interlaced: false,
              },
              webp: {
                quality: 80,
              },
            },
          },
        ],
      });
    }
    
    return config;
  },
}

export default withBundleAnalyzer(nextConfig) 