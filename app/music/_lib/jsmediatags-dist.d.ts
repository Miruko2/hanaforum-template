// jsmediatags 浏览器 dist 无类型声明（@types/jsmediatags 只覆盖主入口）。
// 我们刻意动态导入这个 dist 以避开主入口的 node 'fs' 依赖（Next 客户端打包会报
// Module not found: fs）。声明为 shorthand ambient module（导入即 any），运行时在
// localTracks.ts 里按需取 .read。
declare module "jsmediatags/dist/jsmediatags.min.js"
