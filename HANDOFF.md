# HANDOFF

> 三家接力（DSH / Codex / Claude Code）用这个文件：**开工先读，收工更新并提交。**
> 上游工作区约定见 `~/dev/_shared/CONVENTIONS.md`。

## 当前写者

- 工具：DSH（2026-10-02 0.2.0 重构）
- 分支：`feat/archived-0.2.0`
- 开始时间：2026-10-02 16:45

> 一个仓库同一时刻只允许一个写者；下一位开工时把上一行改成自己。

## 当前状态（2026-10-02）

**0.2.0 重构完成，尚未发版。** 面向 DSH **0.2.0-rc.2**。

- **关键发现**：0.2.0-rc.2 的 290 个 `@deepseek-ai` 包里**没有任何含 `archiv` 的包**——
  官方归档设置页 `dsh-client-ui-settings-unarchive-sessions` 已经不存在。原来的「同 id 遮蔽 + profile patch 里 `disabled: true`」
  两大前提全部失效；`settings.section` 的 `archived-sessions` id 在 0.2.0-rc.2 上是空的，本插件现在是它唯一占用者，
  **安装不再需要改 profile**。另：DSH 至今没有官方删除会话的接口（workspace controller 只有 workspace delete + session archive/unarchive），
  所以「彻底删除」仍是本插件不可替代的价值。
- **删除默认进回收站**（`$DSH_HOME/.archived-sessions-quarantine/`，30 天过期），`mode: "forever"` 才是不可逆。
  取舍见 `docs/decisions.md`。
- **行的事实源改成宿主 `GET /state`**，浏览器 `useSessions` 只做增强——修掉了「拿不到浏览器摘要就丢行」这个真实缺陷
  （索引残留因此在界面上根本不显示，用户无从清理）。
- 代码：宿主拆成 `lib/index.js` + `lib/host/{paths,metadata,quarantine,trust}.js`；客户端重写（929 行，含回收站/批量/分组/详情/打开文件夹）。
- 文案：导航行与页面标题 = **`Archived` / `已归档`**。
- 测试四套：`tools/host-smoke.mjs`（45 项，离线）、`tools/client-smoke.mjs`（33 项）、`tools/compat-check.mjs`（11 项，读 app.asar）、
  `tools/e2e.py`（真宿主）、`tools/browser-acceptance.py`（真浏览器）。
- `package.json` 升 `0.2.0`，加 `npm test`；peer 收敛到 `^0.2.0-rc.1`（放弃 0.1.x）。

## 下一步

- [ ] 发 `0.2.0` 到 npm，并在 web profile 实装跑一遍 `tools/e2e.py`。
- [ ] 更新 catalog 条目描述（现在只讲了「删除」，没讲回收站）——描述必须与代码一致，否则会被打回。
- [ ] 浏览器验收要在装了新版本的 profile 上跑一遍（本次没有真跑，见「未决问题」）。
- [ ] 官方 `ui-settings-unarchive-sessions` 的 `disabled: true` 只在 0.1.x 需要；若真要支持 0.1.x，得另做兼容层。

## 未决问题

- **真宿主 e2e 尚未跑**：需要一个装了插件的 `dsh web`。当前 GUI 跑的是 desktop profile（未装本插件），
  而直接在 `~/.dsh` 上起第二个宿主会和正在用的 GUI 抢状态。建议在隔离的 `DSH_HOME` 里跑。
- `storages/schedule.json` / `message_feedback.json` 里指向已删会话的悬空引用没处理（属宿主 domain store，
  要动得走 `ctx.storageDomain`；而且删会话是否该顺带删用户的定时任务，需要单独立项）。
- 旧聚合 `storages/session_projcache.json` 只探测不清理：它是宿主自有文件，实测已停止写入。
- 提交身份：仓库是 public，全局 `user.email` 是 iCloud 地址会被 GitHub 拒收，用
  `49531320+haotian-lu-prog@users.noreply.github.com`。
