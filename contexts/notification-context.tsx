"use client"

import React, { createContext, useState, useContext, useEffect, useRef, ReactNode } from 'react'
import { useSimpleAuth } from '@/contexts/auth-context-simple'
import { 
  getUserNotifications, 
  getUnreadNotificationsCount, 
  markNotificationAsRead, 
  markAllNotificationsAsRead,
  subscribeToNotifications
} from '@/lib/supabase'
import { subscribeToNotificationsRealtime } from '@/lib/supabase-notifications'
import type { Notification } from '@/lib/types'

interface NotificationContextType {
  notifications: Notification[]
  unreadCount: number
  isLoading: boolean
  fetchNotifications: (options?: { limit?: number; offset?: number; onlyUnread?: boolean }) => Promise<void>
  markAsRead: (notificationId: string) => Promise<void>
  markAllAsRead: () => Promise<void>
  refreshNotifications: () => Promise<void>
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined)

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const { user } = useSimpleAuth()
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const lastFetchTimeRef = useRef<number>(0)
  const isVisibleRef = useRef<boolean>(true)

  // 获取通知列表 - 内部版本，返回布尔值表示是否有新通知
  const fetchNotificationsInternal = async (options?: { limit?: number; offset?: number; onlyUnread?: boolean }): Promise<boolean> => {
    if (!user) return false
    
    // 限制频繁获取，至少间隔3秒
    const now = Date.now()
    if (now - lastFetchTimeRef.current < 3000) {
      return false
    }
    lastFetchTimeRef.current = now
    
    if (!isVisibleRef.current) {
      console.debug('页面不可见，跳过获取通知')
      return false
    }
    
    setIsLoading(true)
    try {
      console.debug('正在获取通知...')
      const { notifications } = await getUserNotifications(user.id, options)
      
      // 确保返回的通知是有效的数组
      if (Array.isArray(notifications)) {
        console.debug(`获取到 ${notifications.length} 条通知`)
        setNotifications(notifications as Notification[])
      } else {
        console.error('返回的通知不是数组:', notifications)
        setNotifications([])
      }
      
      // 更新未读数量
      const count = await getUnreadNotificationsCount(user.id)
      setUnreadCount(count || 0)
      
      return true // 指示成功获取通知
    } catch (error) {
      console.error('获取通知失败:', error)
      setNotifications([])
      return false
    } finally {
      setIsLoading(false)
    }
  }
  
  // 对外暴露的获取通知方法 - 符合接口定义
  const fetchNotifications = async (options?: { limit?: number; offset?: number; onlyUnread?: boolean }): Promise<void> => {
    await fetchNotificationsInternal(options)
  }

  // 手动刷新通知
  const refreshNotifications = async (): Promise<void> => {
    console.debug('手动刷新通知')
    await fetchNotificationsInternal()
  }

  // 标记通知为已读
  const markAsRead = async (notificationId: string) => {
    if (!user) return
    
    try {
      const success = await markNotificationAsRead(notificationId, user.id)
      if (success) {
        // 更新本地状态
        setNotifications(prev => 
          prev.map(notification => 
            notification.id === notificationId
              ? { ...notification, is_read: true }
              : notification
          )
        )
        
        // 更新未读数量
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    } catch (error) {
      console.error('标记通知已读失败:', error)
    }
  }

  // 标记所有通知为已读
  const markAllAsRead = async () => {
    if (!user) return
    
    try {
      const success = await markAllNotificationsAsRead(user.id)
      if (success) {
        // 更新本地状态
        setNotifications(prev => 
          prev.map(notification => ({ ...notification, is_read: true }))
        )
        
        // 更新未读数量
        setUnreadCount(0)
      }
    } catch (error) {
      console.error('标记所有通知已读失败:', error)
    }
  }

  // 监听页面可见性变化
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = document.visibilityState === 'visible'
      console.debug('页面可见性变化:', isVisible ? '可见' : '不可见')
      isVisibleRef.current = isVisible
      
      if (isVisible) {
        // 页面变为可见时立即刷新通知
        fetchNotificationsInternal()
      }
    }
    
    // 添加事件监听
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // 清理函数
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // 设置实时订阅通知
  useEffect(() => {
    if (!user) {
      setNotifications([])
      setUnreadCount(0)
      
      // 清理现有订阅
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
      return
    }

    console.debug('设置通知实时订阅...')
    
    // 处理收到的通知更新
    const handleNotificationsUpdate = (updatedNotifications: Notification[]) => {
      console.debug(`收到通知更新: ${updatedNotifications.length} 条通知`)
      setNotifications(updatedNotifications)
      
      // 计算未读数量
      const unreadCount = updatedNotifications.filter(n => !n.is_read).length
      setUnreadCount(unreadCount)
    }
    
    // 启动实时订阅
    const unsubscribe = subscribeToNotificationsRealtime(user.id, handleNotificationsUpdate)
    unsubscribeRef.current = unsubscribe
    
    // 组件卸载时清理订阅
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [user])

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isLoading,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        refreshNotifications
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return context
} 