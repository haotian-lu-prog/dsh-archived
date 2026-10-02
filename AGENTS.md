# AGENTS.md — dsh-archived-sessions-manager

DSH 的「设置 → 已归档」页：逐条 / 批量删除已归档会话，把会话日志、投影缓存、归档索引三处状态一起处理，
并默认先移进回收站，30 天内可恢复。
工作区总则见 `~/dev/_shared/CONVENTIONS.md`；本文件只写**本项目特有**的东西。

## 结构

- `lib/index.js` — 宿主半边入口：能力探测 + 六条路由的装配
- `lib/host/paths.js` — `$DSH_HOME` 解析、三处状态的路径推导、遗留聚合探测
- `lib/host/metadata.js` — 从投影缓存文档读标题/创建时间/cwd、血缘、旧聚合行
- `lib/host/quarantine.js` — 回收站：park / restore / purge / 过期
- `lib/host/trust.js` — 回环 + 同源 + 标头校验
- `lib/client.js` — 客户端半边（lazy-CJS 单文件，无构建步骤）
- `cordis.patch.yml` — bundle patch：把插件 `insert` 进 profile
- `tools/host-smoke.mjs` — 宿主离线套件（45 项，临时 `DSH_HOME` + 假 ctx，**不需要 DSH**）
- `tools/client-smoke.mjs` — 客户端冒烟（31 项，桩 React + 桩 fetch）
- `tools/compat-check.mjs` — 宿主契约检查（11 项，直接读 app.asar；DSH 升级后**先跑这个**）
- `tools/e2e.py` — 真宿主端到端（建临时会话 → 归档 → 删除 → 回收站 → 恢复 → 永久删除）
- `tools/browser-acceptance.py` — 真浏览器验收（纯标准库 CDP）
- `tools/rpc.py` — 本地 RPC 助手：用 `~/.dsh/.credentials.yaml` 里的会话密钥现场签 cookie

## 命令

```sh
node tools/host-smoke.mjs        # 宿主离线；不需要 DSH，CI 友好
node tools/client-smoke.mjs      # 客户端冒烟
node tools/compat-check.mjs      # 宿主契约（读本机 app.asar）
npm test                         # 上面三套
python3 tools/e2e.py             # 真宿主；需要 dsh web 在跑且插件已加载
python3 tools/e2e.py --print-workspace          # 只看工作区解析结果
python3 tools/browser-acceptance.py             # 真浏览器；先起无头 Chrome --remote-debugging-port=9333
```

AI 代理改完代码**至少跑 `npm test`**；动了路由/删除流水线要再跑 `tools/e2e.py`；动了渲染要跑浏览器验收。

## 硬约束（改代码前先读）

- **删除默认是「移动」，不是 unlink。** `mode: "quarantine"` 把会话目录与投影缓存文档移进
  `$DSH_HOME/.archived-sessions-quarantine/<id>/` 并写 `meta.json`；只有 `mode: "forever"` 才真正删除。
  永远不要把 `forever` 变成默认。
- 一次删除必须清**三处**：会话日志目录（`$DSH_HOME/sessions/<编码工作区>/session-<id>/`，0.2.0 起是
  `session.v4.jsonl.zstd` + `session.lock`）、投影缓存文档（`$DSH_HOME/storages/session_projcache/sessions/<id>.json`）、
  归档索引（workspace registry 的 `archivedSessionIds`，**只经 `unarchiveSession()` 写**，以拿到官方广播）。少清一处，列表就会骗人。
- **索引残留没有 payload 就不进回收站。** `dirs.length === 0 && !cache` 时只清索引——否则回收站里会出现
  永远恢复不了、面板也不显示的条目。
- 只接受**已归档**的 id；正在跑回合的会话、以及有**正在运行的 subagent 后代**的会话必须拒绝。
  拒绝码语义以 `tools/host-smoke.mjs` 与 `tools/e2e.py` 的断言为准，客户端词典必须逐条有文案（smoke 会查）。
- **行的事实源是宿主路由**（`GET /state`），浏览器 `useSessions` 只是增强。绝不允许因为拿不到浏览器摘要就丢行——
  那正是「清不掉的残留」产生的原因，client-smoke 有一条断言专门盯这个回归。
- 删除后的 +3s / +15s / +60s 清扫**只删投影缓存文档**，且要求「该 id 不在归档集合、没在跑、磁盘上没有会话目录」。
  日志目录不会复活；目录回来了说明会话被恢复了，绝不能动。
- 路由信任：仅回环 + 同源。`Origin` 存在时必须与 Host 匹配；浏览器同源 GET 不带 `Origin`，
  由 `sec-fetch-site: same-origin` 兜底；两个信号都没有则拒绝。还要校验标头 `x-dsh-archived-sessions`。
- **DSH 0.2.0-rc.2 没有官方归档设置页**（`dsh-client-ui-settings-unarchive-sessions` 这个包不存在），
  `settings.section` 的 `archived-sessions` id 是空的，所以不需要任何 profile patch。
  `priority: -1` 只是对「还带官方页的旧宿主」的防御，别删。
- `hostSupportsDelete()` 失败时**必须拒绝破坏性请求**（`no-registry`），不允许「假装成功」。

## 约定

- 开工先读 `HANDOFF.md`，收工更新它（当前状态 / 下一步 / 未决问题）并提交。
- 不提交 `tools/__pycache__/`（已在 `.gitignore`）。
- 包就在仓库根目录，已发布到 npm；改完代码要发版才有新版本，catalog 描述也要跟着改（描述必须与代码一致）。
- 提交身份：仓库是 public，全局 `user.email` 是 iCloud 地址会被 GitHub 拒收；
  用 `49531320+haotian-lu-prog@users.noreply.github.com`。
- `DSH_ARCHIVED_SESSIONS_OPENER=none` 会让「打开文件夹」只回路径、不启动文件管理器（headless / CI 用）。
