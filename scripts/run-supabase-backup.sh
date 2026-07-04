#!/usr/bin/env bash
# Supabase 数据库逻辑备份执行器（本机 pg_dump 18，无需 Docker）
#
# 依赖：
#   - backups/_gen/{roles,schema,data}.gen.sh  由 supabase CLI --dry-run 生成并 patch
#   - backups/.dbpass                           仅含数据库密码（一行），已被 .gitignore 排除
#   - C:\Program Files\PostgreSQL\18\bin         本机 pg_dump / pg_dumpall / psql
#
# 用法（Git Bash）：bash scripts/run-supabase-backup.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ⚠️ 改成你自己的 Supabase 项目 ref（在 Supabase Dashboard 首页可见）
HOST="db.YOUR_PROJECT_REF.supabase.co"
PASS_FILE="backups/.dbpass"

if [ ! -f "$PASS_FILE" ]; then
  echo "❌ 找不到 $PASS_FILE —— 请先把数据库密码写进该文件（仅密码，一行）。"
  exit 1
fi

# 读密码：取第一行，去掉 CR/LF 和可能的 UTF-8 BOM；全程不回显
PGPASSWORD="$(head -1 "$PASS_FILE" | tr -d '\r\n' | sed 's/^\xEF\xBB\xBF//')"
export PGPASSWORD
if [ -z "$PGPASSWORD" ]; then echo "❌ $PASS_FILE 为空"; exit 1; fi

# 本机 PG18 客户端进 PATH（gen 脚本里的 pg_dump/pg_dumpall 靠它定位）+ 强制 SSL
export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"
export PGSSLMODE="require"

echo "==> 连接自检 ..."
if ! psql "host=$HOST port=5432 dbname=postgres user=postgres connect_timeout=15 sslmode=require" -tAc "select 1" >/dev/null 2>&1; then
  echo "❌ 连接失败：密码可能不对，或网络/SSL 问题。请核对 backups/.dbpass 后重试。"
  exit 1
fi
echo "    连接成功 ✓"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="backups/db_$STAMP"
mkdir -p "$OUT"
echo "==> 输出目录: $OUT"

echo "[1/3] roles （角色/权限）..."
bash backups/_gen/roles.gen.sh  > "$OUT/roles.sql"
echo "[2/3] schema （表结构/函数/触发器/RLS）..."
bash backups/_gen/schema.gen.sh > "$OUT/schema.sql"
echo "[3/3] data  （全部数据，含 auth.users）..."
bash backups/_gen/data.gen.sh   > "$OUT/data.sql"

echo ""
echo "==> 备份完成。文件大小："
ls -lh "$OUT"
echo ""
echo "==> 行数概览（用于粗查是否导出成功）："
for f in roles schema data; do
  printf "    %-10s %s 行\n" "$f.sql" "$(wc -l < "$OUT/$f.sql")"
done
echo ""
echo "✅ 完成。⚠️ data.sql 含 auth.users（邮箱/密码哈希）、私信、聊天记录等敏感数据，"
echo "   请离线妥善保管，勿上传、勿进 git（backups/ 已被 .gitignore 排除）。"
