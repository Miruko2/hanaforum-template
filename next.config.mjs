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
    ignoreBuildErrors: false,
  },
  
  // 图像配置 - dev 模式跳过优化（避免单实例服务端转码拖慢页面），
  // Capacitor 静态导出关闭，仅生产 Web 构建启用 next image 优化。
  images: {
    unoptimized: isCapacitor || process.env.NODE_ENV !== "production",
    // 以下配置在build时不起作用，但可以在开发模式下帮助优化
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 86400, // 24小时缓存
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
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
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      '@radix-ui/react-accordion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-collapsible',
      '@radix-ui/react-context-menu',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-hover-card',
      '@radix-ui/react-label',
      '@radix-ui/react-menubar',
      '@radix-ui/react-navigation-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-progress',
      '@radix-ui/react-radio-group',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toast',
      '@radix-ui/react-tooltip',
    ],
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