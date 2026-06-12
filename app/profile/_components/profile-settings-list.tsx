"use client"

import { Smartphone, LogOut, ChevronRight } from "lucide-react"

// 设置菜单（纯 UI）：下载应用 / 退出登录。
// 「编辑头像 / 编辑用户名」已移除——直接点头像圈、点名字旁的铅笔即可修改，
// 菜单不再重复入口、省出空间。
export interface ProfileSettingsListProps {
  onDownload: () => void
  onSignOut: () => void
}

export default function ProfileSettingsList({
  onDownload,
  onSignOut,
}: ProfileSettingsListProps) {
  return (
    <div className="profile-glass rounded-2xl">
      <button className="profile-menu-item" onClick={onDownload}>
        <div className="flex items-center space-x-3">
          <Smartphone className="w-5 h-5 text-lime-400" />
          <span className="text-white">下载应用</span>
        </div>
        <ChevronRight className="profile-menu-arrow w-5 h-5 text-white/40" />
      </button>

      <div className="h-px bg-white/5 mx-6" />

      <button className="profile-menu-item danger" onClick={onSignOut}>
        <div className="flex items-center space-x-3">
          <LogOut className="w-5 h-5 text-red-400" />
          <span className="text-red-400">退出登录</span>
        </div>
        <ChevronRight className="profile-menu-arrow w-5 h-5 text-white/40" />
      </button>
    </div>
  )
}
