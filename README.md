# dsh-archived-sessions-manager

给 DSH Web 的 **设置 → 已归档会话** 这一栏加上「彻底删除」和「清空全部」：把归档里的会话连同磁盘日志、投影缓存一起删干净，而不是只能取消归档。

## 它做了什么

一次彻底删除要清三处状态，缺一处列表就会骗人：

| # | 状态 | 位置 |
|---|---|---|
| 1 | 会话日志目录 | `$DSH_HOME/sessions/<编码工作区>/session-<id>` |
| 2 | 投影缓存 | `$DSH_HOME/storages/session_projcache/sessions/<id>.json` |
| 3 | 归档索引 | workspace registry 的 `archivedSessionIds` |

第 3 步走官方 `ctx.workspaceRegistry.unarchiveSession()`——它刻意不校验会话是否存在，正好能把"只剩索引"的残留一起清掉，并借官方广播刷新所有已连接的客户端。

安全边界：

- 只接受**已归档**的 id（`not-archived` 直接拒绝），不碰未归档会话；
- `agent.status === "running"` 的会话拒绝删除（正在生成的回合不能丢日志），空闲但打开的会话可删——与 session-manager 同一规则；
- 路由仅限回环地址 + 同源 + 自定义标头：`Origin` 存在时必须与 Host 匹配；浏览器对同源 GET 不发 `Origin`，该情形由 `sec-fetch-site: same-origin` 兜底，两个信号都没有则拒绝。

### 删除后的残留清理

会话被归档时如果它的 agent 还开着（空闲未运行），`session/create` 之外的进程状态仍在内存里，DSH 的投影服务可能在删除后几秒把 `<id>.json` 缓存重新写回（日志目录不会复活）。因此每次成功删除都会排三个定时清扫（+3s / +15s / +60s），再次清掉这类残留；清扫前会重新确认该会话既没有回到归档集合、也没有开始跑回合。定时器在插件卸载时统一取消。

## 界面

**接管**而不是新增一栏，但接管分两步——这是踩过的坑：

1. **渲染**由 slot 注册表决定：list 插槽按 `(id, priority)` 去重、**优先级最低者渲染**（"reusing a shipped id puts you in THAT cell and replaces it"）。本插件用 `priority: -1` 注册同一 id `archived-sessions`，页面内容归本插件。
2. **导航行**由设置外壳按"已注册条目"逐条生成，**不看去重结果**——所以官方那条即便渲染时被遮蔽，仍会多出一行「已归档会话」，设置里就出现两个同名入口。因此必须在 profile patch 里把官方条目 `disabled: true`：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: ui-settings-unarchive-sessions
  disabled: true
```

`priority: -1` 保留着，是为了万一官方条目被 DSH 升级重新启用时仍然抢得住渲染。验收脚本里有一条 `exactly one 已归档会话 nav row` 专门盯这个回归。

页面保留官方的搜索、行布局、取消归档与三种空态，新增：

- 每行「彻底删除」→ 行内二次确认（"删除后不可恢复" + 确认删除 / 取消）；
- 顶部「清空全部（N）」→ 二次确认后逐条删除，逐条跳过运行中的会话；
- 每行元信息附带磁盘占用（`日志 92 KB` / `仅索引残留`），来自 `GET /state`；
- 操作结果就地反馈（删了几个、释放多少、失败几个）。

## 宿主路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/dsh-archived-sessions/state` | 归档 id + 各自磁盘占用 |
| POST | `/api/dsh-archived-sessions/purge` | `{ sessionId }` 彻底删除一个 |
| POST | `/api/dsh-archived-sessions/purge-all` | 清空当前归档集合 |

## 安装（web profile）

```sh
# 1) 让 profile 能解析到这个包（link: 指向本仓库的 plugin/）
#    ~/.dsh/profiles/web/package.json
#      "dependencies": { "dsh-archived-sessions-manager": "link:/path/to/plugin" }
#      "dsh": { "profile": { "bundles": [ ..., "dsh-archived-sessions-manager" ] } }
ln -s /path/to/plugin ~/.dsh/profiles/web/node_modules/dsh-archived-sessions-manager

# 2) 关掉官方那一页（只靠 priority 遮蔽，导航里会留下两个同名入口）
#    ~/.dsh/profiles/web/cordis.patch.yml
#      - id: ui-settings-unarchive-sessions
#        disabled: true

# 3) 开发时热重载宿主代码（默认 root: [] 只监听 profile 清单与 patch 文件）
#    ~/.dsh/profiles/web/cordis.patch.yml
#      - id: hmr
#        config:
#          root:
#            - "/path/to/dsh-archived-sessions-manager"
```

`dsh-hmr` 只监听 profile 清单与 patch 文件；改了 `lib/index.js` 想立即生效，需要把本目录加进 `hmr.config.root`。客户端半边改动刷新浏览器即可。

## 测试

```sh
python3 tools/e2e.py             # 宿主：建临时会话 → 归档 → 走 HTTP 删除 → 校验三处状态（15 项）
                                 #   会话工作区默认取当前目录；可用 --workspace <目录> 或 DSH_E2E_WORKSPACE 指定
node tools/client-smoke.mjs      # 客户端：桩 React 加载 client.js，校验抢位注册与渲染（13 项）
python3 tools/browser-acceptance.py   # 真浏览器：无头 Chrome 里点完整流程（17 项，含导航行去重）
python3 tools/browser-acceptance.py --dump   # 只打印面板可见文本，便于排查
```

`tools/browser-acceptance.py` 是纯标准库的 CDP 客户端（自己实现 WebSocket 握手与帧）：用本机密钥签出浏览器会话 cookie 注入无头 Chrome，打开 `设置 → 已归档会话`，断言页面上确有「彻底删除 / 清空全部」、行上确有磁盘占用标注，然后**真的点**「彻底删除 → 确认删除」，最后回到宿主校验归档集合与磁盘。跑之前需要一个开着调试端口的 Chrome：

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-sandbox --disable-gpu --window-size=1680,1050 \
  --user-data-dir=/tmp/dsh-chrome-prof --remote-debugging-port=9333 about:blank &
```

`tools/e2e.py` 现在覆盖 15 项检查：完整删除链路、三种拒绝码语义、以及四种请求信任形态（无 Origin 的同源 GET、跨源 Origin、无信号、缺自定义标头）。

`tools/rpc.py` 是本地 RPC 小工具：用 `~/.dsh/.credentials.yaml` 里的浏览器会话密钥现场签 cookie，从终端调用官方 RPC（`session/create`、`workspace/archiveSession` 等），测试因此不需要浏览器，也不会碰真实会话。

## 回滚

1. 从 `~/.dsh/profiles/web/package.json` 的 `bundles` 与 `dependencies` 里删掉 `dsh-archived-sessions-manager`；
2. 删掉 `~/.dsh/profiles/web/node_modules/dsh-archived-sessions-manager` 软链；
3. `~/.dsh/profiles/web/cordis.patch.yml` 恢复为 `[]`——这一步同时会**重新启用官方归档页**（`ui-settings-unarchive-sessions`），导航与页面都回到出厂状态。

官方「已归档会话」页面随即回到原位；本插件删掉的会话不会回来（删除不可恢复）。
