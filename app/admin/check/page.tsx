"use client"

import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { Shield, AlertCircle, CheckCircle, XCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function AdminCheckPage() {
  const { user, isAdmin } = useSimpleAuth()
  const [loading, setLoading] = useState(false)
  const [adminRecord, setAdminRecord] = useState<any>(null)
  const [directCheck, setDirectCheck] = useState<boolean | null>(null)
  const [contextCheck, setContextCheck] = useState<boolean | null>(null)
  const [localStorageCheck, setLocalStorageCheck] = useState<boolean | null>(null)

  // 执行管理员检查
  const runAdminChecks = async () => {
    if (!user) return

    setLoading(true)
    try {
      // 1. 直接从数据库检查
      const { data, error } = await supabase.from("admin_users").select("id").eq("user_id", user.id).maybeSingle()

      if (error) {
        console.error("直接检查管理员状态错误:", error)
        setDirectCheck(false)
      } else {
        setDirectCheck(!!data)
        if (data) {
          setAdminRecord(data)
        }
      }

      // 2. 从 AuthContext 检查
      setContextCheck(isAdmin)

      // 3. 从 localStorage 检查
      try {
        const storedSession = localStorage.getItem("userSession")
        if (storedSession) {
          const parsedSession = JSON.parse(storedSession)
          setLocalStorageCheck(!!parsedSession.isAdmin)
        } else {
          setLocalStorageCheck(false)
        }
      } catch (e) {
        console.error("从localStorage读取会话错误:", e)
        setLocalStorageCheck(false)
      }
    } catch (err) {
      console.error("执行管理员检查时出错:", err)
    } finally {
      setLoading(false)
    }
  }

  // 页面加载时执行检查
  useEffect(() => {
    if (user) {
      runAdminChecks()
    }
  }, [user, isAdmin])

  if (!user) {
    return (
      <div className="container py-10">
        <Card className="admin-panel-glass text-white">
          <CardHeader>
            <CardTitle className="text-red-400">未登录</CardTitle>
            <CardDescription className="text-gray-300">请先登录后再检查管理员状态</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container py-10">
      <Card className="admin-panel-glass text-white">
        <CardHeader>
          <CardTitle className="text-lime-400 flex items-center">
            <Shield className="h-5 w-5 mr-2" />
            管理员状态检查
          </CardTitle>
          <CardDescription className="text-gray-300">此页面可以帮助您确认您的管理员状态是否正确设置</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-white">检查结果</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 数据库检查 */}
              <div className="admin-inset-glass p-4 rounded-lg">
                <div className="flex items-center mb-2">
                  {directCheck === null ? (
                    <div className="w-5 h-5 mr-2 rounded-full border-2 border-gray-500 border-t-transparent animate-spin"></div>
                  ) : directCheck ? (
                    <CheckCircle className="h-5 w-5 mr-2 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 mr-2 text-red-500" />
                  )}
                  <h4 className="font-medium">数据库检查</h4>
                </div>
                <p className="text-sm text-gray-300">
                  {directCheck === null
                    ? "正在检查..."
                    : directCheck
                      ? "您在数据库中被标记为管理员"
                      : "您在数据库中不是管理员"}
                </p>
              </div>

              {/* Context 检查 */}
              <div className="admin-inset-glass p-4 rounded-lg">
                <div className="flex items-center mb-2">
                  {contextCheck === null ? (
                    <div className="w-5 h-5 mr-2 rounded-full border-2 border-gray-500 border-t-transparent animate-spin"></div>
                  ) : contextCheck ? (
                    <CheckCircle className="h-5 w-5 mr-2 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 mr-2 text-red-500" />
                  )}
                  <h4 className="font-medium">Context 检查</h4>
                </div>
                <p className="text-sm text-gray-300">
                  {contextCheck === null
                    ? "正在检查..."
                    : contextCheck
                      ? "AuthContext 中您被标记为管理员"
                      : "AuthContext 中您不是管理员"}
                </p>
              </div>

              {/* localStorage 检查 */}
              <div className="admin-inset-glass p-4 rounded-lg">
                <div className="flex items-center mb-2">
                  {localStorageCheck === null ? (
                    <div className="w-5 h-5 mr-2 rounded-full border-2 border-gray-500 border-t-transparent animate-spin"></div>
                  ) : localStorageCheck ? (
                    <CheckCircle className="h-5 w-5 mr-2 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 mr-2 text-red-500" />
                  )}
                  <h4 className="font-medium">localStorage 检查</h4>
                </div>
                <p className="text-sm text-gray-300">
                  {localStorageCheck === null
                    ? "正在检查..."
                    : localStorageCheck
                      ? "localStorage 中您被标记为管理员"
                      : "localStorage 中您不是管理员"}
                </p>
              </div>
            </div>
          </div>

          <Separator className="bg-white/10" />

          {/* 用户信息 */}
          <div>
            <h3 className="text-lg font-medium text-white mb-4">用户信息</h3>
            <div className="admin-inset-glass p-4 rounded-lg">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400 mb-1">用户 ID:</p>
                  <p className="text-sm text-gray-200 font-mono">{user.id}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-1">电子邮箱:</p>
                  <p className="text-sm text-gray-200">{user.email}</p>
                </div>
              </div>
            </div>
          </div>

          {/* 状态总结 */}
          <div className="admin-inset-glass p-4 rounded-lg">
            <div className="flex items-start">
              {directCheck && contextCheck && localStorageCheck ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500 mr-2 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-green-400">管理员状态正常</h4>
                    <p className="text-sm text-gray-300">
                      您的管理员状态已正确设置。您应该能够执行所有管理员操作，包括删除其他用户的帖子。
                    </p>
                  </div>
                </>
              ) : directCheck && (!contextCheck || !localStorageCheck) ? (
                <>
                  <AlertCircle className="h-5 w-5 text-yellow-500 mr-2 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-yellow-400">管理员状态部分正常</h4>
                    <p className="text-sm text-gray-300">
                      您在数据库中是管理员，但前端状态不完全一致。请尝试刷新页面或重新登录。
                    </p>
                  </div>
                </>
              ) : !directCheck ? (
                <>
                  <XCircle className="h-5 w-5 text-red-500 mr-2 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-red-400">不是管理员</h4>
                    <p className="text-sm text-gray-300">
                      您在数据库中不是管理员。如果您认为这是错误，请联系系统管理员。
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-yellow-500 mr-2 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-yellow-400">状态不一致</h4>
                    <p className="text-sm text-gray-300">
                      您的管理员状态不一致。请尝试刷新页面或重新登录以解决此问题。
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>

        <CardFooter>
          <Button
            variant="outline"
            className="bg-lime-950/50 border-lime-800/50 text-lime-400 hover:bg-lime-900/50 hover:text-lime-300"
            onClick={runAdminChecks}
            disabled={loading}
          >
            {loading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                检查中...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                重新检查
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
