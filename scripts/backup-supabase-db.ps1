<#
.SYNOPSIS
  Supabase 远程数据库逻辑备份（roles + schema + data 三件套）。

.DESCRIPTION
  调用 Supabase CLI 的 `db dump`（底层即 pg_dump），把整个数据库导出为
  可还原的 .sql 文件，存到项目根目录 backups\db_<时间戳>\ 下
  （该目录已在 .gitignore 中整体排除）。

  三个文件合起来 = 一份能还原到任意 Postgres / 新 Supabase 项目的完整逻辑备份：
    roles.sql   数据库角色与权限（cluster roles）
    schema.sql  表结构、视图、函数、触发器、RLS 策略、序列等全部 DDL
    data.sql    全部数据行（用 COPY 格式，体积小、恢复快）

  注意：本备份只覆盖 Postgres 数据库本身。Supabase Storage 桶里的文件
  （avatars / post-images / downloads / images 等）不在数据库内，需另行备份。

.PARAMETER DbUrl
  数据库连接字符串（直接传，明文会出现在命令历史里）。

.PARAMETER DbUrlFile
  指向一个仅含连接串的文本文件（推荐：连接串不出现在命令行/对话里）。
  例如把连接串写进 backups\.dburl（该路径已被 .gitignore 排除）。

  连接串从 Dashboard 获取：
    Project Settings → Database → Connection string → 选 "Session pooler"（端口 5432）
  形如：
    postgresql://postgres.uvkupdbfbnodeybulczd:[密码]@aws-0-<region>.pooler.supabase.com:5432/postgres
  把 [密码] 换成真实数据库密码。若密码含 @ : / # ? 等特殊字符，需 percent-encode，
  或先在 Dashboard 把数据库密码临时重置为纯字母数字，避免连接串被解析错。

.EXAMPLE
  # 自己跑（密码会进命令历史）
  .\scripts\backup-supabase-db.ps1 -DbUrl "postgresql://postgres.xxx:pwd@aws-0-xx.pooler.supabase.com:5432/postgres"

.EXAMPLE
  # 把连接串写进 backups\.dburl 后，从文件读（连接串不出现在命令行）
  .\scripts\backup-supabase-db.ps1 -DbUrlFile "backups\.dburl"
#>
param(
    [string]$DbUrl,
    [string]$DbUrlFile
)

$ErrorActionPreference = "Stop"

$cli = "C:\Users\16773\.supabase-cli\supabase.exe"
if (-not (Test-Path $cli)) { throw "找不到 Supabase CLI: $cli" }

if ($DbUrlFile) {
    if (-not (Test-Path $DbUrlFile)) { throw "找不到连接串文件: $DbUrlFile" }
    # 取第一条非空、非注释(#)行作为连接串，方便文件里保留说明注释
    $DbUrl = Get-Content $DbUrlFile |
        Where-Object { $_ -and ($_.Trim() -ne "") -and ($_.Trim() -notmatch '^\s*#') } |
        Select-Object -First 1
    if ($DbUrl) { $DbUrl = $DbUrl.Trim() }
}
if (-not $DbUrl) {
    throw "请用 -DbUrl 直接传连接串，或用 -DbUrlFile 指向仅含连接串的文件。"
}

$root   = Split-Path -Parent $PSScriptRoot
$stamp  = Get-Date -Format "yyyy-MM-dd_HHmmss"
$outDir = Join-Path $root "backups\db_$stamp"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "==> 备份输出目录: $outDir" -ForegroundColor Cyan

Write-Host "[1/3] 导出 roles（角色 / 权限）..." -ForegroundColor Yellow
& $cli db dump --db-url $DbUrl --role-only -f (Join-Path $outDir "roles.sql")
if ($LASTEXITCODE -ne 0) { throw "roles 导出失败 (exit $LASTEXITCODE)" }

Write-Host "[2/3] 导出 schema（表结构 / 函数 / 触发器 / RLS）..." -ForegroundColor Yellow
& $cli db dump --db-url $DbUrl -f (Join-Path $outDir "schema.sql")
if ($LASTEXITCODE -ne 0) { throw "schema 导出失败 (exit $LASTEXITCODE)" }

Write-Host "[3/3] 导出 data（全部数据，COPY 格式）..." -ForegroundColor Yellow
& $cli db dump --db-url $DbUrl --data-only --use-copy -f (Join-Path $outDir "data.sql")
if ($LASTEXITCODE -ne 0) { throw "data 导出失败 (exit $LASTEXITCODE)" }

Write-Host ""
Write-Host "==> 备份完成：" -ForegroundColor Green
Get-ChildItem $outDir | Sort-Object Name |
    Format-Table Name, @{ N = "大小"; E = { "{0:N1} KB" -f ($_.Length / 1KB) } } -AutoSize

Write-Host "⚠️  data.sql 含 auth.users（邮箱/密码哈希）、私信、聊天记录等敏感数据。" -ForegroundColor DarkYellow
Write-Host "    请妥善离线保管，切勿上传或提交进 git（backups\ 已被 .gitignore 排除）。" -ForegroundColor DarkYellow
