/**
 * 显示用用户名兜底。
 *
 * 历史遗留：handle_new_user() 触发器曾把 NEW.email 当 username 写进 profiles
 * （见 scripts/2026-06-16-fix-username-email-trigger.sql）。该脚本已修触发器并回填，
 * 但仍可能有极少数（metadata/user_profiles 也无真名的）老账号残留邮箱用户名。
 * 显示时统一过一道：含 @ 只取前缀，绝不在 UI 暴露完整邮箱。正常用户名不含 @，原样返回。
 */
export function toDisplayName(name: string | null | undefined): string {
  if (!name) return ""
  const i = name.indexOf("@")
  return i > 0 ? name.slice(0, i) : name
}
