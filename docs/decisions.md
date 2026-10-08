# 决策记录

## 2026-10-02 · 包从 `plugin/` 上移到仓库根目录

**背景**：要发布到 npm 并投稿 `awesome-dsh-plugin` catalog。

**选项**

1. 保持 `plugin/` 子目录，catalog 条目用 monorepo 形态：`url` 指到 `/tree/main/plugin`，`name` 写 `owner/repo#plugin`。
2. 把包上移到仓库根目录，catalog 条目用普通形态：`url` = 仓库根，`name` = `owner/repo`。

**取舍**：方案 1 改动最小，但 npm 只从**包根**取 README/LICENSE，所以 `plugin/` 里得再放一份；方案 2 会动目录结构，但根 `README.md` / `LICENSE` 同时服务 GitHub 与 npm tarball，且与本账号的 `dsh-notifications` 布局一致。

**结论**：选方案 2。动手前核查过三件事——`tools/` 与 `.github/` 都不引用 `plugin/` 路径；插件当时没有装进任何 profile；仓库工作树干净。

## 2026-10-02 · 仓库由 private 改为 public

catalog 的 CI（`scripts/check-submission.mjs`）与 dsh-market 前端都以**匿名**身份读仓库来校验 `dsh.bundle`、抓 README / 截图，私库一律 404。发 npm 不需要公开仓库，但进目录必须公开。改公开前确认过仓库里没有密钥：`tools/rpc.py` 只在运行时读 `~/.dsh/.credentials.yaml`，没有任何内嵌凭据。

## 2026-10-02 · 0.2.0 重构：从「接管官方页」改成「一等 Archived 设置页」

**背景**：0.2.0-rc.2 上，官方包 `dsh-client-ui-settings-unarchive-sessions` **已经不存在**（290 个 `@deepseek-ai` 包里没有任何名字含 `archiv` 的包）。原来的两大前提——同 id 遮蔽 + profile patch 里 `disabled: true`——都成了空转；而 `settings.section` 的 `archived-sessions` id 在 0.2.0-rc.2 上是空的（官方只占 `account/general/models/plugins/agent-presets`）。

**结论**：改成普通注册，安装即出现；删除 profile patch 那一步。`priority: -1` 保留，作为对「还带官方页的旧宿主」的防御。同时**放弃 0.1.x**：`peerDependencies` 收敛到 `^0.2.0-rc.1`。

## 2026-10-02 · 删除默认进回收站，`forever` 才是不可逆

**背景**：原实现是 `rm -rf` + 清索引，一步到位且不可撤销。而三条独立证据都指向同一件事——不可逆才是风险点：
`/recycle-bin` skill 把「先备份、后删除」写成了硬规则；TOBYCAI/dsh-sessions-manager 与 dream12347/dsh-session-manager 都做软删进回收站；Codex 的 `thread/archive` 与 `codex delete` 是**两条命令、两套确认**，从不混用。

**选项**

1. 保持不可逆删除，只在确认文案上加强。
2. 默认进隔离区（30 天 / 可恢复），并保留一个显式的「永久删除」。

**取舍**：方案 1 更简单、也更符合插件名里的「彻底删除」；但它把用户唯一无法挽回的操作放在了一次点击之后，而三家参考实现都刻意避开了这一点。方案 2 多一个状态、多一个过期策略，但把「误删」从灾难降级成麻烦。

**结论**：选方案 2。隔离区在 `$DSH_HOME/.archived-sessions-quarantine/`（与 `sessions/` 同卷，移动是 `rename`），
面板常显「回收站 N 个 · X MB」并提供恢复 / 清空；30 天后自动清除。**回退成本很低**：`mode` 字段已经把两条路径分开，
删掉隔离区分支即可回到方案 1。

## 2026-10-02 · 归档列表的事实源移到宿主

**背景**：原客户端用 `props.useSessions` 的摘要建行，拿不到摘要就 `continue` 丢行，全丢时显示「这里没有可恢复的已归档会话」。
于是「归档索引里还留着、磁盘上已经什么都没有」的残留**在界面上根本不存在**，用户也就无从清起——`/recycle-bin` skill 里「63 条索引、52 条无数据残留」正是这个形态。

**结论**：行的唯一事实源改成宿主路由 `GET /state`（归档集合 + 磁盘 + 投影缓存文档），浏览器摘要只用来**增强**标题与时间。
投影缓存文档实测带 `record.rows.title.val` 与 `record.identity.{createdAt, cwd, formatVersion}`，足够画一行。
`tools/client-smoke.mjs` 有两条断言盯这个回归（index-only 行必须渲染、只有宿主知道标题的行必须用宿主标题）。

## 2026-10-02 · 放宽路由信任：桌面应用被误拒（0.3.1）

**现象**：在 **DeepSeek Harness 桌面应用**里，设置 → 已归档 一直显示"读不到宿主状态"，而同一台机器上
用普通浏览器（含无头 Chrome）打开同一个 `http://127.0.0.1:19387` 却完全正常。

**排查**（每一步都留下证据，先后推翻了两个错误假设）：
1. 先以为是"插件没装/改名没生效"——宿主路由 200、boot payload 只有新名字，否定。
2. 再以为是"页面挂着改名前的旧客户端"——桌面应用的 Code Cache 显示 17:49–17:52 已经加载了新模块，否定。
3. 读到 `@deepseek-ai/dsh-desktop-host`：桌面应用起 `--port 19387`、把
   `ctx.connection.authenticatedUrl(...)` 连同 `collectIndexInjections()` 通过 IPC 交给 Electron 加载；
   Electron 侧存在 `x-dsh-auth-token` 与 `webRequest` 相关逻辑——也就是说**桌面应用的请求会经过它自己的管线**，
   不一定带着页面发起的 fetch 才有的 Fetch Metadata 头。

**根因**：原信任规则要求 `sec-fetch-site: same-origin`（或 `Origin` 与 Host 匹配）**且**自定义标头
`x-dsh-archived` **同时**成立。桌面应用的调用一旦缺少 Fetch Metadata 头，就被判 403，而 403 又不留任何痕迹。

**新规则**：回环 + 非跨站；`Origin`/`sec-fetch-site` 一旦出现就权威且不能被标头推翻；两者都没有时才要标头。
配套两条：把**被拒请求连同证据**记进内存并由 `/state` 暴露（最多 20 条），以及让客户端在报错里带上原因。

**顺带**：旧的 `/api/dsh-archived-sessions/*` 前缀与旧标头继续服务，让改名时已经打开的标签页
不必刷新就能继续用——改一次名不该把所有开着的窗口变成错误页。

## 2026-10-02 · 项目改名为 `dsh-archived`

**背景**：原名 `dsh-archived-sessions-manager` 同时是仓库名、npm 包名、插件 id 和仓库目录名，太长；
它的职责也早就比"manager"窄——只做归档区那件事。

**改了什么**：仓库、npm 包、插件/bundle id、客户端模块 id、locale 命名空间、CSS 前缀、日志前缀、
路由前缀（`/api/dsh-archived-sessions/*` → `/api/dsh-archived/*`）、标头（`x-dsh-archived-sessions` → `x-dsh-archived`）、
环境变量（`DSH_ARCHIVED_SESSIONS_OPENER` → `DSH_ARCHIVED_OPENER`）。

**没改什么**（有意为之）：
- **回收站目录仍是 `$DSH_HOME/.archived-sessions-quarantine/`**——它是磁盘上的既有状态，改名会把已 park 的会话变成孤儿。
- **设置页的插槽 id 仍是 `archived-sessions`**——那是 **DSH 官方的 slot id**，不是我们的名字，改了就不再是同一格。
- 隔离宿主 / 老 npm 包名保留：旧包 `dsh-archived-sessions-manager` 打 deprecate 指向新包，不 unpublish。

**版本**：`0.3.0`。同一个版本号不该在两个包名下存在两份语义不同的东西，
而这次路由前缀与标头都变了，属于破坏性变更，0.x 里就该是 minor。

## 2026-10-02 · 三个参考插件的功能取舍

**采纳**：回收站（TOBYCAI / dream12347）、批量勾选、血缘（父/子会话）、按工作区分组、搜索含会话 ID、打开记录文件夹（Zephyr-vibe）、
「能力不可验证就不要开放操作」（TOBYCAI `src/compat/capabilities.js` → `lib/index.js` 的 `hostSupportsDelete` + `tools/compat-check.mjs`）。

**忽略**：收藏 / 标签 / 保存筛选 / 自动归档 / 跨工作区移动（TOBYCAI）、未读标记 / fork / 统计弹窗 / 上下文压缩阈值（dream12347）、
双标签页（Zephyr-vibe）、解析 zstd 会话日志。

**理由**：这些属于「会话管理器」而不是「归档页」。TOBYCAI 为此维护了十来个自建索引（star-index / tag-index / saved-filters / lineage / zstd-frame …），
把它们搬进来只会得到一个维护成本高、定位模糊的低配版；本插件保持「只管归档区」的窄边界。

## 2026-10-02 · `/recycle-bin` skill 保留，但不把它的手工机制搬进插件

skill 的价值在于「插件没装 / 宿主起不来」时仍能清理，以及它写下来的安全纪律（先备份、只动归档 id、事后核对其他会话数量）。
但它的实现方式——自签 cookie 调 RPC、必要时手改 `workspace.json`——在插件里是**倒退**：插件跑在宿主进程内，
直接 `ctx.workspaceRegistry.unarchiveSession()` 就能拿到官方广播，而 skill 自己也写明手改会被内存状态覆盖。
**结论**：skill 保留为兜底路径，在 SKILL.md 里注明「装了插件优先走 UI」；纪律部分（备份→删除→核对）吸收成隔离区 + e2e 断言。

## 2026-10-08 · 接受导入命名空间的 id，并把「目录名」和「注册表 id」分开（0.3.2）

**背景**：用户报「已归档」页删不掉。真机 40 条全删不掉，且**一个字节都没动**。

**两个缺陷，各自都能独立造成「静默失败」**

1. `SESSION_ID` 只认 `session-<uuid>`，而导入插件把归档行命名成 `import-<uuid>` / `import-session-<uuid>`。
   `deleteOne()` 第一行回绝，界面只拿到一句通用错误。
2. 归档索引里的 id 带命名空间，磁盘上的会话目录**不带**（DSH 按日志头里的 `id` 命名）。
   老 `locateArtifacts` 用注册表 id 拼路径，真机 40 条命中 0 条。

**选项**

1. 字符串去前缀猜目录名（`strip("import-")`）：一行搞定，但哪个前缀对取决于导入器怎么写，错了就是删 0 个目录还报成功。
2. 目录名按 `encodeSegment` 解码后与候选 id 比对（`decodeSegment`），只认候选内的名字。

**结论**：方案 2。判据是「猜错会静默丢数据」，而这个插件的全部价值就是不让列表骗人——
`removed.directories === 0` 但 `ok: true` 正是它要防的那种假成功。
另外把「注册表 id」与「存储 id」显式分成两个概念：`canonicalSessionId()` 只用于宿主 API 与磁盘，
返回给客户端的 `sessionId` 仍是注册表 id，`archivedSessionIds` 的增删也仍用注册表 id（宿主的集合就是这么存的）。

**顺带修的信任/显示问题**：`import-<uuid>` 剥出的裸 uuid 可能撞上一个**正在跑的** `session-<uuid>`
（smoke 的固定 id 正好撞出来），所以运行中检查要连别名一起查；客户端 `request()` 以前不校验 HTTP 状态，
403/500 会 resolve 成一个没有 `results` 的对象，再在 `.filter` 上抛 `TypeError`，把真实原因换成通用文案。

**版本**：`0.3.2`。纯缺陷修复，没有新增能力，也没有需要使用者改配置的变更；
`0.3.0` / `0.3.1` 那两个带 `!` 是因为改了包名与信任语义，这次不需要。
