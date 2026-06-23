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
import { postImageList, postsHaveImageUrls } from "@/lib/post-images"
import { cdnUrl } from "@/lib/cdn-url"
import { guardVerify } from "@/lib/verify-gate-bus"
import ImageLightbox from "@/components/image-lightbox"
import { StickerPicker } from "@/components/stickers/sticker-picker"
import { makeStickerToken } from "@/lib/stickers"
import { generateMatte, matteToWebpBlob, isMatteSupported } from "@/lib/anime-matte"
import { postMaskName, postImageObjectName } from "@/lib/post-image-mask"
import { useIsMobile } from "@/hooks/use-mobile"

interface CreatePostModalProps {
  onClose: () => void
  onPostCreated: () => void
  /** 传入时进入编辑模式，对该帖子做更新而不是新建 */
  editPost?: Post
  /** 编辑成功时回调，用于父组件就地更新帖子数据 */
  onPostUpdated?: (postId: string, updates: Partial<Post>) => void
}

// 客户端压缩函数已抽到 @/lib/image-compress（帖子图与头像共用），见顶部 import。

// 发帖最多可上传的图片数
const MAX_IMAGES = 9

// 从 data URL / URL 载入为 <img>（给主体抠像用）
function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = src
  })
}

// 编辑区里的一张图片：可能是「已存在的图」（带 url，提交时直接复用）
// 或「新选的文件」（带 file，提交时上传）。preview 用于 <img> 即时显示。
type EditableImage = {
  id: string
  preview: string // data URL（新图）或 cdn 直链（已存在图）
  file?: File // 新选文件
  url?: string // 已存在图片的 public URL
}

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
  // 多图编辑列表（首张为封面）。编辑模式用帖子已有图片初始化。
  const [images, setImages] = useState<EditableImage[]>(() => {
    if (!editPost) return []
    return postImageList(editPost).map((url, i) => ({
      id: `existing-${i}`,
      preview: cdnUrl(url) || url,
      url,
    }))
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const { user } = useSimpleAuth()
  const { toast } = useToast()
  const isMobile = useIsMobile()
  // 「3D 视差」开关（实验）：仅单张新图、桌面端显示；提交时本机抠主体遮罩
  const [genParallax, setGenParallax] = useState(false)
  const [matteStatus, setMatteStatus] = useState("")
  const [imageRatio, setImageRatio] = useState<number>(editPost?.image_ratio || 0.75)
  // 点击预览图后，原图在屏幕中心聚焦放大（复用帖子详情页的灯箱）；记录看哪一张
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  // 封面比例 = 第一张图的比例（沿用原约定 height/width）。首图变化时重算。
  useEffect(() => {
    const first = images[0]
    if (!first) return
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth > 0) setImageRatio(img.naturalHeight / img.naturalWidth)
    }
    img.src = first.preview
  }, [images])

  // 处理图片上传（支持多选）：逐个校验大小、读为预览，追加进列表，最多 MAX_IMAGES 张
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) {
      toast({
        title: "图片数量已达上限",
        description: `最多只能上传 ${MAX_IMAGES} 张图片`,
        variant: "destructive",
      })
      e.target.value = ""
      return
    }

    let overSized = false
    const accepted = files.filter((file) => {
      if (file.size > 5 * 1024 * 1024) {
        overSized = true
        return false
      }
      return true
    })

    if (overSized) {
      toast({
        title: "部分图片过大",
        description: "单张图片大小不能超过 5MB，已自动跳过",
        variant: "destructive",
      })
    }

    const tooMany = accepted.length > remaining
    accepted.slice(0, remaining).forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const preview = ev.target?.result as string
        setImages((prev) => [
          ...prev,
          { id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, preview, file },
        ])
      }
      reader.readAsDataURL(file)
    })

    if (tooMany) {
      toast({
        title: "图片数量已达上限",
        description: `最多只能上传 ${MAX_IMAGES} 张图片，多余的已忽略`,
        variant: "destructive",
      })
    }

    // 清空 input，允许再次选择相同文件
    e.target.value = ""
  }

  // 移除一张图（首张被移除后，下一张自动成为新封面）
  const removeImage = (id: string) => {
    setImages((prev) => {
      const next = prev.filter((img) => img.id !== id)
      if (next.length === 0) setLightboxOpen(false)
      return next
    })
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

    // 懒触发邮箱验证：仅新建帖子时拦。未验证 → 弹验证窗并中止本次发布
    // （编辑已有帖子不拦；DB 触发器 block_unverified_write 仍是最终兜底）。
    if (!isEditMode && guardVerify()) {
      return
    }

    try {
      setIsSubmitting(true)
      console.debug("当前用户:", user.id)

      // 处理图片上传（多图）：保留已有图片的 URL，上传新选文件，按列表顺序组装。
      // 首张为封面（image_url），全部进 image_urls。
      // 编辑模式语义：undefined=保持不变，null=清空，数组=替换。
      const hadImages = isEditMode && !!editPost && postImageList(editPost).length > 0
      let finalUrls: string[] = []
      try {
        for (const item of images) {
          if (item.url) {
            finalUrls.push(item.url)
          } else if (item.file) {
            console.debug("开始上传图片...")
            finalUrls.push(await uploadImage(item.file))
          }
        }
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

      const cover = finalUrls[0]
      // 编辑模式：清空了所有图（之前有图）→ 置 null；否则按是否有图决定
      let image_url: string | null | undefined
      let image_urls: string[] | null | undefined
      if (finalUrls.length > 0) {
        image_url = cover
        image_urls = finalUrls
      } else if (isEditMode && hadImages) {
        image_url = null
        image_urls = null
      } else {
        image_url = undefined
        image_urls = undefined
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
          image_urls,
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
          if (image_urls !== undefined) {
            patch.image_urls = image_urls === null ? undefined : image_urls
          }
          onPostUpdated(editPost.id, patch)
        }

        onPostCreated()
        onClose()
        return
      }

      console.debug("准备创建帖子，用户ID:", user.id)

      // 「3D 视差」：单图新帖且用户勾选 → 本机抠主体遮罩、上传 _mask.png。
      // 全程 try/catch 非阻断：抠像或上传失败都不影响正常发帖（只是没有效果）。
      let maskUrl: string | null = null
      if (genParallax && images.length === 1 && images[0]?.file && cover) {
        try {
          const srcImg = await loadHtmlImage(images[0].preview)
          const matte = await generateMatte(srcImg, (phase) => {
            setMatteStatus(
              phase === "model"
                ? "首次需下载抠像模型(约 176MB，之后缓存)…"
                : phase === "infer"
                  ? "正在抠出主体…"
                  : "准备抠像引擎…",
            )
          })
          const blob = await matteToWebpBlob(matte)
          const coverName = postImageObjectName(cover)
          const maskName = coverName ? postMaskName(coverName) : null
          if (maskName) {
            const up = await supabase.storage.from("post-images").upload(maskName, blob, {
              cacheControl: "31536000",
              upsert: true,
              contentType: "image/webp",
            })
            if (!up.error) {
              maskUrl = supabase.storage.from("post-images").getPublicUrl(maskName).data.publicUrl
            }
          }
        } catch (mErr) {
          console.warn("视差遮罩生成失败（不影响发帖）:", mErr)
        } finally {
          setMatteStatus("")
        }
      }

      // 创建帖子 - 同时设置content和description字段
      const withUrls = await postsHaveImageUrls()
      const basePayload: Record<string, any> = {
        title,
        category,
        description,
        content: description,
        image_url: cover || undefined,
        ...(withUrls && finalUrls.length ? { image_urls: finalUrls } : {}),
        image_ratio: imageRatio,
        user_id: user.id,
        likes: 0,
        comments: 0,
      }
      // image_mask_url 需先跑 scripts/2026-06-20-post-image-mask.sql。若该列尚不存在
      // 导致插入失败，自动去掉遮罩字段重试，保证发帖永不被这个实验字段拖垮。
      let result: any
      try {
        result = await createPost(maskUrl ? { ...basePayload, image_mask_url: maskUrl } : basePayload)
      } catch (insErr) {
        if (maskUrl) {
          console.warn("带 image_mask_url 插入失败（可能未跑迁移），改为无遮罩重试:", insErr)
          result = await createPost(basePayload)
        } else {
          throw insErr
        }
      }

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

  // 在正文光标处插入表情标记 [s:name]，并把光标移到标记之后
  const insertSticker = (name: string) => {
    const token = makeStickerToken(name)
    const el = descRef.current
    if (!el) {
      setDescription((prev) => prev + token)
      return
    }
    const start = el.selectionStart ?? description.length
    const end = el.selectionEnd ?? description.length
    setDescription(description.slice(0, start) + token + description.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
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
                ref={descRef}
                id="post-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="分享你的想法..."
                className="min-h-[150px] bg-white/[0.06] border-white/[0.12] focus:border-white/30 text-white placeholder:text-white/40 focus:ring-white/20 rounded-lg"
                disabled={isSubmitting}
                required
              />
              {/* 表情包：点选后在正文光标处插入标记，发布后正文里会渲染成表情图 */}
              <div className="mt-2">
                <StickerPicker onSelect={insertSticker} disabled={isSubmitting} />
              </div>
            </div>

            {/* 图片预览：固定尺寸方形缩略图网格。首张为封面，支持多图，末尾带「添加」格子。 */}
            {images.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {images.map((item, idx) => (
                  <div
                    key={item.id}
                    className="group relative h-28 w-28 overflow-hidden rounded-lg border border-white/[0.12]"
                  >
                    <img
                      src={item.preview || "/placeholder.svg"}
                      alt={`图片 ${idx + 1}`}
                      className="h-full w-full object-cover cursor-pointer transition-transform duration-300 ease-out [@media(hover:hover)]:group-hover:scale-110"
                      onClick={() => {
                        setLightboxIndex(idx)
                        setLightboxOpen(true)
                      }}
                    />
                    {/* 封面角标（首张） */}
                    {idx === 0 && (
                      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-lime-400/90 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                        封面
                      </span>
                    )}
                    <button
                      className="absolute top-1.5 right-1.5 z-10 rounded-full bg-black/50 backdrop-blur-md p-1 text-white hover:text-white/80"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeImage(item.id)
                      }}
                      disabled={isSubmitting}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {/* 添加更多 */}
                {images.length < MAX_IMAGES && (
                  <button
                    type="button"
                    onClick={handleImageButtonClick}
                    disabled={isSubmitting}
                    className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/20 bg-white/[0.04] text-white/50 transition-colors hover:border-white/35 hover:bg-white/[0.08] hover:text-white/80 disabled:opacity-50"
                  >
                    <ImageIcon className="h-5 w-5" />
                    <span className="text-xs">
                      {images.length}/{MAX_IMAGES}
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* 3D 视差（实验）：仅单张新图、环境支持(Worker+WASM)时显示。移动端也放开
                （用户要求）：抠像在 Worker 后台跑、非阻断，手机较慢但可用，文案里有提示。 */}
            {images.length === 1 && !!images[0]?.file && isMatteSupported() && (
              <div className="rounded-lg border border-lime-400/20 bg-lime-400/[0.06] p-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={genParallax}
                    onChange={(e) => setGenParallax(e.target.checked)}
                    disabled={isSubmitting}
                    className="h-4 w-4 accent-lime-400"
                  />
                  <span className="text-sm font-medium text-white/90">✨ 3D 视差效果（实验）</span>
                </label>
                <p className="mt-1 pl-6 text-xs text-white/45">
                  发布时在你的浏览器抠出主体，图片点开放大后会随鼠标移动 / 手指拖动产生景深视差。
                  首次会下载抠像模型（约 176MB，之后缓存）
                  {isMobile ? "；手机上更慢、更吃内存，建议在 WiFi 下使用" : "，发布会多花几秒到几十秒"}。
                </p>
                {matteStatus && <p className="mt-1 pl-6 text-xs text-lime-400">{matteStatus}</p>}
              </div>
            )}

            {/* 隐藏的文件输入（多选） */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              multiple
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
                disabled={isSubmitting || images.length >= MAX_IMAGES}
              >
                <ImageIcon className="h-4 w-4 mr-2" />
                {images.length > 0 ? `添加图片 (${images.length}/${MAX_IMAGES})` : "上传图片"}
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

      {/* 图片放大灯箱：点击任一预览图后原图居中聚焦放大，可左右切换（portal 到 body） */}
      <ImageLightbox
        images={lightboxOpen ? images.map((i) => i.preview) : null}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        alt="Preview"
        onClose={() => setLightboxOpen(false)}
      />
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
