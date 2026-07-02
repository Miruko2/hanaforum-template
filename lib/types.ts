// 帖子携带的「歌曲信息」（音乐分享卡）。存于 posts.music（jsonb）。
// 在线歌/精选歌 playable=true、audio 为可播放地址；本地上传歌 playable=false、audio 为空。
export interface SharedMusic {
  title: string
  artist: string
  cover?: string          // 封面地址（在线歌外链 / 本地歌发布时托管的小图，可空）
  audio?: string          // 播放地址（在线歌可播；本地歌为空，不可在线播放）
  source?: string         // 来源：featured / netease / qq / link / local
  playable?: boolean      // 能否在线播放（在线/精选 true；本地 false）
}

// 更新Post接口以匹配您的数据库结构
export interface Post {
  id: string
  user_id: string
  title: string
  category: string
  content: string // 数据库中的内容字段
  description: string // 数据库中的描述字段
  image_url?: string // 封面图（= image_urls[0]），单图/缩略图/审核等链路以它为准
  image_urls?: string[] // 全部图片（按上传顺序，第一张为封面）；单图老帖可能为空，按 [image_url] 回退
  image_ratio?: number
  image_mask_url?: string // 主体遮罩图（灰度 PNG）：单图帖开「3D 视差」时生成，渲染端据此启用主体视差，见 components/subject-parallax
  music?: SharedMusic | null // 音乐分享卡：非空时该帖渲染成音乐卡（封面/歌名/歌手 + 播放）；普通帖为空
  likes_count?: number // UI使用
  comments_count?: number // UI使用
  likes: number // 数据库中的字段
  comments: number // 数据库中的字段
  created_at: string
  username?: string // 用于显示，从关联查询中获取
  imageContent?: string // 用于UI显示，当没有图片时
  users?: UserRecord; // 添加 users 属性，匹配 join 返回的结构
  is_nsfw?: boolean // 管理员标记的敏感内容：首页封面隐藏为模糊警告占位（见 components/post-card-image），详情页仍显示原图
}

// 用户记录接口
export interface UserRecord {
  id?: string
  username?: string
  email?: string
  avatar_url?: string
}

export interface PostInput {
  title: string
  category: string
  content: string
  description: string
  image_url?: string
  image_urls?: string[]
  image_ratio?: number
  music?: SharedMusic | null
  is_nsfw?: boolean
}

export interface Like {
  id: string
  user_id: string
  post_id: string
  created_at: string
}

export interface Comment {
  id: string
  user_id: string
  post_id: string
  parent_id?: string
  content: string
  created_at: string
  username?: string
  likes_count?: number
  likes?: number
  replies?: Comment[]
  user?: {
    id: string
    username: string
    avatar_url?: string
  }
}

// 通知类型
export type NotificationType = 'like_post' | 'comment_post' | 'like_comment' | 'post_removed' | 'announcement' | 'follow' | 'chat_mention' | 'friend_link_apply';

// 友链申请通知（type=friend_link_apply）携带的结构化快照，点击通知后在弹窗里完整展示。
export interface FriendLinkMeta {
  site_name?: string
  site_url?: string
  icon_url?: string | null
  description?: string | null
  contact?: string
  created_at?: string
}

// 通知接口
export interface Notification {
  id: string
  user_id: string      // 接收通知的用户
  type: NotificationType
  post_id?: string     // 相关帖子ID（可选）
  comment_id?: string  // 相关评论ID（可选）
  announcement_id?: string // 相关公告ID（type=announcement 时有值）
  actor_id?: string    // 触发者ID
  message: string      // 通知内容
  is_read: boolean     // 是否已读
  created_at: string
  meta?: Record<string, any> | null // 结构化附加数据（friend_link_apply 存申请快照，见 FriendLinkMeta）
  // 关联数据
  actor?: {
    username: string
    avatar_url?: string
  }
  post?: {
    title: string
  }
  comment?: {
    content: string
  }
}
