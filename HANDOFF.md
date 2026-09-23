# HANDOFF

> 三家接力（DSH / Codex / Claude Code）用这个文件：**开工先读，收工更新并提交。**
> 上游工作区约定见 `~/dev/_shared/CONVENTIONS.md`。

## 当前写者

- 工具：（空 —— 2026-09-23 02:10 DSH 会话收工）
- 分支：main
- 开始时间：—

> 一个仓库同一时刻只允许一个写者；下一位开工时把上一行改成自己。

## 当前状态（2026-09-23 核对）

- 功能完整：宿主 `plugin/lib/index.js`（389 行）+ 客户端 `plugin/lib/client.js`（592 行）+ patch
- 测试齐全（以工具头部的项目数为准）：
  - `python3 tools/e2e.py` —— 宿主 15 项（完整删除链路、三种拒绝码、四种请求信任形态）
  - `node tools/client-smoke.mjs` —— 客户端 13 项
  - `python3 tools/browser-acceptance.py` —— 真浏览器 17 项（需先起无头 Chrome，`--remote-debugging-port=9333`）
- 2026-09-22 首次入库（此前只有工作副本、没有版本控制）；2026-09-23 补 `AGENTS.md`、本文件、`.github/workflows/conventions.yml`
- 远端：`haotian-lu-prog/dsh-archived-sessions-manager`（私库），`main` 与 `origin/main` 一致

## 下一步

- [x] ~~`tools/e2e.py` 的 `WORKSPACE` 硬编码 iCloud 路径~~ → **已修（2026-09-23）**：解析顺序 `--workspace` > `$DSH_E2E_WORKSPACE` > 当前目录；`--print-workspace` 可在不碰 DSH 的情况下查看解析结果；路径不存在时退出 2 并给出提示。注意 `--print-workspace` 与真正跑测试走同一套校验。
- [ ] 浏览器验收依赖手动起 Chrome 调试端口；若以后想上 CI，只把前两套（无需浏览器）放进 workflow
- [ ] `plugin/package.json` 是 `"private": true`；哪天要发布到 npm，需要补版本策略与 `files`

## 未决问题

- 是否发布到 npm？（当前安装方式是 `link:` 软链 + profile patch，够用但不利于别人复用）
- 官方 DSH 若自行加上「彻底删除」，本插件是否退役、还是继续接管？（接管逻辑依赖 `priority: -1` + `disabled: true` 两步，官方改动会影响它）
