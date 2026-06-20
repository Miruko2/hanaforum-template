"use client"

import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { Shield, Users, FileText, Trash2, AlertCircle, Bot, Cpu, Save, RefreshCw, Megaphone, Ban, ShieldCheck, MessageSquare, ImageIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { broadcastAnnouncement } from "@/lib/supabase"
import { compressImage } from "@/lib/image-compress"
import MengmegziAgentPanel from "@/components/admin/mengmegzi-agent-panel"
import { motion } from "framer-motion"

// 标签页配置：驱动顶部带「果冻滑动」高亮的标签条（仿首页排序切换的 layoutId 弹簧）
const ADMIN_TABS: { value: string; label: string; icon: typeof Shield }[] = [
  { value: "admins", label: "管理员", icon: Shield },
  { value: "users", label: "用户", icon: Users },
  { value: "posts", label: "帖子", icon: FileText },
  { value: "hanako", label: "AI 对话权限", icon: Bot },
  { value: "ai-config", label: "AI 模型", icon: Cpu },
  { value: "dm-ai-config", label: "私信 AI", icon: MessageSquare },
  { value: "announcements", label: "公告", icon: Megaphone },
  { value: "mengmegzi", label: "萌萌子", icon: Bot },
]

// ─── 模块级缓存 ────────────────────────────────────────────
// 同一个 tab 内导航走又回来时，沿用上次数据，避免每次都重新请求 spinner。
// 失效时机：浏览器硬刷新（自然清空）/ 用户点页面顶部"刷新"按钮（手动重拉）。
// 管理员的写操作（如 addAdmin / delete / saveAiConfig）会同步写回这两个变量，
// 因此缓存数据始终是"用户上次看到的样子"，不会出现陈旧 UI。
type CachedAdminData = {
  users: any[]
  // 注册用户真实总数（count: "exact"，不受 PostgREST max-rows=1000 限制）
  userCount: number
  posts: any[]
  admins: any[]
  hanakoAllowedUsers: any[]
  // 被封禁用户原始行（user_id / reason / created_at / expires_at）
  bannedUsers: any[]
}
type CachedAiConfig = {
  base_url: string
  api_key_masked: string
  api_key_set: boolean
  model: string
  // 是否启用 hanako 对话白名单：
  // true  = 仅白名单内用户能对话（默认）
  // false = 所有登录用户均可对话
  whitelist_enabled: boolean
  updated_at: string | null
}
let cachedAdminData: CachedAdminData | null = null
let cachedAiConfig: CachedAiConfig | null = null
// 私信 AI 配置（独立于弹幕墙 ai_config 的"另一套模型"）
type CachedDmAiConfig = {
  enabled: boolean
  base_url: string
  api_key_masked: string
  api_key_set: boolean
  model: string
  persona: string
  proactive_enabled: boolean
  cooldown_hours: number
  max_unanswered: number
  updated_at: string | null
}
let cachedDmAiConfig: CachedDmAiConfig | null = null

// 列表加载骨架：壳层即时渲染期间占位，避免数据未到时误显示「暂无数据」。
function SkeletonRows({ rows = 3, cols = 3 }: { rows?: number; cols?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid gap-4 p-4 border-b border-white/5 last:border-0"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
        >
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-4 rounded bg-white/10 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  )
}

export default function AdminPage() {
  const { user, isAdmin, loading: authLoading } = useSimpleAuth()
  const router = useRouter()
  const { toast } = useToast()
  // 缓存命中就跳过 spinner，直接渲染
  const [loading, setLoading] = useState(!cachedAdminData)
  // 受控标签页：自己掌握当前 tab，才能驱动 layoutId 果冻滑动高亮
  const [activeTab, setActiveTab] = useState("admins")
  const [users, setUsers] = useState<any[]>(cachedAdminData?.users || [])
  const [userCount, setUserCount] = useState<number>(cachedAdminData?.userCount ?? 0)
  const [posts, setPosts] = useState<any[]>(cachedAdminData?.posts || [])
  const [admins, setAdmins] = useState<any[]>(cachedAdminData?.admins || [])
  const [newAdminEmail, setNewAdminEmail] = useState("")
  const [addingAdmin, setAddingAdmin] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [selectedItem, setSelectedItem] = useState<{ id: string; type: string } | null>(null)

  // AI 白名单状态
  const [hanakoAllowedUsers, setHanakoAllowedUsers] = useState<any[]>(
    cachedAdminData?.hanakoAllowedUsers || [],
  )
  const [newAllowedUserInput, setNewAllowedUserInput] = useState("")
  const [addingAllowedUser, setAddingAllowedUser] = useState(false)
  // 白名单开关切换中的临时态（防止重复点击）
  const [togglingWhitelist, setTogglingWhitelist] = useState(false)

  // 用户封禁状态
  // bannedUsers：被封禁原始行；bannedIds：派生的 Set，行内 O(1) 判断是否已封
  const [bannedUsers, setBannedUsers] = useState<any[]>(cachedAdminData?.bannedUsers || [])
  const bannedIds = new Set(bannedUsers.map((b) => b.user_id))
  // 用户列表搜索词（按用户名 / 用户 ID 客户端过滤已加载列表）
  const [userSearch, setUserSearch] = useState("")
  // 帖子列表搜索词（按标题客户端过滤已加载的帖子）
  const [postSearch, setPostSearch] = useState("")
  // 封禁确认弹窗
  const [banTarget, setBanTarget] = useState<{ id: string; username: string } | null>(null)
  const [banReason, setBanReason] = useState("")
  const [banning, setBanning] = useState(false)

  // AI 模型配置状态
  const [aiConfig, setAiConfig] = useState<CachedAiConfig | null>(cachedAiConfig)
  const [aiConfigLoading, setAiConfigLoading] = useState(false)
  const [aiConfigSaving, setAiConfigSaving] = useState(false)
  // 表单本地态：base_url / model 直接绑定；api_key 单独管理（留空 = 不修改）
  const [aiBaseUrl, setAiBaseUrl] = useState(cachedAiConfig?.base_url || "")
  const [aiModel, setAiModel] = useState(cachedAiConfig?.model || "")
  const [aiApiKey, setAiApiKey] = useState("")

  // 私信 AI 配置状态（独立于弹幕墙）
  const [dmConfig, setDmConfig] = useState<CachedDmAiConfig | null>(cachedDmAiConfig)
  const [dmConfigLoading, setDmConfigLoading] = useState(false)
  const [dmConfigSaving, setDmConfigSaving] = useState(false)
  const [dmEnabled, setDmEnabled] = useState(cachedDmAiConfig?.enabled ?? false)
  const [dmBaseUrl, setDmBaseUrl] = useState(cachedDmAiConfig?.base_url || "")
  const [dmModel, setDmModel] = useState(cachedDmAiConfig?.model || "")
  const [dmApiKey, setDmApiKey] = useState("")
  const [dmPersona, setDmPersona] = useState(cachedDmAiConfig?.persona || "")
  const [dmProactive, setDmProactive] = useState(cachedDmAiConfig?.proactive_enabled ?? false)
  const [dmCooldown, setDmCooldown] = useState<number>(cachedDmAiConfig?.cooldown_hours ?? 24)
  const [dmMaxUnanswered, setDmMaxUnanswered] = useState<number>(cachedDmAiConfig?.max_unanswered ?? 2)
  // 两个开关即时保存中的临时态（防重复点击）
  const [dmToggling, setDmToggling] = useState(false)

  // 公告广播状态
  const [annTitle, setAnnTitle] = useState("")
  const [annContent, setAnnContent] = useState("")
  const [sendingAnn, setSendingAnn] = useState(false)
  const [showBroadcastConfirm, setShowBroadcastConfirm] = useState(false)
  // 公告配图（单张，可选）：annImageFile=待上传原文件，annImagePreview=本地预览 data URL
  const [annImageFile, setAnnImageFile] = useState<File | null>(null)
  const [annImagePreview, setAnnImagePreview] = useState("")
  const annFileInputRef = useRef<HTMLInputElement>(null)

  // 选择公告配图：单张、≤5MB，读为本地预览（与发帖图同口径）
  const handleAnnImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // 允许再次选择同一文件
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "图片过大",
        description: "公告配图不能超过 5MB",
        variant: "destructive",
      })
      return
    }
    setAnnImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setAnnImagePreview((ev.target?.result as string) || "")
    reader.readAsDataURL(file)
  }

  // 移除已选公告配图
  const removeAnnImage = () => {
    setAnnImageFile(null)
    setAnnImagePreview("")
  }

  // 上传公告配图到 post-images 桶：上传前客户端压缩为 webp（复用帖子图那套 compressImage）。
  // 单张、无需缩略图（公告不进列表流）；文件名随机唯一 → 缓存 1 年，最大化 CDN 命中。
  const uploadAnnouncementImage = async (file: File): Promise<string> => {
    const { blob, ext, contentType } = await compressImage(file)
    const fileName = `announcement-${Math.random().toString(36).slice(2)}.${ext}`
    const { data, error } = await supabase.storage.from("post-images").upload(fileName, blob, {
      cacheControl: "31536000",
      upsert: false,
      contentType,
    })
    if (error) throw error
    return supabase.storage.from("post-images").getPublicUrl(data.path).data.publicUrl
  }

  // 发布全员公告
  const handleBroadcast = async () => {
    if (!annTitle.trim() || !annContent.trim()) {
      toast({
        title: "请填写完整",
        description: "标题和内容都不能为空",
        variant: "destructive",
      })
      return
    }
    try {
      setSendingAnn(true)
      // 选了图 → 先压缩上传拿公开 URL；没选则发纯文字公告（与从前完全一致）
      let imageUrl: string | null = null
      if (annImageFile) {
        try {
          imageUrl = await uploadAnnouncementImage(annImageFile)
        } catch (upErr: any) {
          console.error("公告配图上传失败:", upErr)
          toast({
            title: "图片上传失败",
            description: upErr?.message || "请稍后重试",
            variant: "destructive",
          })
          setSendingAnn(false)
          return
        }
      }
      await broadcastAnnouncement(annTitle.trim(), annContent.trim(), imageUrl)
      toast({
        title: "已推送",
        description: "公告已发送给所有用户",
      })
      setAnnTitle("")
      setAnnContent("")
      removeAnnImage()
    } catch (e: any) {
      console.error("发布公告失败:", e)
      toast({
        title: "发布失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSendingAnn(false)
      setShowBroadcastConfirm(false)
    }
  }

  useEffect(() => {
    // 等待认证状态完成初始化再判断
    if (authLoading) return

    // 如果用户未登录或不是管理员，重定向到首页
    if (!user || !isAdmin) {
      router.push("/")
      return
    }

    // 缓存命中就不重新拉数据，避免每次进页面都 spinner + 请求
    // （用户点页面顶部"刷新"按钮可强制重新加载）
    if (!cachedAdminData) loadData()
    if (!cachedAiConfig) loadAiConfig()
    if (!cachedDmAiConfig) loadDmAiConfig()
  }, [user, isAdmin, authLoading, router])

  const loadData = async () => {
    setLoading(true)
    try {
      // 并行查询所有表
      const [usersResult, postsResult, adminsResult, allowedResult, bannedResult] = await Promise.allSettled([
        supabase
          .from("profiles")
          .select("id, username, avatar_url, updated_at", { count: "exact" })
          .order("updated_at", { ascending: false, nullsFirst: false }),
        supabase
          .from("posts")
          // 只取列表实际展示的列：content / description 可能是大段正文，
          // 这里根本不显示，拉下来纯属浪费 egress（200 篇累加可观）。砍掉只留必需列。
          .select("id, title, user_id, created_at")
          .order("created_at", { ascending: false })
          // 后台审核只需最近帖子；不设上限会把全站历史帖一次性拉下来并渲染成
          // 几千行 DOM，是「进面板等半天」的主要数据成本。取最近 200 篇，
          // 命中上限时下方列表会提示。
          .limit(200),
        supabase
          .from("admin_users")
          .select("id, user_id, added_by, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("hanako_allowed_users")
          .select("id, user_id, added_by, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("banned_users")
          .select("user_id, reason, created_at, expires_at")
          .order("created_at", { ascending: false }),
      ])

      // 收集本次拉到的结果到 snapshot，最后一并写 state + 缓存
      // 某项查询失败就保留上次状态值，不至于把 UI 清空
      const snapshot: CachedAdminData = {
        users,
        userCount,
        posts,
        admins,
        hanakoAllowedUsers,
        bannedUsers,
      }

      // 处理用户列表
      if (usersResult.status === "fulfilled" && !usersResult.value.error) {
        snapshot.users = usersResult.value.data || []
        // 真实总数取 count（不受 1000 行限制）；拿不到则退回列表长度
        snapshot.userCount = usersResult.value.count ?? snapshot.users.length
      }

      // 帖子 / 管理员 / 白名单都要把 user_id 翻成用户名。原来这三块各自
      // 再查一次 profiles（3 次串行往返，是首屏慢的一大头）。这里先把三者
      // 需要的 id 汇总，合并成「一次」profiles 查询，再分别套各自的展示逻辑。
      const postsData =
        postsResult.status === "fulfilled" && !postsResult.value.error
          ? postsResult.value.data || []
          : null
      const adminsData =
        adminsResult.status === "fulfilled" && !adminsResult.value.error
          ? adminsResult.value.data || []
          : null
      const allowedData =
        allowedResult.status === "fulfilled" && !allowedResult.value.error
          ? allowedResult.value.data || []
          : null

      const needIds = new Set<string>()
      for (const p of postsData || []) if (p.user_id) needIds.add(p.user_id)
      for (const a of adminsData || []) if (a.user_id) needIds.add(a.user_id)
      for (const a of allowedData || []) if (a.user_id) needIds.add(a.user_id)

      // id → 原始 username（null 表示该 profile 没设用户名）
      const profileNameMap = new Map<string, string | null>()
      if (needIds.size > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, username")
          .in("id", [...needIds])
        for (const p of profs || []) profileNameMap.set(p.id, p.username ?? null)
      }

      // 帖子：用户名去掉邮箱后缀，查不到则回退「用户_前6位」
      if (postsData) {
        snapshot.posts = postsData.map((post) => {
          const raw = profileNameMap.get(post.user_id)
          const name = raw
            ? raw.includes("@")
              ? raw.split("@")[0]
              : raw
            : `用户_${post.user_id.substring(0, 6)}`
          return { ...post, username: name }
        })
      }

      // 管理员：保持 { users: { username, email } } 形状不变（展示处直接读）
      if (adminsData) {
        snapshot.admins = adminsData.map((a) => ({
          ...a,
          users: {
            username: profileNameMap.get(a.user_id) ?? null,
            email: null,
          },
        }))
      }

      // AI 白名单：username 原样（展示处自带「用户_前6位」回退）
      if (allowedData) {
        snapshot.hanakoAllowedUsers = allowedData.map((a) => ({
          ...a,
          username: profileNameMap.get(a.user_id) ?? null,
        }))
      }

      // 处理封禁列表（表未建/迁移没跑时这条会失败，保留上次值不清空）
      if (bannedResult.status === "fulfilled" && !bannedResult.value.error) {
        snapshot.bannedUsers = bannedResult.value.data || []
      }

      // 一并提交：组件 state + 模块缓存
      setUsers(snapshot.users)
      setUserCount(snapshot.userCount)
      setPosts(snapshot.posts)
      setAdmins(snapshot.admins)
      setHanakoAllowedUsers(snapshot.hanakoAllowedUsers)
      setBannedUsers(snapshot.bannedUsers)
      cachedAdminData = snapshot
    } catch (error) {
      console.error("加载数据错误:", error)
      toast({
        title: "加载失败",
        description: "无法加载管理数据，请稍后重试",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleAddAdmin = async () => {
    if (!newAdminEmail.trim()) {
      toast({
        title: "输入错误",
        description: "请输入用户名或用户ID",
        variant: "destructive",
      })
      return
    }

    setAddingAdmin(true)
    try {
      const input = newAdminEmail.trim()
      let targetUserId: string | null = null

      // 如果输入看起来是 UUID，直接用
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (uuidRe.test(input)) {
        targetUserId = input
      } else {
        // 否则在 profiles 表按用户名查找
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", input)
          .maybeSingle()

        if (profile?.id) {
          targetUserId = profile.id
        }
      }

      if (!targetUserId) {
        toast({
          title: "用户不存在",
          description: "找不到该用户名或用户ID对应的用户",
          variant: "destructive",
        })
        return
      }

      // 添加管理员
      const { error: adminError } = await supabase
        .from("admin_users")
        .insert([{ user_id: targetUserId, added_by: user?.id }])

      if (adminError) {
        if (adminError.code === "23505") {
          toast({
            title: "添加失败",
            description: "该用户已经是管理员",
            variant: "destructive",
          })
        } else {
          throw adminError
        }
      } else {
        toast({
          title: "添加成功",
          description: "已成功添加新管理员",
        })
        setNewAdminEmail("")
        loadData() // 重新加载数据
      }
    } catch (error) {
      console.error("添加管理员错误:", error)
      toast({
        title: "添加失败",
        description: "添加管理员时出现错误，请稍后重试",
        variant: "destructive",
      })
    } finally {
      setAddingAdmin(false)
    }
  }

  const handleDelete = (id: string, type: string) => {
    setSelectedItem({ id, type })
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (!selectedItem) return

    try {
      if (selectedItem.type === "post") {
        // 删除帖子
        // 注：delete_post 已重写为只接受 p_post_id 参数，权限内部通过 auth.uid() 判断
        // （旧签名 delete_post(p_post_id, p_user_id) 信任客户端传入的 user_id，
        //  任何人能伪造管理员 UUID 删任意帖 → 已修复，见 scripts/security-fix-2026-05-31.sql）
        //
        // 历史 bug：之前这里 await 后直接 toast 成功，没解 error，
        // 导致 RPC 失败（比如签名不匹配 / 权限拒绝）时仍提示删除成功，
        // 用户误以为帖子还在 → 反过来也踩过。下面强制解 error 后再 toast。
        const { error } = await supabase.rpc("delete_post", {
          p_post_id: selectedItem.id,
        })
        if (error) throw error
        toast({
          title: "删除成功",
          description: "帖子已成功删除",
        })
      } else if (selectedItem.type === "admin") {
        // 删除管理员
        const { error } = await supabase.from("admin_users").delete().eq("id", selectedItem.id)

        if (error) throw error
        toast({
          title: "删除成功",
          description: "管理员已成功移除",
        })
      } else if (selectedItem.type === "hanako_allowed") {
        // 删除 AI 白名单用户
        const { error } = await supabase.from("hanako_allowed_users").delete().eq("id", selectedItem.id)

        if (error) throw error
        toast({
          title: "删除成功",
          description: "已从 AI 对话白名单中移除",
        })
      }

      loadData() // 重新加载数据
    } catch (error) {
      console.error("删除错误:", error)
      toast({
        title: "删除失败",
        description: "操作失败，请稍后重试",
        variant: "destructive",
      })
    } finally {
      setShowDeleteDialog(false)
      setSelectedItem(null)
    }
  }

  // 拉当前 AI 配置（GET /api/admin/ai-config，带 Bearer token）
  const loadAiConfig = async () => {
    setAiConfigLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) {
        toast({
          title: "未登录",
          description: "请重新登录后再尝试",
          variant: "destructive",
        })
        return
      }

      const res = await fetch(apiUrl("/api/admin/ai-config"), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const data = await res.json()

      if (!res.ok) {
        toast({
          title: "加载失败",
          description: data?.error || `HTTP ${res.status}`,
          variant: "destructive",
        })
        return
      }

      setAiConfig(data)
      cachedAiConfig = data
      // 同步到表单
      setAiBaseUrl(data.base_url || "")
      setAiModel(data.model || "")
      setAiApiKey("") // 保留空：留空 = 不修改
    } catch (err: any) {
      toast({
        title: "加载失败",
        description: err?.message || "网络错误",
        variant: "destructive",
      })
    } finally {
      setAiConfigLoading(false)
    }
  }

  // 保存 AI 配置（PATCH /api/admin/ai-config）
  const handleSaveAiConfig = async () => {
    setAiConfigSaving(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) {
        toast({
          title: "未登录",
          description: "请重新登录后再尝试",
          variant: "destructive",
        })
        return
      }

      // 组装 patch：留空的字段就不传（让后端保留原值）
      const patch: Record<string, string> = {}
      if (aiBaseUrl.trim()) patch.base_url = aiBaseUrl.trim()
      if (aiModel.trim()) patch.model = aiModel.trim()
      if (aiApiKey.trim()) patch.api_key = aiApiKey.trim()

      if (Object.keys(patch).length === 0) {
        toast({
          title: "没有修改",
          description: "没有可保存的字段",
          variant: "destructive",
        })
        return
      }

      const res = await fetch(apiUrl("/api/admin/ai-config"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      })
      const data = await res.json()

      if (!res.ok) {
        toast({
          title: "保存失败",
          description: data?.error || `HTTP ${res.status}`,
          variant: "destructive",
        })
        return
      }

      setAiConfig(data)
      cachedAiConfig = data
      setAiBaseUrl(data.base_url || "")
      setAiModel(data.model || "")
      setAiApiKey("") // 清空 api_key 输入框，下次留空 = 保持不变
      toast({
        title: "保存成功",
        description: "AI 配置已更新，最多 10 秒后全网生效",
      })
    } catch (err: any) {
      toast({
        title: "保存失败",
        description: err?.message || "网络错误",
        variant: "destructive",
      })
    } finally {
      setAiConfigSaving(false)
    }
  }

  // 拉私信 AI 配置（GET /api/admin/dm-ai-config）
  const loadDmAiConfig = async () => {
    setDmConfigLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) {
        toast({ title: "未登录", description: "请重新登录后再尝试", variant: "destructive" })
        return
      }
      const res = await fetch(apiUrl("/api/admin/dm-ai-config"), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "加载失败", description: data?.error || `HTTP ${res.status}`, variant: "destructive" })
        return
      }
      setDmConfig(data)
      cachedDmAiConfig = data
      setDmEnabled(!!data.enabled)
      setDmBaseUrl(data.base_url || "")
      setDmModel(data.model || "")
      setDmApiKey("")
      setDmPersona(data.persona || "")
      setDmProactive(!!data.proactive_enabled)
      setDmCooldown(typeof data.cooldown_hours === "number" ? data.cooldown_hours : 24)
      setDmMaxUnanswered(typeof data.max_unanswered === "number" ? data.max_unanswered : 2)
    } catch (err: any) {
      toast({ title: "加载失败", description: err?.message || "网络错误", variant: "destructive" })
    } finally {
      setDmConfigLoading(false)
    }
  }

  // 保存私信 AI 配置（PATCH /api/admin/dm-ai-config）
  const handleSaveDmAiConfig = async () => {
    setDmConfigSaving(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) {
        toast({ title: "未登录", description: "请重新登录后再尝试", variant: "destructive" })
        return
      }
      // 开关/数值总是带上；api_key 留空 = 不修改
      const patch: Record<string, any> = {
        enabled: dmEnabled,
        proactive_enabled: dmProactive,
        persona: dmPersona,
        cooldown_hours: Number(dmCooldown) || 0,
        max_unanswered: Number(dmMaxUnanswered) || 0,
      }
      if (dmBaseUrl.trim()) patch.base_url = dmBaseUrl.trim()
      if (dmModel.trim()) patch.model = dmModel.trim()
      if (dmApiKey.trim()) patch.api_key = dmApiKey.trim()

      const res = await fetch(apiUrl("/api/admin/dm-ai-config"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "保存失败", description: data?.error || `HTTP ${res.status}`, variant: "destructive" })
        return
      }
      setDmConfig(data)
      cachedDmAiConfig = data
      setDmEnabled(!!data.enabled)
      setDmBaseUrl(data.base_url || "")
      setDmModel(data.model || "")
      setDmApiKey("")
      setDmPersona(data.persona || "")
      setDmProactive(!!data.proactive_enabled)
      setDmCooldown(typeof data.cooldown_hours === "number" ? data.cooldown_hours : 24)
      setDmMaxUnanswered(typeof data.max_unanswered === "number" ? data.max_unanswered : 2)
      toast({ title: "保存成功", description: "私信 AI 配置已更新，最多 10 秒后生效" })
    } catch (err: any) {
      toast({ title: "保存失败", description: err?.message || "网络错误", variant: "destructive" })
    } finally {
      setDmConfigSaving(false)
    }
  }

  // 即时切换私信开关（回复 / 主动）：PATCH 单字段、乐观更新、失败回滚（仿白名单开关）。
  // 这两个开关不依赖下方「保存配置」按钮，拨动即落库，避免"改了忘存"。
  const handleToggleDmField = async (
    field: "enabled" | "proactive_enabled",
    next: boolean,
  ) => {
    if (dmToggling) return
    setDmToggling(true)
    const prevConfig = dmConfig
    // 乐观更新
    if (field === "enabled") setDmEnabled(next)
    else setDmProactive(next)
    if (dmConfig) {
      const optimistic = { ...dmConfig, [field]: next }
      setDmConfig(optimistic)
      cachedDmAiConfig = optimistic
    }
    const rollback = () => {
      if (field === "enabled") setDmEnabled(prevConfig?.enabled ?? false)
      else setDmProactive(prevConfig?.proactive_enabled ?? false)
      if (prevConfig) {
        setDmConfig(prevConfig)
        cachedDmAiConfig = prevConfig
      }
    }
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) {
        rollback()
        toast({ title: "未登录", description: "请重新登录后再尝试", variant: "destructive" })
        return
      }
      const res = await fetch(apiUrl("/api/admin/dm-ai-config"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        rollback()
        toast({ title: "切换失败", description: data?.error || `HTTP ${res.status}`, variant: "destructive" })
        return
      }
      setDmConfig(data)
      cachedDmAiConfig = data
      setDmEnabled(!!data.enabled)
      setDmProactive(!!data.proactive_enabled)
      const label = field === "enabled" ? "回复私信" : "主动私信"
      toast({ title: next ? `已开启${label}` : `已关闭${label}`, description: "最多 10 秒后生效" })
    } catch (err: any) {
      rollback()
      toast({ title: "切换失败", description: err?.message || "网络错误", variant: "destructive" })
    } finally {
      setDmToggling(false)
    }
  }

  // 切换 hanako 白名单开关
  // 走的是同一个 /api/admin/ai-config PATCH 接口（最多 10 秒后全网生效）
  const handleToggleWhitelist = async (next: boolean) => {
    if (togglingWhitelist) return
    setTogglingWhitelist(true)
    // 乐观更新：UI 先翻，失败再回滚，避免开关"卡住不动"看着很怪
    const prev = aiConfig
    if (aiConfig) {
      const optimistic = { ...aiConfig, whitelist_enabled: next }
      setAiConfig(optimistic)
      cachedAiConfig = optimistic
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) {
        if (prev) {
          setAiConfig(prev)
          cachedAiConfig = prev
        }
        toast({
          title: "未登录",
          description: "请重新登录后再尝试",
          variant: "destructive",
        })
        return
      }

      const res = await fetch(apiUrl("/api/admin/ai-config"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ whitelist_enabled: next }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (prev) {
          setAiConfig(prev)
          cachedAiConfig = prev
        }
        toast({
          title: "切换失败",
          description: data?.error || `HTTP ${res.status}`,
          variant: "destructive",
        })
        return
      }

      setAiConfig(data)
      cachedAiConfig = data
      toast({
        title: next ? "已启用白名单" : "已关闭白名单",
        description: next
          ? "仅白名单内用户可与 Hanako 对话"
          : "所有登录用户均可与 Hanako 对话（最多 10 秒生效）",
      })
    } catch (err: any) {
      if (prev) {
        setAiConfig(prev)
        cachedAiConfig = prev
      }
      toast({
        title: "切换失败",
        description: err?.message || "网络错误",
        variant: "destructive",
      })
    } finally {
      setTogglingWhitelist(false)
    }
  }

  const handleAddAllowedUser = async () => {
    if (!newAllowedUserInput.trim()) {
      toast({
        title: "输入错误",
        description: "请输入用户名或用户ID",
        variant: "destructive",
      })
      return
    }

    setAddingAllowedUser(true)
    try {
      const input = newAllowedUserInput.trim()
      let targetUserId: string | null = null

      // 如果输入看起来是 UUID，直接用
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (uuidRe.test(input)) {
        targetUserId = input
      } else {
        // 否则在 profiles 表按用户名查找
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", input)
          .maybeSingle()

        if (profile?.id) {
          targetUserId = profile.id
        }
      }

      if (!targetUserId) {
        toast({
          title: "用户不存在",
          description: "找不到该用户名或用户ID对应的用户",
          variant: "destructive",
        })
        return
      }

      // 添加到白名单
      const { error: addError } = await supabase
        .from("hanako_allowed_users")
        .insert([{ user_id: targetUserId, added_by: user?.id }])

      if (addError) {
        if (addError.code === "23505") {
          toast({
            title: "添加失败",
            description: "该用户已在白名单中",
            variant: "destructive",
          })
        } else {
          throw addError
        }
      } else {
        toast({
          title: "添加成功",
          description: "已添加到 AI 对话白名单",
        })
        setNewAllowedUserInput("")
        loadData()
      }
    } catch (error) {
      console.error("添加白名单用户错误:", error)
      toast({
        title: "添加失败",
        description: "添加白名单用户时出现错误，请稍后重试",
        variant: "destructive",
      })
    } finally {
      setAddingAllowedUser(false)
    }
  }

  // 执行封禁：写 banned_users（RLS 要求操作者在 admin_users 表内），
  // 并顺手删除该用户已有弹幕（realtime DELETE 会让它从所有人屏幕消失）。
  const confirmBan = async () => {
    if (!banTarget || banning) return
    setBanning(true)
    try {
      const { error } = await supabase.from("banned_users").insert([
        {
          user_id: banTarget.id,
          reason: banReason.trim() || null,
          banned_by: user?.id,
        },
      ])
      if (error) {
        // 23505 = 已存在（已被封），当作成功的幂等结果
        if (error.code !== "23505") throw error
      }

      // 清掉该用户已有弹幕（失败不阻断封禁本身，仅记录）
      const { error: delError } = await supabase
        .from("live_comments")
        .delete()
        .eq("user_id", banTarget.id)
      if (delError) console.warn("删除被封用户弹幕失败:", delError.message)

      // 本地更新封禁集合 + 缓存，避免再拉一次
      const newRow = {
        user_id: banTarget.id,
        reason: banReason.trim() || null,
        created_at: new Date().toISOString(),
        expires_at: null,
      }
      setBannedUsers((prev) => {
        const next = prev.some((b) => b.user_id === banTarget.id)
          ? prev
          : [newRow, ...prev]
        if (cachedAdminData) cachedAdminData.bannedUsers = next
        return next
      })

      toast({
        title: "已封禁",
        description: `${banTarget.username} 已被全站封禁并即时下线`,
      })
    } catch (error: any) {
      console.error("封禁失败:", error)
      toast({
        title: "封禁失败",
        description: error?.message || "请稍后重试（确认你的账号在 admin_users 表内）",
        variant: "destructive",
      })
    } finally {
      setBanning(false)
      setBanTarget(null)
      setBanReason("")
    }
  }

  // 解封：删 banned_users 行，用户立即恢复发言能力（RLS 实时重判）
  const handleUnban = async (targetUserId: string, username: string) => {
    try {
      const { error } = await supabase
        .from("banned_users")
        .delete()
        .eq("user_id", targetUserId)
      if (error) throw error

      setBannedUsers((prev) => {
        const next = prev.filter((b) => b.user_id !== targetUserId)
        if (cachedAdminData) cachedAdminData.bannedUsers = next
        return next
      })

      toast({
        title: "已解封",
        description: `${username} 已恢复发言`,
      })
    } catch (error: any) {
      console.error("解封失败:", error)
      toast({
        title: "解封失败",
        description: error?.message || "请稍后重试",
        variant: "destructive",
      })
    }
  }

  // 只在「认证初始化」阶段短暂等待（getSession 基本读本地存储、很快，且有 1s 超时兜底）。
  // 关键改动：不再为「数据加载」整页转圈——壳层（标题 + 标签页）立刻渲染，
  // 各列表内部用骨架占位，数据到了再填。这样进面板是「秒开 + 渐入」，不再空等半天。
  if (authLoading) {
    return (
      <div className="container mx-auto py-10 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-lime-500 mx-auto mb-4"></div>
          <p className="text-gray-400">加载中...</p>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto py-10">
        <Card className="admin-panel-glass admin-tab-enter">
          <CardHeader>
            <CardTitle className="text-red-400 flex items-center">
              <AlertCircle className="mr-2 h-5 w-5" />
              访问被拒绝
            </CardTitle>
            <CardDescription>您没有权限访问管理员页面</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => router.push("/")} variant="outline">
              返回首页
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  // 用户列表按搜索词过滤（用户名 / 用户 ID，大小写不敏感）
  const userQuery = userSearch.trim().toLowerCase()
  const filteredUsers = userQuery
    ? users.filter(
        (u) =>
          (u.username || "").toLowerCase().includes(userQuery) ||
          (u.id || "").toLowerCase().includes(userQuery),
      )
    : users

  // 帖子按标题过滤（客户端，大小写不敏感）；已加载帖子上限 200，过滤是纯内存操作、零额外请求
  const postQuery = postSearch.trim().toLowerCase()
  const filteredPosts = postQuery
    ? posts.filter((p) => (p.title || "").toLowerCase().includes(postQuery))
    : posts

  return (
    <div className="container mx-auto py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center">
          <Shield className="mr-2 h-6 w-6 text-lime-500" />
          管理员控制面板
        </h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            loadData()
            loadAiConfig()
            loadDmAiConfig()
          }}
          disabled={loading || aiConfigLoading || dmConfigLoading}
          className="text-gray-400 hover:text-lime-400"
          title="重新拉取所有数据"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading || aiConfigLoading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {/* 标签条：layoutId 弹簧让柠檬绿高亮在标签间「果冻滑动」（仿首页排序切换）。
            !flex / !h-auto 强制覆盖 Radix TabsList 基类的 inline-flex/h-10，标签多时自动换行。 */}
        <TabsList className="mb-5 admin-tabs-glass !flex !h-auto flex-wrap items-center justify-start gap-1.5 p-2">
          {ADMIN_TABS.map(({ value, label, icon: Icon }) => {
            const active = activeTab === value
            return (
              <TabsTrigger
                key={value}
                value={value}
                className="relative rounded-full px-3.5 py-1.5 text-sm transition-colors data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {active && (
                  <motion.span
                    layoutId="admin-tab-pill"
                    className="absolute inset-0 rounded-full bg-lime-400"
                    style={{ boxShadow: "0 0 16px rgba(132,204,22,0.45)" }}
                    transition={{ type: "spring", stiffness: 600, damping: 35 }}
                  />
                )}
                <Icon className={`relative z-10 mr-1.5 h-4 w-4 ${active ? "text-black" : "text-white/65"}`} />
                <span className={`relative z-10 ${active ? "text-black font-semibold" : "text-white/65"}`}>
                  {label}
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>

        <TabsContent value="admins">
          <Card className="admin-panel-glass admin-tab-enter">
            <CardHeader>
              <CardTitle>管理员列表</CardTitle>
              <CardDescription>管理所有管理员账户</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex mb-4">
                <Input
                  placeholder="输入用户名或用户 ID"
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  className="mr-2 bg-white/5 border-white/15"
                />
                <Button onClick={handleAddAdmin} disabled={addingAdmin} className="bg-lime-700 hover:bg-lime-600">
                  {addingAdmin ? "添加中..." : "添加管理员"}
                </Button>
              </div>

              <div className="border rounded-xl border-white/10">
                <div className="grid grid-cols-3 gap-4 p-4 font-medium text-gray-400 border-b border-white/10">
                  <div>用户名</div>
                  <div>添加时间</div>
                  <div className="text-right">操作</div>
                </div>
                {loading && admins.length === 0 ? (
                  <SkeletonRows rows={3} cols={3} />
                ) : admins.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">暂无数据</div>
                ) : (
                  admins.map((admin) => (
                    <div
                      key={admin.id}
                      className="grid grid-cols-3 gap-4 p-4 border-b border-white/10 last:border-0 items-center"
                    >
                      <div className="text-white">
                        {admin.users?.username || `用户_${admin.user_id?.substring(0, 6) || "未知"}`}
                      </div>
                      <div className="text-gray-400">
                        {new Date(admin.created_at).toLocaleString("zh-CN", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="text-right">
                        {admin.user_id !== user?.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(admin.id, "admin")}
                            className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            移除
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card className="admin-panel-glass admin-tab-enter">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>用户列表</CardTitle>
                  <CardDescription>查看所有注册用户</CardDescription>
                </div>
                {/* 注册用户总数：等于下方列表行数（profiles 表） */}
                <div className="shrink-0 text-right">
                  <div className="text-3xl font-bold text-lime-400 tabular-nums leading-none">
                    {userCount}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">注册用户总数</div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* 搜索：按用户名 / 用户 ID 过滤已加载列表 */}
              <div className="mb-4">
                <Input
                  placeholder="搜索用户名或用户 ID..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="bg-white/5 border-white/15"
                />
                {userQuery && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    匹配到 {filteredUsers.length} 个用户
                    {users.length >= 1000 && (
                      <span className="text-amber-400/80">
                        （列表上限 1000 行，若搜不到目标可改用精确用户 ID）
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="border rounded-xl border-white/10">
                <div className="grid grid-cols-[1fr_1fr_auto] gap-4 p-4 font-medium text-gray-400 border-b border-white/10">
                  <div>用户名</div>
                  <div>用户 ID</div>
                  <div className="text-right">操作</div>
                </div>
                {loading && users.length === 0 ? (
                  <SkeletonRows rows={4} cols={3} />
                ) : filteredUsers.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    {userQuery ? "没有匹配的用户" : "暂无数据"}
                  </div>
                ) : (
                  filteredUsers.map((u) => {
                    const banned = bannedIds.has(u.id)
                    return (
                      <div
                        key={u.id}
                        className="grid grid-cols-[1fr_1fr_auto] gap-4 p-4 border-b border-white/10 last:border-0 items-center"
                      >
                        <div className="text-white flex items-center gap-2 min-w-0">
                          <span className="truncate">{u.username || "未设置"}</span>
                          {banned && (
                            <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 border border-red-800">
                              已封禁
                            </span>
                          )}
                        </div>
                        <div className="text-gray-300 font-mono text-xs truncate">{u.id}</div>
                        <div className="text-right">
                          {u.id === user?.id ? (
                            <span className="text-xs text-gray-600">本人</span>
                          ) : banned ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleUnban(u.id, u.username || u.id)}
                              className="text-lime-400 hover:text-lime-300 hover:bg-lime-900/20"
                            >
                              <ShieldCheck className="h-4 w-4 mr-1" />
                              解封
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setBanTarget({ id: u.id, username: u.username || u.id })
                                setBanReason("")
                              }}
                              className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                            >
                              <Ban className="h-4 w-4 mr-1" />
                              封禁
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="posts">
          <Card className="admin-panel-glass admin-tab-enter">
            <CardHeader>
              <CardTitle>帖子列表</CardTitle>
              <CardDescription>
                管理所有帖子
                {posts.length >= 200 && (
                  <span className="text-amber-400/80">（仅显示最近 200 篇，更早的帖子未列出）</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* 搜索：按标题过滤已加载的帖子（客户端、即时，不发请求） */}
              <div className="mb-4">
                <Input
                  placeholder="搜索帖子标题..."
                  value={postSearch}
                  onChange={(e) => setPostSearch(e.target.value)}
                  className="bg-white/5 border-white/15"
                />
                {postQuery && (
                  <p className="mt-1.5 text-xs text-gray-500">
                    匹配到 {filteredPosts.length} 篇
                    {posts.length >= 200 && (
                      <span className="text-amber-400/80">
                        （仅在最近 200 篇内搜索，更早的帖子未加载）
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="border rounded-xl border-white/10">
                <div className="grid grid-cols-4 gap-4 p-4 font-medium text-gray-400 border-b border-white/10">
                  <div>标题</div>
                  <div>作者</div>
                  <div>发布时间</div>
                  <div className="text-right">操作</div>
                </div>
                {loading && posts.length === 0 ? (
                  <SkeletonRows rows={5} cols={4} />
                ) : filteredPosts.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    {postQuery ? "没有匹配的帖子" : "暂无数据"}
                  </div>
                ) : (
                  filteredPosts.map((post) => (
                    <div
                      key={post.id}
                      className="grid grid-cols-4 gap-4 p-4 border-b border-white/10 last:border-0 items-center"
                    >
                      <div className="text-white truncate">{post.title}</div>
                      <div className="text-gray-300">{post.username || "匿名用户"}</div>
                      <div className="text-gray-400">
                        {new Date(post.created_at).toLocaleString("zh-CN", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(post.id, "post")}
                          className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          删除
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hanako">
          <Card className="admin-panel-glass admin-tab-enter">
            <CardHeader>
              <CardTitle>AI 对话白名单</CardTitle>
              <CardDescription>管理允许与 Hanako AI 对话的用户</CardDescription>
            </CardHeader>
            <CardContent>
              {/* 白名单总开关 */}
              <div className="mb-5 rounded-md admin-inset-glass p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">启用白名单</span>
                      <span
                        className={
                          aiConfig?.whitelist_enabled
                            ? "text-[11px] px-1.5 py-0.5 rounded bg-lime-900/40 text-lime-300 border border-lime-800"
                            : "text-[11px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-800"
                        }
                      >
                        {aiConfig?.whitelist_enabled ? "白名单生效" : "全员开放"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {aiConfig?.whitelist_enabled
                        ? "当前仅下方白名单内的用户可与 Hanako 对话。关闭后，所有登录用户均可对话（仍受限流约束）。"
                        : "当前所有登录用户均可与 Hanako 对话。下方白名单仍可维护，开启后立即生效（最多 10 秒）。"}
                    </p>
                  </div>
                  <Switch
                    checked={!!aiConfig?.whitelist_enabled}
                    onCheckedChange={handleToggleWhitelist}
                    disabled={togglingWhitelist || aiConfigLoading || !aiConfig}
                    aria-label="切换 hanako 对话白名单开关"
                    // 项目里没定义 --primary / --input CSS 变量，
                    // Switch 默认的 bg-primary / bg-input 在深色背景下完全透明 → 显示成"空开关"。
                    // 这里显式覆盖背景色：开 = lime（与项目主按钮同色），关 = gray-600
                    className="data-[state=checked]:bg-lime-600 data-[state=unchecked]:bg-gray-600"
                  />
                </div>
              </div>

              <div className="flex mb-4">
                <Input
                  placeholder="输入用户名或用户 ID"
                  value={newAllowedUserInput}
                  onChange={(e) => setNewAllowedUserInput(e.target.value)}
                  className="mr-2 bg-white/5 border-white/15"
                />
                <Button onClick={handleAddAllowedUser} disabled={addingAllowedUser} className="bg-lime-700 hover:bg-lime-600">
                  {addingAllowedUser ? "添加中..." : "添加用户"}
                </Button>
              </div>

              <div className="border rounded-xl border-white/10">
                <div className="grid grid-cols-3 gap-4 p-4 font-medium text-gray-400 border-b border-white/10">
                  <div>用户名</div>
                  <div>添加时间</div>
                  <div className="text-right">操作</div>
                </div>
                {loading && hanakoAllowedUsers.length === 0 ? (
                  <SkeletonRows rows={3} cols={3} />
                ) : hanakoAllowedUsers.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">暂无数据</div>
                ) : (
                  hanakoAllowedUsers.map((allowed) => (
                    <div
                      key={allowed.id}
                      className="grid grid-cols-3 gap-4 p-4 border-b border-white/10 last:border-0 items-center"
                    >
                      <div className="text-white">
                        {allowed.username || `用户_${allowed.user_id?.substring(0, 6) || "未知"}`}
                      </div>
                      <div className="text-gray-400">
                        {new Date(allowed.created_at).toLocaleString("zh-CN", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(allowed.id, "hanako_allowed")}
                          className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          移除
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai-config">
          <Card className="admin-panel-glass admin-tab-enter">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>弹幕墙 AI 模型配置</CardTitle>
                  <CardDescription>
                    动态修改 base_url / api_key / model；保存后最多 10 秒生效，无需重启服务。
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadAiConfig}
                  disabled={aiConfigLoading}
                  className="text-gray-400 hover:text-lime-400"
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${aiConfigLoading ? "animate-spin" : ""}`} />
                  刷新
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* 当前生效配置回显 */}
              <div className="rounded-md admin-inset-glass p-4 text-sm">
                <div className="text-gray-400 mb-2 text-xs uppercase tracking-wider">
                  当前 DB 中的配置
                </div>
                {aiConfig ? (
                  <div className="space-y-1.5 font-mono text-xs">
                    <div className="flex">
                      <span className="text-gray-500 w-24 shrink-0">base_url:</span>
                      <span className="text-white break-all">
                        {aiConfig.base_url || <span className="text-gray-600 italic">(未设置 → 用环境变量)</span>}
                      </span>
                    </div>
                    <div className="flex">
                      <span className="text-gray-500 w-24 shrink-0">api_key:</span>
                      <span className={aiConfig.api_key_set ? "text-white" : "text-gray-600 italic"}>
                        {aiConfig.api_key_set
                          ? aiConfig.api_key_masked
                          : "(未设置 → 用环境变量)"}
                      </span>
                    </div>
                    <div className="flex">
                      <span className="text-gray-500 w-24 shrink-0">model:</span>
                      <span className="text-white">
                        {aiConfig.model || <span className="text-gray-600 italic">(未设置 → 用环境变量)</span>}
                      </span>
                    </div>
                    <div className="flex">
                      <span className="text-gray-500 w-24 shrink-0">whitelist:</span>
                      <span className={aiConfig.whitelist_enabled ? "text-lime-300" : "text-amber-300"}>
                        {aiConfig.whitelist_enabled
                          ? "enabled（仅白名单可对话）"
                          : "disabled（全员可对话）"}
                      </span>
                    </div>
                    {aiConfig.updated_at && (
                      <div className="flex pt-1.5 mt-1.5 border-t border-white/10">
                        <span className="text-gray-500 w-24 shrink-0">更新于:</span>
                        <span className="text-gray-400">
                          {new Date(aiConfig.updated_at).toLocaleString("zh-CN")}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-500 text-xs">
                    {aiConfigLoading ? "加载中..." : "未加载（点右上角刷新）"}
                  </div>
                )}
              </div>

              {/* 编辑表单 */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-300 mb-1.5 block">
                    Base URL
                  </label>
                  <Input
                    placeholder="https://api.deepseek.com/v1"
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                    className="bg-white/5 border-white/15 font-mono text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    OpenAI 兼容接口的 base URL（不含末尾 <code className="text-gray-400">/chat/completions</code>）
                  </p>
                </div>

                <div>
                  <label className="text-sm text-gray-300 mb-1.5 block">
                    Model ID
                  </label>
                  <Input
                    placeholder="deepseek-chat"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="bg-white/5 border-white/15 font-mono text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    模型名称，例如 <code className="text-gray-400">deepseek-chat</code>、<code className="text-gray-400">deepseek-reasoner</code>、<code className="text-gray-400">gpt-4o-mini</code> 等
                  </p>
                </div>

                <div>
                  <label className="text-sm text-gray-300 mb-1.5 block">
                    API Key
                    <span className="ml-2 text-xs text-amber-400/80 font-normal">
                      留空表示"不修改"
                    </span>
                  </label>
                  <Input
                    type="password"
                    placeholder={aiConfig?.api_key_set ? "已设置（留空保持不变）" : "首次设置请填入"}
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    className="bg-white/5 border-white/15 font-mono text-sm"
                    autoComplete="off"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    出于安全考虑，已存的 API Key 不会回显明文，只显示掩码。
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-white/10">
                <Button
                  onClick={handleSaveAiConfig}
                  disabled={aiConfigSaving || aiConfigLoading}
                  className="bg-lime-700 hover:bg-lime-600"
                >
                  <Save className="h-4 w-4 mr-1.5" />
                  {aiConfigSaving ? "保存中..." : "保存配置"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dm-ai-config">
          <Card className="admin-panel-glass admin-tab-enter">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>私信 AI 模型配置</CardTitle>
                  <CardDescription>
                    hanako 私信用的「另一套模型」，与弹幕墙完全独立。保存后最多 10 秒生效。
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadDmAiConfig}
                  disabled={dmConfigLoading}
                  className="text-gray-400 hover:text-lime-400"
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${dmConfigLoading ? "animate-spin" : ""}`} />
                  刷新
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* 当前 DB 配置回显 */}
              <div className="rounded-md admin-inset-glass p-4 text-sm">
                <div className="text-gray-400 mb-2 text-xs uppercase tracking-wider">当前 DB 中的配置</div>
                {dmConfig ? (
                  <div className="space-y-1.5 font-mono text-xs">
                    <div className="flex">
                      <span className="text-gray-500 w-28 shrink-0">enabled:</span>
                      <span className={dmConfig.enabled ? "text-lime-300" : "text-amber-300"}>
                        {dmConfig.enabled ? "on（会回私信）" : "off（不回，用户发了也静默）"}
                      </span>
                    </div>
                    <div className="flex">
                      <span className="text-gray-500 w-28 shrink-0">base_url:</span>
                      <span className="text-white break-all">
                        {dmConfig.base_url || <span className="text-gray-600 italic">(未设置 → 环境变量)</span>}
                      </span>
                    </div>
                    <div className="flex">
                      <span className="text-gray-500 w-28 shrink-0">api_key:</span>
                      <span className={dmConfig.api_key_set ? "text-white" : "text-gray-600 italic"}>
                        {dmConfig.api_key_set ? dmConfig.api_key_masked : "(未设置 → 环境变量)"}
                      </span>
                    </div>
                    <div className="flex">
                      <span className="text-gray-500 w-28 shrink-0">model:</span>
                      <span className="text-white">
                        {dmConfig.model || <span className="text-gray-600 italic">(未设置 → 环境变量)</span>}
                      </span>
                    </div>
                    <div className="flex">
                      <span className="text-gray-500 w-28 shrink-0">proactive:</span>
                      <span className={dmConfig.proactive_enabled ? "text-lime-300" : "text-gray-500"}>
                        {dmConfig.proactive_enabled ? "on（主动搭话，需第2批+worker）" : "off"}
                      </span>
                    </div>
                    <div className="flex">
                      <span className="text-gray-500 w-28 shrink-0">cooldown:</span>
                      <span className="text-white">{dmConfig.cooldown_hours} 小时/人</span>
                    </div>
                    <div className="flex">
                      <span className="text-gray-500 w-28 shrink-0">max_unanswered:</span>
                      <span className="text-white">{dmConfig.max_unanswered}</span>
                    </div>
                    {dmConfig.updated_at && (
                      <div className="flex pt-1.5 mt-1.5 border-t border-white/10">
                        <span className="text-gray-500 w-28 shrink-0">更新于:</span>
                        <span className="text-gray-400">
                          {new Date(dmConfig.updated_at).toLocaleString("zh-CN")}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-500 text-xs">
                    {dmConfigLoading ? "加载中..." : "未加载（点右上角刷新）"}
                  </div>
                )}
              </div>

              {/* 开关：拨动即时落库，不依赖下方"保存配置" */}
              <div className="flex items-center justify-between rounded-md admin-inset-glass p-3">
                <div>
                  <div className="text-sm text-gray-200">回复私信</div>
                  <div className="text-xs text-gray-500">关闭时她不回任何私信（用户发了也静默）。拨动即时保存。</div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className={`text-xs font-mono w-4 text-center ${dmEnabled ? "text-lime-400" : "text-gray-500"}`}>
                    {dmEnabled ? "开" : "关"}
                  </span>
                  <Switch
                    checked={dmEnabled}
                    disabled={dmToggling}
                    onCheckedChange={(v) => handleToggleDmField("enabled", v)}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md admin-inset-glass p-3">
                <div>
                  <div className="text-sm text-gray-200">主动私信在线用户</div>
                  <div className="text-xs text-gray-500">需第 2 批 + CF worker 部署才真正生效；这里先存开关。拨动即时保存。</div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className={`text-xs font-mono w-4 text-center ${dmProactive ? "text-lime-400" : "text-gray-500"}`}>
                    {dmProactive ? "开" : "关"}
                  </span>
                  <Switch
                    checked={dmProactive}
                    disabled={dmToggling}
                    onCheckedChange={(v) => handleToggleDmField("proactive_enabled", v)}
                  />
                </div>
              </div>

              {/* 编辑表单 */}
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-300 mb-1.5 block">Base URL</label>
                  <Input
                    placeholder="https://api.deepseek.com/v1"
                    value={dmBaseUrl}
                    onChange={(e) => setDmBaseUrl(e.target.value)}
                    className="bg-white/5 border-white/15 font-mono text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    OpenAI 兼容接口 base URL（不含末尾 <code className="text-gray-400">/chat/completions</code>）
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-300 mb-1.5 block">Model ID</label>
                  <Input
                    placeholder="deepseek-chat"
                    value={dmModel}
                    onChange={(e) => setDmModel(e.target.value)}
                    className="bg-white/5 border-white/15 font-mono text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    私聊不需要工具调用，任何聊天模型都行，可挑更便宜的
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-300 mb-1.5 block">
                    API Key
                    <span className="ml-2 text-xs text-amber-400/80 font-normal">留空表示"不修改"</span>
                  </label>
                  <Input
                    type="password"
                    placeholder={dmConfig?.api_key_set ? "已设置（留空保持不变）" : "首次设置请填入"}
                    value={dmApiKey}
                    onChange={(e) => setDmApiKey(e.target.value)}
                    className="bg-white/5 border-white/15 font-mono text-sm"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-300 mb-1.5 block">
                    私信人设 Persona
                    <span className="ml-2 text-xs text-gray-500 font-normal">留空用代码默认</span>
                  </label>
                  <Textarea
                    placeholder="留空则用代码内置的私信人设"
                    value={dmPersona}
                    onChange={(e) => setDmPersona(e.target.value)}
                    className="bg-white/5 border-white/15 text-sm min-h-[88px]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm text-gray-300 mb-1.5 block">冷却（小时/人）</label>
                    <Input
                      type="number"
                      min={0}
                      max={720}
                      value={dmCooldown}
                      onChange={(e) => setDmCooldown(Number(e.target.value))}
                      className="bg-white/5 border-white/15 font-mono text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">同一人多久最多被主动私信 1 次</p>
                  </div>
                  <div>
                    <label className="text-sm text-gray-300 mb-1.5 block">连发上限</label>
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      value={dmMaxUnanswered}
                      onChange={(e) => setDmMaxUnanswered(Number(e.target.value))}
                      className="bg-white/5 border-white/15 font-mono text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">连发几条没回就停</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-white/10">
                <Button
                  onClick={handleSaveDmAiConfig}
                  disabled={dmConfigSaving || dmConfigLoading}
                  className="bg-lime-700 hover:bg-lime-600"
                >
                  <Save className="h-4 w-4 mr-1.5" />
                  {dmConfigSaving ? "保存中..." : "保存配置"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="announcements">
          <Card className="admin-panel-glass admin-tab-enter">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Megaphone className="mr-2 h-5 w-5 text-lime-400" />
                发布公告
              </CardTitle>
              <CardDescription>
                公告会作为系统通知推送给<span className="text-lime-400">所有当前用户</span>，
                头像显示站点 logo，用户点击通知即可查看全文。
                <span className="text-gray-500">（仅推送给发送时刻已注册的用户，之后注册的新用户看不到旧公告）</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm text-gray-400">标题</label>
                <Input
                  placeholder="例如：更新公告"
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  className="bg-white/5 border-white/15"
                  maxLength={60}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-gray-400">内容（支持换行）</label>
                <Textarea
                  placeholder="输入公告内容..."
                  value={annContent}
                  onChange={(e) => setAnnContent(e.target.value)}
                  className="bg-white/5 border-white/15 min-h-[160px]"
                  maxLength={2000}
                />
                <p className="text-right text-xs text-gray-500">{annContent.length}/2000</p>
              </div>

              {/* 配图（单张，可选）：上传前自动压缩为 webp，降低存储与 egress */}
              <div className="space-y-2">
                <label className="text-sm text-gray-400">配图（可选，单张）</label>
                <input
                  ref={annFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAnnImageSelect}
                />
                {annImagePreview ? (
                  <div className="relative inline-block">
                    <img
                      src={annImagePreview}
                      alt="公告配图预览"
                      className="max-h-48 rounded-lg border border-white/15 object-contain bg-black/20"
                    />
                    <button
                      type="button"
                      onClick={removeAnnImage}
                      disabled={sendingAnn}
                      className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 disabled:opacity-50"
                      aria-label="移除配图"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => annFileInputRef.current?.click()}
                    disabled={sendingAnn}
                    className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/20 bg-white/[0.04] text-white/50 transition-colors hover:border-white/35 hover:bg-white/[0.08] hover:text-white/80 disabled:opacity-50"
                  >
                    <ImageIcon className="h-5 w-5" />
                    <span className="text-xs">选择图片</span>
                  </button>
                )}
                <p className="text-xs text-gray-500">上传前会自动压缩（转 webp、限制尺寸），降低存储与流量。</p>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button
                onClick={() => setShowBroadcastConfirm(true)}
                disabled={sendingAnn || !annTitle.trim() || !annContent.trim()}
                className="bg-lime-700 hover:bg-lime-600"
              >
                <Megaphone className="h-4 w-4 mr-2" />
                {sendingAnn ? "推送中..." : "推送给所有人"}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="mengmegzi">
          <MengmegziAgentPanel />
        </TabsContent>
      </Tabs>

      {/* 公告广播二次确认 */}
      <AlertDialog open={showBroadcastConfirm} onOpenChange={setShowBroadcastConfirm}>
        <AlertDialogContent className="admin-panel-glass text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lime-400 flex items-center">
              <Megaphone className="mr-2 h-5 w-5" />
              确认推送公告
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-300">
              这条公告将作为系统通知推送给<span className="text-lime-400">所有当前用户</span>，无法撤回。确定要发送吗？
              <span className="block mt-2 rounded-md bg-black/30 border border-white/10 p-3 text-sm">
                <span className="block font-semibold text-white">{annTitle || "（无标题）"}</span>
                <span className="mt-1 block whitespace-pre-wrap break-words text-gray-400 line-clamp-4">
                  {annContent || "（无内容）"}
                </span>
                {annImagePreview && (
                  <img
                    src={annImagePreview}
                    alt="公告配图预览"
                    className="mt-2 block max-h-32 rounded border border-white/10 object-contain"
                  />
                )}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/10 text-white hover:bg-white/20 border-white/15">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-lime-700 hover:bg-lime-600 text-white"
              onClick={(e) => {
                // 阻止 AlertDialog 默认关闭，由 handleBroadcast 完成后再关
                e.preventDefault()
                handleBroadcast()
              }}
              disabled={sendingAnn}
            >
              {sendingAnn ? "推送中..." : "确认推送"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="admin-panel-glass text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-400 flex items-center">
              <AlertCircle className="mr-2 h-5 w-5" />
              确认删除
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-300">
              {selectedItem?.type === "post"
                ? "你确定要删除这篇帖子吗？此操作无法撤销，帖子及其相关评论将被永久删除。"
                : selectedItem?.type === "hanako_allowed"
                  ? "你确定要将此用户从 AI 对话白名单中移除吗？移除后该用户将无法与 Hanako AI 对话。"
                  : "你确定要移除这个管理员吗？此操作将撤销该用户的管理员权限。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/10 text-white hover:bg-white/20 border-white/15">
              取消
            </AlertDialogCancel>
            <AlertDialogAction className="bg-red-900 hover:bg-red-800 text-white" onClick={confirmDelete}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 封禁确认弹窗（带可选理由） */}
      <AlertDialog open={!!banTarget} onOpenChange={(open) => { if (!open) { setBanTarget(null); setBanReason("") } }}>
        <AlertDialogContent className="admin-panel-glass text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-400 flex items-center">
              <Ban className="mr-2 h-5 w-5" />
              确认封禁
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-300">
              将封禁用户 <span className="text-white font-medium">{banTarget?.username}</span>。
              封禁后该账号一登录即被锁定、无法使用站内任何功能（发帖 / 评论 / 私聊 / 弹幕 / 改资料等），
              其已有弹幕会被清除。此操作可随时解封。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-sm text-gray-400">封禁理由（可选，仅自己可见）</label>
            <Textarea
              placeholder="例如：辱骂他人"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              className="bg-white/5 border-white/15 min-h-[72px]"
              maxLength={200}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/10 text-white hover:bg-white/20 border-white/15">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-900 hover:bg-red-800 text-white"
              onClick={(e) => {
                e.preventDefault()
                confirmBan()
              }}
              disabled={banning}
            >
              {banning ? "封禁中..." : "确认封禁"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
