"use client"

import { useEffect, useState } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { Shield, Users, FileText, Trash2, AlertCircle, Bot, Cpu, Save, RefreshCw } from "lucide-react"
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
import { useToast } from "@/hooks/use-toast"

// ─── 模块级缓存 ────────────────────────────────────────────
// 同一个 tab 内导航走又回来时，沿用上次数据，避免每次都重新请求 spinner。
// 失效时机：浏览器硬刷新（自然清空）/ 用户点页面顶部"刷新"按钮（手动重拉）。
// 管理员的写操作（如 addAdmin / delete / saveAiConfig）会同步写回这两个变量，
// 因此缓存数据始终是"用户上次看到的样子"，不会出现陈旧 UI。
type CachedAdminData = {
  users: any[]
  posts: any[]
  admins: any[]
  hanakoAllowedUsers: any[]
}
type CachedAiConfig = {
  base_url: string
  api_key_masked: string
  api_key_set: boolean
  model: string
  updated_at: string | null
}
let cachedAdminData: CachedAdminData | null = null
let cachedAiConfig: CachedAiConfig | null = null

export default function AdminPage() {
  const { user, isAdmin, loading: authLoading } = useSimpleAuth()
  const router = useRouter()
  const { toast } = useToast()
  // 缓存命中就跳过 spinner，直接渲染
  const [loading, setLoading] = useState(!cachedAdminData)
  const [users, setUsers] = useState<any[]>(cachedAdminData?.users || [])
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

  // AI 模型配置状态
  const [aiConfig, setAiConfig] = useState<CachedAiConfig | null>(cachedAiConfig)
  const [aiConfigLoading, setAiConfigLoading] = useState(false)
  const [aiConfigSaving, setAiConfigSaving] = useState(false)
  // 表单本地态：base_url / model 直接绑定；api_key 单独管理（留空 = 不修改）
  const [aiBaseUrl, setAiBaseUrl] = useState(cachedAiConfig?.base_url || "")
  const [aiModel, setAiModel] = useState(cachedAiConfig?.model || "")
  const [aiApiKey, setAiApiKey] = useState("")

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
  }, [user, isAdmin, authLoading, router])

  const loadData = async () => {
    setLoading(true)
    try {
      // 并行查询所有表
      const [usersResult, postsResult, adminsResult, allowedResult] = await Promise.allSettled([
        supabase
          .from("profiles")
          .select("id, username, avatar_url, updated_at")
          .order("updated_at", { ascending: false, nullsFirst: false }),
        supabase
          .from("posts")
          .select("id, title, content, description, category, user_id, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("admin_users")
          .select("id, user_id, added_by, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("hanako_allowed_users")
          .select("id, user_id, added_by, created_at")
          .order("created_at", { ascending: false }),
      ])

      // 收集本次拉到的结果到 snapshot，最后一并写 state + 缓存
      // 某项查询失败就保留上次状态值，不至于把 UI 清空
      const snapshot: CachedAdminData = {
        users,
        posts,
        admins,
        hanakoAllowedUsers,
      }

      // 处理用户列表
      if (usersResult.status === "fulfilled" && !usersResult.value.error) {
        snapshot.users = usersResult.value.data || []
      }

      // 处理帖子列表
      if (postsResult.status === "fulfilled" && !postsResult.value.error) {
        const postsData = postsResult.value.data || []
        const postUserIds = [...new Set(postsData.map(p => p.user_id).filter(Boolean))]
        const usernameMap = new Map<string, string>()

        if (postUserIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, username")
            .in("id", postUserIds)

          for (const p of profiles || []) {
            if (p.username) {
              const name = p.username.includes("@") ? p.username.split("@")[0] : p.username
              usernameMap.set(p.id, name)
            }
          }
        }

        snapshot.posts = postsData.map(post => ({
          ...post,
          username: usernameMap.get(post.user_id) || `用户_${post.user_id.substring(0, 6)}`,
        }))
      }

      // 处理管理员列表
      if (adminsResult.status === "fulfilled" && !adminsResult.value.error) {
        const adminsData = adminsResult.value.data || []
        const adminUserIds = [...new Set(adminsData.map(a => a.user_id).filter(Boolean))]
        const adminProfileMap = new Map<string, { username: string | null }>()

        if (adminUserIds.length > 0) {
          const { data: adminProfiles } = await supabase
            .from("profiles")
            .select("id, username")
            .in("id", adminUserIds)

          for (const p of adminProfiles || []) {
            adminProfileMap.set(p.id, { username: p.username })
          }
        }

        snapshot.admins = adminsData.map(a => ({
          ...a,
          users: {
            username: adminProfileMap.get(a.user_id)?.username || null,
            email: null,
          },
        }))
      }

      // 处理 AI 白名单
      if (allowedResult.status === "fulfilled" && !allowedResult.value.error) {
        const allowedData = allowedResult.value.data || []
        const allowedUserIds = allowedData.map((a) => a.user_id).filter(Boolean)
        const allowedUsernameMap = new Map<string, string>()

        if (allowedUserIds.length > 0) {
          const { data: allowedProfiles } = await supabase
            .from("profiles")
            .select("id, username")
            .in("id", allowedUserIds)

          for (const p of allowedProfiles || []) {
            if (p.username) {
              allowedUsernameMap.set(p.id, p.username)
            }
          }
        }

        snapshot.hanakoAllowedUsers = allowedData.map((a) => ({
          ...a,
          username: allowedUsernameMap.get(a.user_id) || null,
        }))
      }

      // 一并提交：组件 state + 模块缓存
      setUsers(snapshot.users)
      setPosts(snapshot.posts)
      setAdmins(snapshot.admins)
      setHanakoAllowedUsers(snapshot.hanakoAllowedUsers)
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
        await supabase.rpc("delete_post", {
          p_post_id: selectedItem.id,
        })
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

      const res = await fetch("/api/admin/ai-config", {
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

      const res = await fetch("/api/admin/ai-config", {
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

  if (loading) {
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
        <Card className="bg-gray-900 border-gray-800">
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
          }}
          disabled={loading || aiConfigLoading}
          className="text-gray-400 hover:text-lime-400"
          title="重新拉取所有数据"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading || aiConfigLoading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      <Tabs defaultValue="admins" className="w-full">
        <TabsList className="mb-4 bg-gray-900">
          <TabsTrigger value="admins" className="data-[state=active]:bg-lime-900/30 data-[state=active]:text-lime-400">
            <Shield className="mr-2 h-4 w-4" />
            管理员
          </TabsTrigger>
          <TabsTrigger value="users" className="data-[state=active]:bg-lime-900/30 data-[state=active]:text-lime-400">
            <Users className="mr-2 h-4 w-4" />
            用户
          </TabsTrigger>
          <TabsTrigger value="posts" className="data-[state=active]:bg-lime-900/30 data-[state=active]:text-lime-400">
            <FileText className="mr-2 h-4 w-4" />
            帖子
          </TabsTrigger>
          <TabsTrigger value="hanako" className="data-[state=active]:bg-lime-900/30 data-[state=active]:text-lime-400">
            <Bot className="mr-2 h-4 w-4" />
            AI 对话权限
          </TabsTrigger>
          <TabsTrigger value="ai-config" className="data-[state=active]:bg-lime-900/30 data-[state=active]:text-lime-400">
            <Cpu className="mr-2 h-4 w-4" />
            AI 模型
          </TabsTrigger>
        </TabsList>

        <TabsContent value="admins">
          <Card className="bg-gray-900 border-gray-800">
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
                  className="mr-2 bg-gray-800 border-gray-700"
                />
                <Button onClick={handleAddAdmin} disabled={addingAdmin} className="bg-lime-700 hover:bg-lime-600">
                  {addingAdmin ? "添加中..." : "添加管理员"}
                </Button>
              </div>

              <div className="border rounded-md border-gray-800">
                <div className="grid grid-cols-3 gap-4 p-4 font-medium text-gray-400 border-b border-gray-800">
                  <div>用户名</div>
                  <div>添加时间</div>
                  <div className="text-right">操作</div>
                </div>
                {admins.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">暂无数据</div>
                ) : (
                  admins.map((admin) => (
                    <div
                      key={admin.id}
                      className="grid grid-cols-3 gap-4 p-4 border-b border-gray-800 last:border-0 items-center"
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
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle>用户列表</CardTitle>
              <CardDescription>查看所有注册用户</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md border-gray-800">
                <div className="grid grid-cols-3 gap-4 p-4 font-medium text-gray-400 border-b border-gray-800">
                  <div>用户名</div>
                  <div>用户 ID</div>
                  <div className="text-right">操作</div>
                </div>
                {users.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">暂无数据</div>
                ) : (
                  users.map((u) => (
                    <div
                      key={u.id}
                      className="grid grid-cols-3 gap-4 p-4 border-b border-gray-800 last:border-0 items-center"
                    >
                      <div className="text-white">{u.username || "未设置"}</div>
                      <div className="text-gray-300 font-mono text-xs truncate">{u.id}</div>
                      <div className="text-right">{/* 这里可以添加用户管理操作，如封禁等 */}</div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="posts">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle>帖子列表</CardTitle>
              <CardDescription>管理所有帖子</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md border-gray-800">
                <div className="grid grid-cols-4 gap-4 p-4 font-medium text-gray-400 border-b border-gray-800">
                  <div>标题</div>
                  <div>作者</div>
                  <div>发布时间</div>
                  <div className="text-right">操作</div>
                </div>
                {posts.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">暂无数据</div>
                ) : (
                  posts.map((post) => (
                    <div
                      key={post.id}
                      className="grid grid-cols-4 gap-4 p-4 border-b border-gray-800 last:border-0 items-center"
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
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle>AI 对话白名单</CardTitle>
              <CardDescription>管理允许与 Hanako AI 对话的用户</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex mb-4">
                <Input
                  placeholder="输入用户名或用户 ID"
                  value={newAllowedUserInput}
                  onChange={(e) => setNewAllowedUserInput(e.target.value)}
                  className="mr-2 bg-gray-800 border-gray-700"
                />
                <Button onClick={handleAddAllowedUser} disabled={addingAllowedUser} className="bg-lime-700 hover:bg-lime-600">
                  {addingAllowedUser ? "添加中..." : "添加用户"}
                </Button>
              </div>

              <div className="border rounded-md border-gray-800">
                <div className="grid grid-cols-3 gap-4 p-4 font-medium text-gray-400 border-b border-gray-800">
                  <div>用户名</div>
                  <div>添加时间</div>
                  <div className="text-right">操作</div>
                </div>
                {hanakoAllowedUsers.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">暂无数据</div>
                ) : (
                  hanakoAllowedUsers.map((allowed) => (
                    <div
                      key={allowed.id}
                      className="grid grid-cols-3 gap-4 p-4 border-b border-gray-800 last:border-0 items-center"
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
          <Card className="bg-gray-900 border-gray-800">
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
              <div className="rounded-md border border-gray-800 bg-gray-950 p-4 text-sm">
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
                    {aiConfig.updated_at && (
                      <div className="flex pt-1.5 mt-1.5 border-t border-gray-800">
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
                    className="bg-gray-800 border-gray-700 font-mono text-sm"
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
                    className="bg-gray-800 border-gray-700 font-mono text-sm"
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
                    className="bg-gray-800 border-gray-700 font-mono text-sm"
                    autoComplete="off"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    出于安全考虑，已存的 API Key 不会回显明文，只显示掩码。
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-gray-800">
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
      </Tabs>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-gray-900 border-gray-800 text-white">
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
            <AlertDialogCancel className="bg-gray-800 text-white hover:bg-gray-700 border-gray-700">
              取消
            </AlertDialogCancel>
            <AlertDialogAction className="bg-red-900 hover:bg-red-800 text-white" onClick={confirmDelete}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
