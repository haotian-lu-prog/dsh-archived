# dsh-archived

给 DeepSeek Harness 的 **设置 → 已归档** 页补上删除：逐条删、勾选批量删、清空；
删除**默认先进回收站**（30 天内可恢复），并显示每行的磁盘占用。

DSH 至今没有官方「删除会话」的接口——归档只能取消归档，日志和投影缓存会一直留在磁盘上。
这个插件就是补上那一块。

## 它做了什么

DSH 0.2.0-rc.2 里，一个已归档会话牵涉四处状态，少清一处列表就会骗人：

| # | 状态 | 位置 |
|---|---|---|
| 1 | 会话日志目录 | `$DSH_HOME/sessions/<编码工作区>/session-<id>/`（`session.v4.jsonl.zstd` + `session.lock`） |
| 2 | 投影缓存文档 | `$DSH_HOME/storages/session_projcache/sessions/<id>.json` |
| 3 | 归档索引 | workspace registry 的 `archivedSessionIds` |
| 4 | 回收站（本插件自建） | `$DSH_HOME/.archived-sessions-quarantine/<id>/` |

删除有两条路径，界面上是**两个分开的按钮**：

- **删除**（默认）：把 1、2 移动进 4，再清 3。面板顶部常显「回收站：N 个 · X MB」，可以逐条恢复或整体清空；30 天后自动清除。
- **永久删除**：只出现在二次确认里，直接 unlink，不进回收站。

第 3 步走官方 `ctx.workspaceRegistry.unarchiveSession()`——它刻意不校验会话是否存在，正好能把「只剩索引」的残留一起清掉，
并借官方广播刷新所有已连接的客户端。

## 安全边界

- 只接受**已归档**的 id（`not-archived` 直接拒绝），不碰未归档会话；
- `agent.status === "running"` 的会话拒绝删除（正在生成的回合不能丢日志），空闲但打开的会话可删；
- 有**正在运行的 subagent 后代**时拒绝删除父会话（否则子会话的父会话会在它脚下消失）；
- **索引残留没有 payload 就不进回收站**：一个只有索引、磁盘上什么都没有的 id，清掉即可，不该在回收站里留一个永远恢复不了的条目；
- 路由仅限回环地址 + 同源 + 自定义标头：`Origin` 存在时必须与 Host 匹配；浏览器对同源 GET 不发 `Origin`，
  该情形由 `sec-fetch-site: same-origin` 兜底，两个信号都没有则拒绝；
- 宿主若失去 `workspaceRegistry.unarchiveSession`，破坏性路由**直接拒绝**（`no-registry`），不会「删了文件但留下索引」这种假成功。
- **陈旧清理只碰未归档会话**，且只碰「日志超过 N 天没写」或「从没写过用户消息」的；已归档的仍归上面的归档流程管；
- **24 小时硬保护**：日志在 24 小时内写过的一律不列、不删（与天数设置无关）；
- **正在跑、或有运行中子代理后代的会话直接拒绝**；
- 从工作区列表移除走官方 `Workspace.detachSession`；宿主没有这个动词时**拒绝删除**（`no-detach`），不会删了文件却留下悬挂行；
- **自动清理只进回收站**，永不永久删除；默认关闭，开启后每周最多跑一次。

### 删除后的残留清理

会话被归档时如果它的 agent 还开着（空闲未运行），DSH 的投影服务可能在删除后几秒把 `<id>.json` 缓存重新写回
（日志目录不会复活）。因此每次成功删除都会排三个定时清扫（+3s / +15s / +60s），再次清掉这类残留。
清扫只删缓存文档，且要求该会话既没回到归档集合、也没在跑、磁盘上也没有会话目录——目录回来了说明会话被恢复了，绝不碰。
定时器在插件卸载时统一取消。

## 界面

行的事实源是**宿主**（`GET /state`：归档集合 + 磁盘 + 投影缓存文档），浏览器的会话摘要只用来把标题和时间显示得更准。
这一点是有意的：索引里还留着、但浏览器没加载过的会话，**必须照样成行显示**，否则用户根本无从清理。

页面提供：搜索（标题 / 会话 ID / 工作区）、按工作区分组、逐行勾选与全选、每行展开详情
（占用空间、创建时间、缓存有无、父/子会话）、「打开文件夹」、行内二次确认、结果就地反馈，
以及顶部常显的回收站（恢复最近一个 / 清空）。

导航行与页面标题都是 **`Archived`（英文）/ `已归档`（中文）**。

页面顶部还有一节**「清理陈旧会话 / Clean up stale sessions」**：陈旧标准下拉（7 / 14 / 30 天）+「扫描」按钮；
候选行显示标题、原因（陈旧 / 空会话 / 两者）和「N 天未动 · 占用」，勾选后二次确认移入回收站；
底部是「每周自动清理」开关与上次运行结果。这一节只列**未归档**会话，扫描本身是只读的。

## 宿主路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/dsh-archived/state` | 归档行 + 磁盘占用 + 血缘 + 回收站 + 旧聚合探测 |
| POST | `/api/dsh-archived/delete` | `{ sessionId, mode: "quarantine" \| "forever" }` |
| POST | `/api/dsh-archived/delete-all` | `{ mode, ids? }`；`ids` 缺省表示清空全部 |
| POST | `/api/dsh-archived/restore` | `{ sessionId }` 从回收站恢复并重新归档 |
| POST | `/api/dsh-archived/empty-quarantine` | 彻底清空回收站 |
| POST | `/api/dsh-archived/reveal` | `{ sessionId }` 在系统文件管理器里打开该会话目录 |
| POST | `/api/dsh-archived/sweep/scan` | `{ days? }` 陈旧/空会话候选（只读，不写盘） |
| POST | `/api/dsh-archived/sweep/delete` | `{ ids, mode }` 逐个进回收站 + 官方 detach |
| POST | `/api/dsh-archived/sweep/settings` | `{ enabled?, days? }` 每周自动清理的开关与天数 |
| POST | `/api/dsh-archived/sweep/run` | 立刻跑一次每周清理（同一套保护） |

拒绝码：`invalid-session-id`、`not-archived`、`session-running`、`subagent-running`、`no-registry`、
`archived-session`、`too-recent`、`no-detach`、
`busy`、`not-quarantined`、`no-artifact`、`forbidden`、`internal`。

## 安装

```sh
# 装进 profile（包自带的 bundle patch 会把它挂上）
dsh plugin --profile web add dsh-archived

# 重启 dsh web，然后 设置 → 已归档
```

**不需要改 profile patch。** DSH 0.2.0-rc.2 已经没有官方的归档设置页，`settings.section` 的
`archived-sessions` id 是空的，本插件是它唯一的占用者。

### 从源码（开发用）

```sh
# 1) 让 profile 能解析到这个包（link: 指向本仓库根目录）
ln -s /path/to/repo ~/.dsh/profiles/web/node_modules/dsh-archived
#    ~/.dsh/profiles/web/package.json
#      "dependencies": { "dsh-archived": "link:/path/to/repo" }
#      "dsh": { "profile": { "bundles": [ ..., "dsh-archived" ] } }

# 2) 开发时热重载宿主代码（默认 root: [] 只监听 profile 清单与 patch 文件）
#    ~/.dsh/profiles/web/cordis.patch.yml
#      - id: hmr
#        config:
#          root:
#            - "/path/to/repo"
```

`dsh-hmr` 只监听 profile 清单与 patch 文件；改了 `lib/index.js` 想立即生效，需要把本仓库根目录加进 `hmr.config.root`。
客户端半边改动刷新浏览器即可。

## 兼容性

- 目标宿主：**DSH 0.2.0-rc.2**（`peerDependencies` 收敛到 `^0.2.0-rc.1`）。
- **不支持 0.1.x**：那时官方还有一个归档设置页，需要手动 `disabled: true`；0.2.0-rc.2 已经没有它了。
  代码里的 `priority: -1` 只是对「还带官方页的宿主」的防御。
- DSH 升级后**先跑契约检查**，它直接读本机 app.asar，逐条确认插件依赖的接口还在：
  `node tools/compat-check.mjs`。

## 测试

```sh
npm test                        # 宿主离线 + 客户端冒烟 + 宿主契约，都不需要 DSH
node tools/host-smoke.mjs       # 宿主半边：临时 $DSH_HOME + 假 ctx，跑完删除/恢复/回收站全流程
node tools/client-smoke.mjs     # 客户端半边：桩 React + 桩 fetch
node tools/compat-check.mjs     # 宿主契约（读 app.asar）
python3 tools/e2e.py            # 真宿主端到端；需要 dsh web 在跑且插件已加载
python3 tools/browser-acceptance.py   # 真浏览器；先起无头 Chrome --remote-debugging-port=9333
```

`tools/e2e.py` 会建临时会话 → 归档 → 删除（进回收站）→ 恢复 → 永久删除，并核对
「其他归档会话与磁盘上的其他会话数量都没变」。

`tools/browser-acceptance.py` 是纯标准库的 CDP 客户端（自己实现 WebSocket 握手与帧）：用本机密钥签出浏览器会话 cookie
注入无头 Chrome，打开 `设置 → 已归档`，断言导航里只有一个「已归档」入口，然后**真的点**删除 → 确认 → 恢复最近一个。

`tools/rpc.py` 是本地 RPC 小工具：用 `~/.dsh/.credentials.yaml` 里的浏览器会话密钥现场签 cookie，
从终端调用官方 RPC（`session/create`、`workspace/archiveSession` 等），测试因此不需要浏览器，也不会碰真实会话。

## 回滚

1. 从 `~/.dsh/profiles/web/package.json` 的 `bundles` 与 `dependencies` 里删掉 `dsh-archived`；
   或直接 `dsh plugin --profile web remove dsh-archived`；
2. 删掉 `~/.dsh/profiles/web/node_modules/dsh-archived` 软链（源码安装时）；
3. `~/.dsh/.archived-sessions-quarantine/` 里可能还有待恢复的会话——确认不需要后手动删除即可。

插件删掉的会话不会回来（`forever`），或者还躺在回收站里等 30 天过期（默认路径）。

## 故障排查

**`dsh plugin add` 报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`（`Lockfile failed supply-chain policy check`）。**

这不是本插件的问题：pnpm 11 默认给「24 小时内发布的版本」设了闸门，而 profile 的 `pnpm-workspace.yaml`
里 `minimumReleaseAgeExclude` 是**按「包名@版本」逐条累加**的——同一个包名出现两条时**只有其中一条生效**
（实测是列表里靠前的那条），于是新发布的那个版本永远过不了闸门。报错点名的包可能根本不是你要装的那个。

修法：让每个包名只留一条，把已接受的**确切版本**用 `||` 连起来：

```yaml
minimumReleaseAgeExclude:
  - dsh-notifications@1.0.0 || 2.0.0   # ✅ 一条顶两条
```

```yaml
minimumReleaseAgeExclude:
  - dsh-notifications@1.0.0            # ❌ 这两条同时存在时，
  - dsh-notifications@2.0.0            #    2.0.0 那条不生效
```

⚠️ **只接受确切版本**：写成 `dsh-notifications@*` 或 `@^2.0.0` 会被直接拒绝
（`ERR_PNPM_INVALID_MINIMUM_RELEASE_AGE_EXCLUDE: Use exact versions only.`）。

pnpm 每次成功安装后都会往这个列表追加一条「包名@版本」，所以升级几次之后又会出现同名两条——
发现同名时把它们合并成上面那种 `||` 形式即可。删掉重复行后重跑
`dsh plugin --profile <name> add <包名>` 就通了。

## 已知边界

- `$DSH_HOME/storages/schedule.json` 与 `message_feedback.json` 里可能残留指向已删会话的引用。
  它们是宿主自己的 domain store，外部改写会被内存状态覆盖，本插件**不动**它们（见 `docs/decisions.md`）。
- `$DSH_HOME/storages/session_projcache.json` 是 per-record 布局之前的旧聚合，实测早已停止写入
  （mtime 远早于 `session_projcache/sessions/`）。插件只探测并在详情里标注，不写入。
- 无头宿主没有文件管理器：设 `DSH_ARCHIVED_OPENER=none`，「打开文件夹」只回路径不启动程序。
