# AGENTS.md — dsh-archived-sessions-manager

给 DSH Web 的「设置 → 已归档会话」加上「彻底删除」与「清空全部」：连同磁盘日志、投影缓存、归档索引一起删干净。
工作区总则见 `~/dev/_shared/CONVENTIONS.md`；本文件只写**本项目特有**的东西。

## 结构

- `plugin/lib/index.js` — 宿主半边：三条路由（`/state`、`/purge`、`/purge-all`）、三处状态清理、删除后的延迟清扫
- `plugin/lib/client.js` — 客户端半边：接管 `archived-sessions` 列表插槽、行内二次确认、「清空全部」
- `plugin/cordis.patch.yml` — profile patch，用来 `disabled: true` 关掉官方 `ui-settings-unarchive-sessions`
- `tools/e2e.py` — 宿主端到端（15 项）：建临时会话 → 归档 → 走 HTTP 删除 → 校验三处状态
- `tools/client-smoke.mjs` — 客户端冒烟（13 项）：桩 React 加载 `client.js`
- `tools/browser-acceptance.py` — 真浏览器验收（17 项，纯标准库 CDP：自己实现 WebSocket 握手与帧）
- `tools/rpc.py` — 本地 RPC 助手：用 `~/.dsh/.credentials.yaml` 里的会话密钥现场签 cookie

## 命令

```sh
python3 tools/e2e.py                    # 宿主端到端；需要本机 DSH 在跑
python3 tools/e2e.py --workspace ~/dev   # 指定会话工作区（默认当前目录；也可用 DSH_E2E_WORKSPACE）
node tools/client-smoke.mjs             # 客户端冒烟
python3 tools/browser-acceptance.py     # 真浏览器；先起无头 Chrome --remote-debugging-port=9333
python3 tools/browser-acceptance.py --dump   # 只打印面板文本，便于排查
```

AI 代理改完代码至少跑前两套；动了渲染/接管逻辑要跑第三套。

## 硬约束（改代码前先读）

- 一次「彻底删除」必须清**三处**：会话日志目录（`$DSH_HOME/sessions/<编码工作区>/session-<id>`）、投影缓存（`$DSH_HOME/storages/session_projcache/sessions/<id>.json`）、归档索引（workspace registry 的 `archivedSessionIds`）。少清一处，列表就会骗人。
- 只接受**已归档**的 id；`agent.status === "running"` 的会话必须拒绝（正在生成的回合不能丢日志）。拒绝码语义以 `tools/e2e.py` 的断言为准。
- 删除成功后要排 +3s / +15s / +60s 三次清扫：会话归档时若 agent 还开着，投影服务可能在删除后把缓存写回；清扫前要重新确认该会话没回到归档集合、也没开始跑回合。
- 路由信任：仅回环 + 同源。`Origin` 存在时必须与 Host 匹配；浏览器同源 GET 不带 `Origin`，该情形由 `sec-fetch-site: same-origin` 兜底；两个信号都没有则拒绝。还要校验自定义标头 `x-dsh-archived-sessions`。
- 接管官方页面是**两步**，缺一不可：渲染靠 slot 用同一 id `archived-sessions` + `priority: -1`（list 插槽按 `(id, priority)` 去重、**优先级最低者渲染**）；导航行由设置外壳按「已注册条目」生成、不看去重结果，所以必须在 patch 里把官方条目 `disabled: true`。验收脚本有一条断言专门盯「导航里只有一个同名入口」这个回归。

## 约定

- 开工先读 `HANDOFF.md`，收工更新它（当前状态 / 下一步 / 未决问题）并提交。
- 不提交 `tools/__pycache__/`（已在 `.gitignore`）。
- 这个仓库是私有插件（`plugin/package.json` 里 `"private": true`），安装方式是 `link:` 软链 + profile patch，改动不需要发版。
