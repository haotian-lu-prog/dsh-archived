# HANDOFF

> 三家接力（DSH / Codex / Claude Code）用这个文件：**开工先读，收工更新并提交。**
> 上游工作区约定见 `~/dev/_shared/CONVENTIONS.md`。

## 当前写者

- 工具：DSH（会话 `session-ce4a5890`）· 2026-10-09 15:25 JST 起
- 分支：`release/0.4.0`（0.4.0 已发布；本 PR 合并后回 main）
- 开始时间：2026-10-09 15:25 JST
- 本轮：**并入「陈旧会话清理」**（手动 + 半自动）。扫描「14 天以上 + 空会话」→ 勾选删除：官方
  `Workspace.detachSession` 从工作区列表移除 + 复用现有回收站流水线；可选的每周自动运行 = **只移进回收站**。
  取舍与边界见 `docs/decisions.md`。
  **已完成**：`lib/host/sweep.js`（扫描 + detach 计划）· `lib/index.js`（4 条路由 + 每周定时器 + 设置文档
  `$DSH_HOME/dsh-archived/sweep.json`）· `lib/client.js`（页面顶部一节 + 中英 i18n）· 离线套件与契约检查
  （`npm test` 全绿：69 / 31 / 12 项）· README / AGENTS / decisions 同步。
  **已验证**：真宿主 `tools/e2e.py` 在**隔离宿主**上跑通（临时 `DSH_HOME` + `--from-default-profile web` +
  `dsh plugin add link:<repo>` + 端口 3987–3993）：**55 PASS / 3 SKIP / 0 FAIL**。期间顺手修了两处既有问题 ——
  ① e2e 的「无 marker 即拒绝」是 0.3.1 之前的旧规则（现在「已证明的同源 Origin」就够）；② artifact 尺寸断言没等日志落盘。
  并补了 sweep 场景（扫描/24h 保护/入回收站/每周运行）。
  **真宿主行为记录**：这份 DSH 没有 `attachSession` 远程（只有 `insertSessionBefore` 与 `detachSession`），
  所以 RPC 建的会话不在任何工作区列表里 —— 此时 `detached: 0` 是正确结果，不是缺陷（e2e 里以 SKIP 注明原因）。
  **已推送并开 PR**：`feat/stale-sweep` → **PR #13**（https://github.com/haotian-lu-prog/dsh-archived/pull/13）。
  **已发布 0.4.0**（2026-10-09 16:30 JST）：PR #13 合并（`5993d62`）→ 打标签 `v0.4.0` → `npm publish`
  （由用户执行：本机账号开了 2FA，CLI 侧 publish 会以 `EOTP` 结束 —— 预期行为，不是缺陷）→
  GitHub Release [v0.4.0](https://github.com/haotian-lu-prog/dsh-archived/releases/tag/v0.4.0)。
  **两条发版经验**：① npm 发布后会进处理队列，CLI 提示「Your package is being processed…」，
  此后**几分钟内** `npm view <pkg>@<版本>` 是 **E404**、消费者也装不上 —— 正常排队，**不要重复发布**，
  等几分钟再确认 `dist-tags.latest`；② 2FA 账号下 `npm publish` 需要 OTP，非交互执行必然 EOTP，
  要么交互式发、要么用带 bypass 的 granular token。
  **消费者冒烟**（skill Step 5）：从 npm 装 0.4.0 进全新隔离 profile → 起宿主 → 真宿主 e2e **55 PASS / 0 FAIL / 3 SKIP**。
  **未做**：浏览器验收 `tools/browser-acceptance.py`（需要无头 Chrome 9333；用户已豁免）。

> 一个仓库同一时刻只允许一个写者；下一位开工时把上一行改成自己。

## 当前状态（2026-10-08）—— **发布 0.3.2：接受导入 id + 按真实 id 解析目录**

用户报「设置 → 已归档」里删不掉（截图里 40 条，点「删除全部」只得到一句通用错误）。
根因两条，都已在真机数据上证实并已修：

1. **id 白名单写死了。** `lib/host/paths.js` 的 `SESSION_ID` 只认 `session-<uuid>`，
   而面板里那 40 条全是导入插件命名的 `import-<uuid>` / `import-session-<uuid>`。
   `deleteOne()` 第一行就 `invalid-session-id`，一个字节都没动——回收站目录 mtime 还停在 10-02，
   40 个投影缓存文档 mtime 还是导入那一刻。逐条删除、批量删除、恢复、打开文件夹全部同样被拒。
2. **目录名 ≠ 注册表 id。** 归档索引存带命名空间的 id，磁盘上的会话目录是 `session-<uuid>`
   或裸 uuid（DSH 按日志头里的 `id` 命名，见 `encodeSegment`）。老 `locateArtifacts` 直接拿注册表 id
   拼路径，真机上 40 条命中 0 条——**只修正则的话会「报告成功、日志全留在盘上」**，
   正是本插件存在的意义所要防的那种假成功。

改动（`lib/host/paths.js`、`lib/host/quarantine.js`、`lib/index.js`、`lib/client.js`）：

- `SESSION_ID` 接受三种形态；新增 `canonicalSessionId`（剥掉导入命名空间 → 裸 uuid，
  给宿主 API 与磁盘用）和 `artifactIdCandidates`（候选目录名）。
- `locateArtifacts` 先试候选名，再用 `decodeSegment` 比对目录名，**只认候选内的名字**，
  命名空间撞车也不会误删别的会话日志。
- 导入行可能别名到一个正在跑的会话（`import-<uuid>` 的裸 uuid 撞上 `session-<uuid>`）：
  新增 `runningAlias` 拒绝，smoke 有专门断言。
- 回收站路径与缓存文档一律用裸 id（`projectionCacheFile(canonicalSessionId(id))`）；
  `restoreSession` 也把目录放回裸 id 名下，否则恢复完又找不到。
- 客户端 `request()` 现在会因非 2xx 抛错（以前 403/500 照样 resolve，
  再在 `payload.results.filter` 上抛 TypeError，把真实原因换成一句通用错误）；
  批量结果读取加了形状兜底，错误码经 `describeError` 本地化。

验证（全部实跑）：

| 套件 | 结果 |
|---|---|
| `tools/host-smoke.mjs` | 68/68（新增 import id 回归，含「别名到运行中会话必须拒绝」与 5 条畸形 id 拒绝） |
| `tools/client-smoke.mjs` | 31/31 |
| `tools/compat-check.mjs` | 11/11 |
| `tools/e2e.py` | 40/40（隔离 `DSH_HOME=/tmp/dsh-e2e-home`，`dsh --profile web --port 3199`，插件 symlink 指向本仓库） |

顺带修掉两条**过时/脆弱**的 e2e 断言（非本次改动引入）：`marker=False` 那条写于
「必须有标头」的年代，而桌面应用修复后同源 `Origin` 本身就是证据；artifact 大小那条对
空日志的 scratch 会话断言 `bytes > 0`。两条都改成与 README 一致的说法。

**未决：** ①0.3.2 发布记录见 `docs/decisions.md`（npm 上装 0.3.1 的机器要升级才拿到这个修复）；
②真机那 40 条已在 2026-10-08 13:07 被用户自己的 `~/Dev/dsh/cleanup-sessions.mjs`
连隔离区一起清掉，所以「本机验证删除」这条路径已无法复现——上表的 e2e 是隔离宿主。

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


### 2026-10-02 · 0.3.1：桌面应用被误拒（已修）

**症状**：桌面应用（`DeepSeek Harness 0.2.0-rc.2-arm64`，即 Electron 外壳，不是 `dsh web`）
里设置 → 已归档 永远显示"读不到宿主状态"；同一 URL 用普通浏览器打开一切正常。

**根因**：路由信任要求 `sec-fetch-site: same-origin` **且**自定义标头同时成立；桌面应用的请求经过它自己的
管线，可能既没有 Fetch Metadata 也没有自定义标头 → 403。而 403 当时**不留任何痕迹**，导致排查绕了两圈。

**改了什么（0.3.1）**：
1. 信任规则改为「回环 + 非跨站；信号一旦出现就权威且不可被标头推翻；两者都没有时才要标头」。
2. `/state` 带上最近 20 条 `refusals`（含 host/origin/site/marker），403 不再无声。
3. 客户端报错带上原因。
4. 旧路由前缀 `/api/dsh-archived-sessions/*` 与旧标头继续服务——改名不该让已打开的窗口变成错误页。

**教训**：这条插件的第一次"外网"失败，是我在没有证据时连着下了两个结论。留痕（refusals）比再猜一次便宜得多。


### 2026-10-02 深夜 · 桌面应用被误拒一事的收尾

重启桌面应用后，宿主加载到 **0.3.1**：`/state` 里出现 `refusals` 字段、旧的
`/api/dsh-archived-sessions/state` 返回 200，且**至今没有再记录到任何被拒请求**。
也就是说桌面应用那条路径已经走通，无需再放宽信任。

- 装机路径：`dsh plugin --profile desktop add dsh-archived@0.3.1`；
  **同路径的版本升级不会让宿主重新 import**——必须 `remove` + `add`（composition 变化）或重启应用，
  这一点在 `docs/decisions.md` 与下面的"下一步"里都值得记住。
- 归档集合与回收站此刻都是空的（用户自己清掉了先前那 3 个测试会话）；会话目录 21 个、投影缓存 37 份，store 完好。

