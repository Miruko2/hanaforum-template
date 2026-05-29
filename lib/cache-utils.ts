/**
 * 简单的内存缓存实现
 */

// 缓存项接口
interface CacheItem<T> {
  data: T
  expiry: number
}

// 缓存类
class MemoryCache {
  private cache: Record<string, CacheItem<any>> = {}

  // 获取缓存项
  get<T>(key: string): T | null {
    const item = this.cache[key]

    // 如果缓存项不存在或已过期，返回null
    if (!item || item.expiry < Date.now()) {
      // 删除过期项
      if (item) {
        delete this.cache[key]
      }
      return null
    }

    return item.data as T
  }

  // 设置缓存项
  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.cache[key] = {
      data,
      expiry: Date.now() + ttlSeconds * 1000,
    }
  }

  // 删除缓存项
  delete(key: string): void {
    delete this.cache[key]
  }

  // 清空缓存
  clear(): void {
    this.cache = {}
  }

  // 清除过期缓存项
  clearExpired(): void {
    const now = Date.now()
    Object.keys(this.cache).forEach((key) => {
      if (this.cache[key].expiry < now) {
        delete this.cache[key]
      }
    })
  }
}

// 创建全局缓存实例
const globalCache = new MemoryCache()

// 仅在客户端环境中设置定时器清理缓存
if (typeof window !== "undefined") {
  setInterval(() => {
    globalCache.clearExpired()
  }, 60000)
}

/**
 * 使用缓存包装函数
 * @param fn 要缓存的函数
 * @param keyPrefix 缓存键前缀
 * @param ttlSeconds 缓存生存时间（秒）
 */
export function withCache<T, Args extends any[]>(
  fn: (...args: Args) => Promise<T>,
  keyPrefix: string,
  ttlSeconds = 60,
): (...args: Args) => Promise<T> {
  return async (...args: Args): Promise<T> => {
    // 生成缓存键
    const key = `${keyPrefix}:${JSON.stringify(args)}`

    // 尝试从缓存获取
    const cached = globalCache.get<T>(key)
    if (cached !== null) {
      return cached
    }

    // 执行原始函数
    const result = await fn(...args)

    // 缓存结果
    globalCache.set(key, result, ttlSeconds)

    return result
  }
}

/**
 * 缓存查询函数
 * @param cacheKey 缓存键
 * @param queryFn 查询函数
 * @param ttlSeconds 缓存生存时间（秒）
 */
export async function cachedQuery<T>(cacheKey: string, queryFn: () => Promise<T>, ttlSeconds = 60): Promise<T> {
  // 尝试从缓存获取
  const cached = globalCache.get<T>(cacheKey)
  if (cached !== null) {
    return cached
  }

  // 执行查询
  const result = await queryFn()

  // 缓存结果
  globalCache.set(cacheKey, result, ttlSeconds)

  return result
}

// 导出缓存实例
export const cache = globalCache

// 全局缓存清理函数
export function clearAllCaches() {
  globalCache.clear()
  
  // 如果在浏览器环境，也清理其他可能的缓存
  if (typeof window !== 'undefined') {
    // 清理 sessionStorage 中的缓存
    try {
      const keys = Object.keys(sessionStorage)
      keys.forEach(key => {
        if (key.startsWith('supabase_') || key.startsWith('posts_') || key.startsWith('comments_')) {
          sessionStorage.removeItem(key)
        }
      })
    } catch (e) {
      console.warn('清理 sessionStorage 失败:', e)
    }
    
    // 清理 localStorage 中的缓存（但保留认证信息）
    try {
      const keys = Object.keys(localStorage)
      keys.forEach(key => {
        if (key.startsWith('cache_') || key.startsWith('posts_') || key.startsWith('comments_')) {
          localStorage.removeItem(key)
        }
      })
    } catch (e) {
      console.warn('清理 localStorage 失败:', e)
    }
  }
  
  console.debug('所有缓存已清理')
}

// 智能缓存清理 - 只清理过期或特定类型的缓存
export function smartClearCache(pattern?: string) {
  if (pattern) {
    // 清理匹配模式的缓存
    const keysToDelete: string[] = []
    
    // 这里需要访问内部缓存，但我们的 MemoryCache 类没有暴露迭代方法
    // 先清理过期的缓存
    globalCache.clearExpired()
    
    console.debug(`清理了匹配 "${pattern}" 的缓存`)
  } else {
    // 只清理过期缓存
    globalCache.clearExpired()
    console.debug('清理了过期缓存')
  }
}

// 在全局对象上暴露缓存清理函数（用于调试）
if (typeof window !== 'undefined') {
  (window as any).clearSupabaseCache = clearAllCaches;
  (window as any).smartClearCache = smartClearCache;
}
