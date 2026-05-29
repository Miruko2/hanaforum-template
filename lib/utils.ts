import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"

// 全局变量用于保存滚动位置，作为备份方案
let lastKnownScrollPosition = 0;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 节流函数 - 确保函数在指定的时间内最多执行一次
 * @param fn 要节流的函数
 * @param delay 延迟时间（毫秒）
 * @returns 节流后的函数
 */
export function throttle<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: NodeJS.Timeout | null = null;
  
  return function(this: any, ...args: Parameters<T>) {
    const now = Date.now();
    const remaining = delay - (now - lastCall);
    
    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn.apply(this, args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * 防抖函数 - 确保函数在指定的延迟后只执行一次
 * @param fn 要防抖的函数
 * @param delay 延迟时间（毫秒）
 * @param immediate 是否在延迟开始前立即执行
 * @returns 防抖后的函数
 */
export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number, immediate = false): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  
  return function(this: any, ...args: Parameters<T>) {
    const callNow = immediate && !timeoutId;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (!immediate) {
        fn.apply(this, args);
      }
    }, delay);
    
    if (callNow) {
      fn.apply(this, args);
    }
  };
}

/**
 * 格式化日期为相对时间（例如：3小时前）
 * @param dateString - ISO格式的日期字符串
 * @returns 格式化后的相对时间字符串
 */
export function formatDate(dateString: string): string {
  if (!dateString) return ""

  try {
    const date = new Date(dateString)
    return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
  } catch (error) {
    console.error("日期格式化错误:", error)
    return dateString
  }
}

/**
 * 截断文本到指定长度，并添加省略号
 * @param text - 要截断的文本
 * @param maxLength - 最大长度
 * @returns 截断后的文本
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text
  return text.slice(0, maxLength) + "..."
}

/**
 * 生成随机ID
 * @returns 随机ID字符串
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

/**
 * 锁定页面滚动并返回当前滚动位置
 * @returns 当前页面的滚动位置
 */
export function lockPageScroll(): number {
  const scrollY = window.scrollY
  document.body.style.overflow = 'hidden'
  document.body.style.position = 'fixed'
  document.body.style.top = `-${scrollY}px`
  document.body.style.width = '100%'
  document.body.style.touchAction = 'none'
  return scrollY
}

/**
 * 解锁页面滚动并恢复到指定位置
 * @param scrollY 要恢复到的滚动位置
 */
export function unlockPageScroll(scrollY: number): void {
  // 从body的top样式中获取保存的滚动位置
  const savedPosition = document.body.style.top
  
  // 清除所有锁定样式
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.top = ''
  document.body.style.width = ''
  document.body.style.touchAction = ''
  
  // 使用setTimeout确保在DOM更新后恢复滚动位置
  setTimeout(() => {
    // 优先使用保存在body样式中的位置，如果没有则使用传入的scrollY
    const finalPosition = savedPosition ? parseInt(savedPosition.replace('px', '')) * -1 : scrollY
    
    window.scrollTo({
      top: finalPosition,
      behavior: 'auto' // 使用auto代替instant，确保立即滚动
    })
    
    console.debug('恢复滚动位置:', finalPosition)
  }, 10) // 稍微增加延迟，确保DOM完全更新
}

/**
 * 获取当前滚动位置
 * @returns 当前页面的滚动位置
 */
export function getScrollPosition(): number {
  return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0
}

/**
 * 解析保存在body样式中的滚动位置
 * @returns 解析后的滚动位置
 */
export function parseBodyScrollPosition(): number {
  try {
    const savedPosition = document.body.style.top || document.body.style.marginTop
    if (!savedPosition) return 0
    
    // 去掉px并转换为正数
    return Math.abs(parseInt(savedPosition.replace('px', '')) || 0)
  } catch (e) {
    console.error('解析滚动位置出错:', e)
    return 0
  }
}

/**
 * 保存当前滚动位置到全局变量
 */
export function saveScrollPosition(): number {
  lastKnownScrollPosition = getScrollPosition();
  return lastKnownScrollPosition;
}

/**
 * 获取上次保存的滚动位置
 */
export function getLastSavedScrollPosition(): number {
  return lastKnownScrollPosition;
}

/**
 * 在window对象上保存滚动位置
 */
export function saveScrollPositionToWindow(): number {
  const pos = getScrollPosition();
  if (typeof window !== 'undefined') {
    (window as any).__lastScrollPosition = pos;
  }
  return pos;
}

/**
 * 从window对象获取保存的滚动位置
 */
export function getScrollPositionFromWindow(): number {
  if (typeof window !== 'undefined') {
    return (window as any).__lastScrollPosition || 0;
  }
  return 0;
}

/**
 * 综合方法：保存滚动位置到所有可能的存储位置
 */
export function saveScrollPositionEverywhere(): number {
  const pos = getScrollPosition();
  lastKnownScrollPosition = pos;
  if (typeof window !== 'undefined') {
    (window as any).__lastScrollPosition = pos;
  }
  return pos;
}

/**
 * 综合方法：从所有可能的存储位置获取滚动位置
 */
export function getBestScrollPosition(): number {
  const bodyPos = parseBodyScrollPosition();
  const windowPos = getScrollPositionFromWindow();
  const varPos = lastKnownScrollPosition;
  
  // 返回第一个非零值，或者0
  return bodyPos || windowPos || varPos || 0;
}
