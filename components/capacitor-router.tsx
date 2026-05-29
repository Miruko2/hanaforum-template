'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// 全局状态简化，避免复杂逻辑
const isCapacitorEnvironment = () => {
  if (typeof window !== 'undefined') {
    return !!(window as any).Capacitor || window.location.protocol === 'file:';
  }
  return false;
};

// 最简单的组件，只监视页面变化
export const CapacitorRouter = () => {
  const pathname = usePathname();

  useEffect(() => {
    if (isCapacitorEnvironment()) {
      console.debug('当前页面:', pathname);
    }
  }, [pathname]);

  return null;
};

// 导航hook简化
export const useCapacitorNavigation = () => {
  const router = useRouter();
  
  // 简化的导航方法
  const navigate = (path: string) => {
    if (isCapacitorEnvironment()) {
      // 在Capacitor中直接使用HTML导航
      if (path === '/') {
        window.location.href = '../index.html';
      } else {
        const cleanPath = path.startsWith('/') ? path.substring(1) : path;
        window.location.href = `../${cleanPath}/index.html`;
      }
    } else {
      router.push(path);
    }
  };
  
  return {
    navigate,
    isCapacitor: isCapacitorEnvironment()
  };
};

// 完全重写的链接组件
export const AuthLink = ({ 
  href, 
  children, 
  className,
  onClick,
  ...props 
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  [key: string]: any;
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    
    // 执行自定义点击处理
    if (onClick) {
      onClick(e);
    }
    
    // 直接导航到目标页面
    if (isCapacitorEnvironment()) {
      console.debug('进行Capacitor导航:', href);
      
      // 移动端直接使用location.href
      if (href === '/' || href === '') {
        window.location.href = '../index.html';
      } else {
        // 移除开头的斜杠
        const cleanPath = href.startsWith('/') ? href.substring(1) : href;
        try {
          window.location.href = `../${cleanPath}/index.html`;
        } catch (error) {
          console.error('导航失败，尝试备用方式', error);
          // 备用导航方式
          window.location.assign(`../${cleanPath}/index.html`);
        }
      }
    } else {
      // 浏览器环境
      window.location.href = href;
    }
  };
  
  return (
    <a href={href} onClick={handleClick} className={className} {...props}>
      {children}
    </a>
  );
};

// 需要将原来的函数暴露出来，避免引用错误
export const setNavigationDisabled = (disabled: boolean) => {
  console.debug('导航控制已简化，此功能不再生效');
};

export const disableNavigationTemporary = (milliseconds: number = 5000) => {
  console.debug('导航控制已简化，此功能不再生效');
}; 