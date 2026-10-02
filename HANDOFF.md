# HANDOFF

> 三家接力（DSH / Codex / Claude Code）用这个文件：**开工先读，收工更新并提交。**
> 上游工作区约定见 `~/dev/_shared/CONVENTIONS.md`。

## 当前写者

- 工具：DSH（2026-10-02 0.2.0 重构收工）
- 分支：main
- 开始时间：2026-10-02 16:45

> 一个仓库同一时刻只允许一个写者；下一位开工时把上一行改成自己。

## 当前状态（2026-10-02）—— **改名为 `dsh-archived`，0.3.0**

项目原名 `dsh-archived-sessions-manager`，现为 **`dsh-archived`**（仓库 / npm 包 / 插件 id / 路由前缀全部同步）。
取舍见 `docs/decisions.md`；旧的 npm 包打 deprecate 指向新包，不 unpublish。

### 0.2.0 的交付与验证（改名前的版本）

面向 DSH **0.2.0-rc.2** 的重构已完成、已发版、已在真宿主 + 真浏览器上跑通。合并于 PR #4（squash `e695373`）。

### 关键发现（决定了整次重构）

0.2.0-rc.2 的 290 个 `@deepseek-ai` 包里**没有任何含 `archiv` 的包**——官方归档设置页
`dsh-client-ui-settings-unarchive-sessions` 已经不存在。原来的两大前提（同 id + `priority: -1` 遮蔽官方页、
profile patch 里 `disabled: true`）全部空转。而 `settings.section` 的 `archived-sessions` id 在 0.2.0-rc.2 上是空的，
所以本插件现在是**一等设置页，安装不需要改 profile**。另：DSH 至今没有官方删除会话的接口
（workspace controller 只有 workspace delete + session archive/unarchive），「彻底删除」仍是不可替代的价值。

### 改了什么

- **删除默认进回收站**（`$DSH_HOME/.archived-sessions-quarantine/`，30 天过期），`mode: "forever"` 才是不可逆，
  且在二次确认里作为单独按钮。取舍见 `docs/decisions.md`（Codex 的 archive/delete 分家、两家会话管理器都做软删、
  `/recycle-bin` skill 的「先备份后删除」是三条独立证据）。
- **行的事实源改成宿主 `GET /state`**，浏览器 `useSessions` 只做增强——修掉了「拿不到浏览器摘要就丢行」
  这个真实缺陷（索引残留因此在界面上根本不显示，用户无从清理）。
- 索引残留无 payload 不进回收站；有运行中的 subagent 后代时拒绝删父会话；宿主缺 registry API 时破坏性路由直接拒绝。
- 宿主拆成 `lib/index.js` + `lib/host/{paths,metadata,quarantine,trust}.js`；客户端重写（929 行）。
- 文案：导航行与页面标题 = **`Archived` / `已归档`**。
- `package.json` 升 `0.2.0`；peer 收敛 `^0.2.0-rc.1`（**放弃 0.1.x**）。

### 验证（全部实跑）

| 套件 | 结果 | 环境 |
|---|---|---|
| `tools/host-smoke.mjs` | 45/45 | 离线：临时 `DSH_HOME` + 假 ctx |
| `tools/client-smoke.mjs` | 31/31 | 离线：桩 React + 桩 fetch |
| `tools/compat-check.mjs` | 11/11 | 读本机 app.asar（DSH 0.2.0-rc.2） |
| `tools/e2e.py` | 41/41 | **真宿主**：`DSH_HOME=.scratch/e2e-home dsh web --port 3099`，装的是 npm 上的 0.2.0 |
| `tools/browser-acceptance.py` | 25/25 | **真浏览器**：无头 Chrome + CDP，对着上面那个宿主 |

浏览器验收里最关键的一条是「设置面板里只有一个 `已归档` 入口」——它证明 slot 注册在真实 shell 里确实成立，
且真实点通了「删除 → 确认 → 进回收站 → 恢复最近一个 → 会话回到列表」。

### 顺带修掉的既有缺陷

- `tools/browser-acceptance.py` **自 2026-09-23 起根本跑不起来**：它 `from e2e import WORKSPACE`，而 e2e.py 的
  workspace 重构删掉了这个模块级名字，一 import 就 ImportError。现已补回（并按 `DSH_HOME` 解析）。
- `tools/rpc.py` 硬编码 `~/.dsh/.credentials.yaml`，无法对着隔离宿主跑；现已认 `DSH_HOME`。

## 下一步

- [ ] catalog 条目描述已按 0.2.0 更新（追加到 PR #6375 的分支），等维护者合并。
- [ ] 官方 `ui-settings-unarchive-sessions` 的 `disabled: true` 只在 0.1.x 需要；真要支持 0.1.x 得另做兼容层。
- [ ] 若要把浏览器验收放进 CI：需要一个中文界面语言的 profile，见 `AGENTS.md` 的命令段。

## 未决问题

- `storages/schedule.json` / `message_feedback.json` 里指向已删会话的悬空引用没处理（属宿主 domain store，
  要动得走 `ctx.storageDomain`；而且删会话是否该顺带删用户的定时任务，需要单独立项）。
- 旧聚合 `storages/session_projcache.json` 只探测不清理：宿主自有文件，实测已停止写入。
- `tools/browser-acceptance.py` 的断言是中文文案：非中文界面下会误报。要么加语言判定，要么固定用中文 profile。
- 提交身份：仓库是 public，全局 `user.email` 是 iCloud 地址会被 GitHub 拒收，用
  `49531320+haotian-lu-prog@users.noreply.github.com`。

### 2026-10-02 补充：用户环境里的一次安装失败（与插件无关）

现象：`dsh plugin --profile desktop add dsh-archived` 报
`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，点名的是 **`dsh-notifications@2.0.0`**（另一个包）。

根因（在 profile 副本上逐个变量复现出来）：desktop 的 `pnpm-workspace.yaml` 里
`minimumReleaseAgeExclude` 同时存在 `dsh-notifications@1.0.0` 与 `dsh-notifications@2.0.0`，
**同名两条只有一条生效**，刚发布的 2.0.0 因此过不了闸门。删掉旧的 1.0.0 那条（或合并成
`dsh-notifications@1.0.0 || 2.0.0`）后安装立刻通过。已修好并装进 desktop profile——
本机 GUI 热加载成功，`GET /state` 返回 200。

顺带把 `tools/e2e.py` 在**忙碌真宿主**上的三处竞态改成确定性断言（宿主会在删除后重新写回缓存、
并重新物化它仍持有的会话）：现在对着正在使用的 GUI 连跑两次都是 36 PASS + 3 SKIP，跑完不留残留。


### 2026-10-02 · 改名执行记录（dsh-archived-sessions-manager → dsh-archived）

- **GitHub**：`gh repo rename dsh-archived`；旧 URL 仍会重定向。改名 PR #8 合并于 `850db2f`。
- **npm**：`dsh-archived@0.3.0` 已发布；旧包 0.1.0 / 0.2.0 用 `npm deprecate` 指向新包（**没有** unpublish）。
- **本机 desktop profile 已切换**。踩到两个坑，都写下来：
  1. **先 add 新的再 remove 旧的会出事**——两个插件抢同一个 `settings.section` 插槽（同 id + 同 priority 会抛），
     顺序必须**先 remove 旧的、再 add 新的**。
  2. remove 之前若把旧包名从 `minimumReleaseAgeExclude` 里删掉，**remove 自己会被供应链闸门拦住**
     （旧包 0.2.0 才发布几小时）。正确做法：让旧包名留在排除列表里直到移除完成，之后再清掉那条过期项。
- **目录**：本机仓库目录改名 `~/Dev/plugins/dsh-archived`；确认过没有任何 profile / HMR 配置引用旧路径。
- **验证**：改名后三套离线套件全绿（45 / 31 / 11），真宿主 e2e 对着正在用的 GUI 跑 36 PASS + 3 SKIP，
  跑完 archived 0 / quarantine 0；新路由 `/api/dsh-archived/state` 返回 200，旧路由已消失。
- **有意保留**：回收站目录 `$DSH_HOME/.archived-sessions-quarantine/`、设置页插槽 id `archived-sessions`（DSH 官方 id）。
- catalog：PR #6375 的分支上已把条目文件改名为 `haotian-lu-prog__dsh-archived.yml` 并更新 url/name。

