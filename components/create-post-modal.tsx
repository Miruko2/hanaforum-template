"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { X, ImageIcon, Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createPortal } from "react-dom"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabaseClient"
import { updatePost } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { CATEGORIES } from "@/lib/categories"
import type { Post } from "@/lib/types"
import { compressImage } from "@/lib/image-compress"
import { postThumbName, POST_THUMB_EDGE } from "@/lib/post-image-thumb"

interface CreatePostModalProps {
  onClose: () => void
  onPostCreated: () => void
  /** 传入时进入编辑模式，对该帖子做更新而不是新建 */
  editPost?: Post
  /** 编辑成功时回调，用于父组件就地更新帖子数据 */
  onPostUpdated?: (postId: string, updates: Partial<Post>) => void
}

// 客户端压缩函数已抽到 @/lib/image-compress（帖子图与头像共用），见顶部 import。

/**
 * 表单本体（无外壳）：标题/分类/内容/图片 + 提交逻辑。
 * 首页发帖走果冻形变面板（floating-action-button），编辑帖子走下方的 CreatePostModal 外壳。
 */
export function CreatePostForm({
  onClose,
  onPostCreated,
  editPost,
  onPostUpdated,
}: CreatePostModalProps) {
  const isEditMode = Boolean(editPost)

  const [description, setDescription] = useState(editPost?.description || editPost?.content || "")
  const [title, setTitle] = useState(editPost?.title || "")
  const [category, setCategory] = useState(editPost?.category || "general")
  const [imagePreview, setImagePreview] = useState<string | null>(editPost?.image_url || null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  // 记录用户是否主动移除了原图，以便提交时把 image_url 置空
  const [imageCleared, setImageCleared] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { user } = useSimpleAuth()
  const { toast } = useToast()
  const [imageRatio, setImageRatio] = useState<number>(editPost?.image_ratio || 0.75)

  // 处理图片上传
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // 检查文件大小，限制为5MB
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "文件过大",
          description: "图片大小不能超过5MB",
          variant: "destructive",
        })
        return
      }

      setImageFile(file)
      setImageCleared(false)
      const reader = new FileReader()
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string)

        // 计算图片比例
        const img = new Image()
        img.onload = () => {
          const ratio = img.height / img.width
          setImageRatio(ratio)
        }
        img.src = e.target?.result as string
      }
      reader.readAsDataURL(file)
    }
  }

  // 上传图片到Supabase Storage（上传前先客户端压缩，从源头降存储与 egress）
  const uploadImage = async (file: File): Promise<string> => {
    try {
      // 限最大边 1920 + 转 webp + 降质量：数 MB 原图 → 几百 KB。
      const { blob, ext, contentType } = await compressImage(file)
      const fileName = `${Math.random().toString(36).substring(2, 15)}.${ext}`
      const filePath = `${fileName}` // 移除了 post-images/ 前缀，因为存储桶本身就叫 post-images

      const { data, error } = await supabase.storage.from("post-images").upload(filePath, blob, {
        // 文件名随机唯一、内容不变 → 缓存 1 年，最大化 CDN/浏览器缓存命中、减少回源 egress。
        cacheControl: "31536000",
        upsert: false,
        contentType,
      })

      if (error) {
        console.error("图片上传错误详情:", error)
        throw error
      }

      // 同步传一张 640px 缩略图（路径约定见 lib/post-image-thumb）：列表卡片直连
      // 缩略图省 Supabase egress，灯箱才开主图。失败不阻断发帖——卡片端会
      // onError 回退主图，只是该帖费点流量。
      try {
        const thumbName = postThumbName(data.path)
        if (thumbName) {
          const thumb = await compressImage(file, POST_THUMB_EDGE, 0.8)
          // compressImage 失败时原样返回 file（passthrough），别把数 MB 原图当缩略图传
          if (thumb.blob !== file) {
            await supabase.storage.from("post-images").upload(thumbName, thumb.blob, {
              cacheControl: "31536000",
              upsert: false,
              contentType: thumb.contentType,
            })
          }
        }
      } catch (thumbErr) {
        console.warn("缩略图上传失败（不影响发帖）:", thumbErr)
      }

      // 获取公共URL - 这里也需要更新存储桶名称
      const { data: urlData } = supabase.storage.from("post-images").getPublicUrl(data.path)
      return urlData.publicUrl
    } catch (error: any) {
      console.error("图片上传错误:", error)
      throw new Error(`图片上传失败: ${error.message}`)
    }
  }

  // 创建帖子
  const createPost = async (postData: any) => {
    try {
      const { data, error } = await supabase.from("posts").insert([postData]).select()

      if (error) {
        console.error("创建帖子错误:", error)
        throw error
      }

      return { data, error: null }
    } catch (err) {
      console.error("创建帖子过程中出错:", err)
      throw err
    }
  }

  // 修改 handleSubmit 函数，简化认证处理
  const handleSubmit = async () => {
    if (!user) {
      toast({
        title: "请先登录",
        description: (isEditMode ? "编辑" : "发布") + "帖子前请先登录账号",
        variant: "destructive",
      })
      return
    }

    if (!title.trim() || !description.trim() || !category.trim()) {
      toast({
        title: "信息不完整",
        description: "请填写标题、分类和内容",
        variant: "destructive",
      })
      return
    }

    try {
      setIsSubmitting(true)
      console.debug("当前用户:", user.id)

      // 处理图片上传
      // 新建模式：undefined 表示没图；
      // 编辑模式：undefined 表示保持原图不变，null 表示清空，字符串表示换新图
      let image_url: string | null | undefined = undefined
      if (imageFile) {
        try {
          console.debug("开始上传图片...")
          image_url = await uploadImage(imageFile)
          console.debug("上传的图片URL:", image_url)
        } catch (uploadErr: any) {
          console.error("图片上传过程中出错:", uploadErr)
          toast({
            title: "图片上传失败",
            description: `错误: ${uploadErr.message || "未知错误"}`,
            variant: "destructive",
          })
          setIsSubmitting(false)
          return
        }
      } else if (isEditMode && imageCleared) {
        image_url = null
      }

      if (isEditMode && editPost) {
        // 编辑模式：调用 updatePost
        const updated = await updatePost({
          postId: editPost.id,
          title,
          content: description,
          description,
          category,
          image_url,
          image_ratio: imageRatio,
        })

        console.debug("帖子更新成功:", updated)

        toast({
          title: "更新成功",
          description: "帖子已更新",
        })

        if (onPostUpdated) {
          const patch: Partial<Post> = {
            title,
            content: description,
            description,
            category,
            image_ratio: imageRatio,
          }
          if (image_url !== undefined) {
            patch.image_url = image_url === null ? undefined : image_url
          }
          onPostUpdated(editPost.id, patch)
        }

        onPostCreated()
        onClose()
        return
      }

      console.debug("准备创建帖子，用户ID:", user.id)

      // 创建帖子 - 同时设置content和description字段
      const result = await createPost({
        title,
        category,
        description,
        content: description,
        image_url: image_url || undefined,
        image_ratio: imageRatio,
        user_id: user.id,
        likes: 0,
        comments: 0,
      })

      console.debug("帖子创建成功:", result)

      toast({
        title: "发布成功",
        description: "您的帖子已成功发布",
      })

      onPostCreated()
      onClose()
    } catch (error: any) {
      console.error(isEditMode ? "更新帖子失败:" : "发布帖子失败:", error)

      let errorMessage = (isEditMode ? "更新" : "发布") + "帖子时出现错误，请稍后重试"
      if (error.message) {
        errorMessage = error.message
      }

      toast({
        title: isEditMode ? "更新失败" : "发布失败",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // 点击上传图片按钮
  const handleImageButtonClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <>
      {/* 关闭按钮 */}
      <button
        className="absolute top-3 right-3 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 hover:text-white/80 transition-colors duration-300"
        onClick={onClose}
        disabled={isSubmitting}
      >
        <X className="h-5 w-5" />
      </button>

        <div className="p-5">
          <h3 className="text-xl font-semibold text-white mb-5">{isEditMode ? "编辑帖子" : "创建新帖子"}</h3>

          <div className="space-y-4">
            {/* 标题输入 */}
            <div>
              <Label htmlFor="post-title" className="text-white/80 mb-1 block">
                标题
              </Label>
              <Input
                id="post-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="输入帖子标题..."
                className="bg-white/[0.06] border-white/[0.12] focus:border-white/30 text-white placeholder:text-white/40 focus:ring-white/20 rounded-lg"
                disabled={isSubmitting}
                required
              />
            </div>

            {/* 分类标签 */}
            <div>
              <Label className="text-white/80 mb-2 block">
                分类
              </Label>
              <div className="flex gap-2 flex-wrap">
                {CATEGORIES.map((tag) => {
                  const active = category === tag.value
                  return (
                    <button
                      key={tag.value}
                      type="button"
                      onClick={() => setCategory(tag.value)}
                      disabled={isSubmitting}
                      className={cn(
                        "px-4 py-1.5 rounded-2xl text-sm font-medium transition-all duration-200 border backdrop-blur-lg",
                        active
                          ? "bg-lime-400/20 border-lime-400/40 text-lime-400 shadow-lg"
                          : "bg-black/20 border-white/10 text-white/70 hover:text-white hover:bg-white/10"
                      )}
                    >
                      {tag.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 内容输入 */}
            <div>
              <Label htmlFor="post-description" className="text-white/80 mb-1 block">
                内容
              </Label>
              <Textarea
                id="post-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="分享你的想法..."
                className="min-h-[150px] bg-white/[0.06] border-white/[0.12] focus:border-white/30 text-white placeholder:text-white/40 focus:ring-white/20 rounded-lg"
                disabled={isSubmitting}
                required
              />
            </div>

            {/* 图片预览 */}
            {imagePreview && (
              <div className="relative mt-4 rounded-lg overflow-hidden border border-white/[0.12]">
                <img
                  src={imagePreview || "/placeholder.svg"}
                  alt="Preview"
                  className="w-full h-auto max-h-[200px] object-contain"
                />
                <button
                  className="absolute top-2 right-2 rounded-full bg-black/50 backdrop-blur-md p-1 text-white hover:text-white/80"
                  onClick={() => {
                    setImagePreview(null)
                    setImageFile(null)
                    setImageCleared(true)
                  }}
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* 隐藏的文件输入 */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
              id="image-upload"
              disabled={isSubmitting}
            />

            {/* 操作按钮 */}
            <div className="flex justify-between pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleImageButtonClick}
                className="bg-white/[0.08] border-white/[0.12] text-white/80 hover:bg-white/[0.12] hover:text-white backdrop-blur-md rounded-full"
                disabled={isSubmitting}
              >
                <ImageIcon className="h-4 w-4 mr-2" />
                上传图片
              </Button>

              <Button
                type="button"
                onClick={handleSubmit}
                className="bg-white/[0.12] border border-white/[0.15] text-white font-medium hover:bg-white/[0.18] backdrop-blur-md rounded-full"
                disabled={isSubmitting || !title.trim() || !description.trim() || !category.trim()}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isEditMode ? "保存中..." : "发布中..."}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    {isEditMode ? "保存修改" : "发布帖子"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
    </>
  )
}

/**
 * 旧外壳：portal + 遮罩 + 玻璃面板 + 滚动锁 + ESC。
 * 帖子编辑模式（post-card）仍走这里；首页新建帖子已改为果冻形变面板。
 */
export default function CreatePostModal(props: CreatePostModalProps) {
  const { onClose } = props
  const [isMounted, setIsMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const previousOverflow = useRef<string>("")

  useEffect(() => {
    setIsMounted(true)
    // 保存当前overflow值并锁定背景滚动
    previousOverflow.current = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.body.style.touchAction = "none" // 防止移动端滚动

    setIsMobile(window.innerWidth <= 768)

    // 使用防抖处理窗口大小变化事件
    let resizeTimeout: NodeJS.Timeout
    const handleResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        setIsMobile(window.innerWidth < 768)
      }, 100)
    }

    window.addEventListener("resize", handleResize)

    return () => {
      // 恢复背景滚动
      document.body.style.overflow = previousOverflow.current
      document.body.style.touchAction = ""
      window.removeEventListener("resize", handleResize)
      clearTimeout(resizeTimeout)
    }
  }, [])

  // 监听ESC键关闭模态框
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  if (!isMounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />

      <div
        className="relative max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4 rounded-2xl animate-in fade-in zoom-in duration-300"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxHeight: isMobile ? "85vh" : "90vh",
          // width 交给 tailwind 的 w-full + max-w-2xl 控制；
          // 只在移动端用内联 width 避开 16px 边距
          ...(isMobile ? { width: "calc(100% - 32px)" } : {}),
          background: "rgba(255, 255, 255, 0.07)",
          backdropFilter: "blur(24px) saturate(150%)",
          WebkitBackdropFilter: "blur(24px) saturate(150%)",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
        }}
      >
        <CreatePostForm {...props} />
      </div>
    </div>,
    document.body,
  )
}
