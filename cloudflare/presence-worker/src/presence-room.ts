// PresenceRoom: 单实例 Durable Object，全站在线状态协调点。
//
// 核心约定：
//   - 全局只有一个 DO 实例（Worker 用 idFromName("global") 路由）
//   - 用 WebSocket Hibernation API：空闲连接不计 CPU 时间
//   - 内存维护 userId → Set<WebSocket>（多标签：同一用户开多页都算"在线"）
//   - 客户端不发心跳；连接断开 = 离线（webSocketClose 回调触发）
//
// 服务端事件协议（→ 客户端）：
//   { type: "snapshot", users: [userId, ...] }   首次连上：全量列表
//   { type: "online",   id: userId }             某人上线（不含自己）
//   { type: "offline",  id: userId }             某人离线
//   { type: "pong" }                              ping 应答（可选）
//
// 客户端 → 服务端：
//   { type: "ping" }                              客户端可选发 ping，服务端回 pong
//
// 软限流：DO 内每日连接计数，超过 RATE_LIMIT_PER_DAY 直接 503。
// 这是 CF Free 层（10 万 req/天）的保险——预留 2 万缓冲。

interface Env {
  PRESENCE: DurableObjectNamespace
  SUPABASE_JWT_SECRET: string
  PRESENCE_ENABLED: string
  ALLOWED_ORIGINS: string
}

const RATE_LIMIT_PER_DAY = 80_000

export class PresenceRoom implements DurableObject {
  private state: DurableObjectState
  private env: Env
  // userId → Set<WebSocket>（同用户多标签）
  private connections: Map<string, Set<WebSocket>> = new Map()
  // 每日连接计数（软限流，跨 Hibernation 不必持久化——重启从 0 起也安全）
  private dailyConnects = 0
  private resetDate = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env

    // Hibernation 恢复：DO 唤醒时从 getWebSockets() 重建 connections
    // （Hibernation 期间 DO 实例可能被回收，但 WS 由 Runtime 保留；
    //  收到消息/关闭时 Runtime 重建 DO 并回调 webSocketMessage/Close）
    for (const ws of this.state.getWebSockets()) {
      const tags = this.state.getTags(ws)
      const userId = tags[0]
      if (!userId) continue
      let set = this.connections.get(userId)
      if (!set) {
        set = new Set()
        this.connections.set(userId, set)
      }
      set.add(ws)
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    // 内部端点：返回当前在线 userId 列表（cron 主动私信用）。仅同 worker 内部 fetch 可达。
    if (url.pathname === "/online") {
      return Response.json({ users: Array.from(this.connections.keys()) })
    }

    const userId = req.headers.get("X-User-Id")
    if (!userId) {
      return new Response("Missing X-User-Id (internal)", { status: 400 })
    }

    // 每日重置 + 软限流
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this.resetDate) {
      this.dailyConnects = 0
      this.resetDate = today
    }
    if (this.dailyConnects >= RATE_LIMIT_PER_DAY) {
      return new Response("Rate limited (daily cap)", { status: 503 })
    }
    this.dailyConnects++

    // 建 WebSocket 对
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    // Hibernation API：标记 userId 作为 tag，关闭时能反查
    this.state.acceptWebSocket(server, [userId])

    // 注册到内存
    let set = this.connections.get(userId)
    const isFirstConnection = !set || set.size === 0
    if (!set) {
      set = new Set()
      this.connections.set(userId, set)
    }
    set.add(server)

    // 发当前 snapshot 给新客户端
    const users = Array.from(this.connections.keys())
    safeSend(server, { type: "snapshot", users })

    // 首次连接 = 该用户刚上线，广播给其他人（不含自己）
    if (isFirstConnection) {
      this.broadcast({ type: "online", id: userId }, server)
    }

    return new Response(null, { status: 101, webSocket: client })
  }

  // Hibernation callback：WS 收到消息
  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    if (typeof msg !== "string") return
    try {
      const data = JSON.parse(msg)
      if (data?.type === "ping") {
        safeSend(ws, { type: "pong" })
      }
    } catch {
      // 静默丢弃格式错误的消息
    }
  }

  // Hibernation callback：WS 关闭
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    this.removeSocket(ws)
  }

  async webSocketError(ws: WebSocket, _err: unknown) {
    this.removeSocket(ws)
  }

  private removeSocket(ws: WebSocket) {
    const tags = this.state.getTags(ws)
    const userId = tags[0]
    if (!userId) return
    const set = this.connections.get(userId)
    if (!set) return
    set.delete(ws)
    if (set.size === 0) {
      this.connections.delete(userId)
      // 该用户最后一条连接关闭 → 广播离线
      this.broadcast({ type: "offline", id: userId })
    }
  }

  private broadcast(msg: unknown, except?: WebSocket) {
    const data = JSON.stringify(msg)
    for (const set of this.connections.values()) {
      for (const ws of set) {
        if (ws === except) continue
        try {
          ws.send(data)
        } catch {
          // 发送失败的 socket 留给关闭回调清理
        }
      }
    }
  }
}

function safeSend(ws: WebSocket, msg: unknown) {
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    // ignore
  }
}
