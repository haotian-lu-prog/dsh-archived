# HANDOFF

> 三家接力（DSH / Codex / Claude Code）用这个文件：**开工先读，收工更新并提交。**
> 上游工作区约定见 `~/dev/_shared/CONVENTIONS.md`。

## 当前写者

- 工具：DSH（2026-10-02 上架 npm + 投稿 dsh market）
- 分支：main
- 开始时间：2026-10-02 15:55

> 一个仓库同一时刻只允许一个写者；下一位开工时把上一行改成自己。

## 当前状态（2026-10-02）

- **包已从 `plugin/` 上移到仓库根目录**：根 `package.json` 同时是 npm 清单与仓库清单，`README.md` / `LICENSE` 一处维护、GitHub 与 npm tarball 两处可见。取舍见 `docs/decisions.md`；合并于 PR #2（squash `2103398`）。
- **已发布 npm**：`dsh-archived-sessions-manager@0.1.0`（MIT，public）
  安装：`dsh plugin --profile web add dsh-archived-sessions-manager`
  功能与布局改动前一致，只动了清单与目录，`lib/` 两个文件未改一行。
- **已投稿 catalog**：[awesome-dsh-plugin#6375](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6375) —— 一个数据文件 `data/plugins/haotian-lu-prog__dsh-archived-sessions-manager.yml`，分类 `session`。目录 README 由脚本从 `data/plugins/*.yml` 生成，**不要手工编辑**。
- **仓库已改为 public**（catalog CI 与市场前端都匿名读仓库），topics：`dsh-plugin` / `deepseek-harness` / `dsh` / `cordis` / `sessions`。
- `package.json` 变更：去掉 `private`；补 `repository` / `homepage` / `bugs` / `keywords` / `author` / `publishConfig`；官方 `@deepseek-ai/*` 全部改为 **optional peerDependencies**（`^0.2.0-rc.1`，cordis `^4.0.4`），host 已有的包不会被 pnpm 再装一份。
- 三套测试未改动，且都不引用包路径（`tools/` 里 grep 不到 `plugin/`），因此布局调整不影响它们。

## 下一步

- [ ] 市场录入后核对详情页：npm 版本、安装命令（`dsh plugin --profile web add dsh-archived-sessions-manager`）、分类与描述是否与实际一致。
- [ ] 官方 `ui-settings-unarchive-sessions` 的 `disabled: true` 仍需用户在 profile patch 里自己加一行（否则导航里两个同名入口）。**未验证**能否放进本包自带的 bundle patch——bundles 层跨包 id 定位不确定；若能验证可行，安装就能压成一步。
- [ ] 浏览器验收依赖手动起 Chrome 调试端口；若以后想上 CI，只把前两套（无需浏览器）放进 workflow。
- [ ] 发版：改根 `package.json` 的 `version` → `npm publish` → catalog 的 `version` 由上游 CI 自动刷新。

## 未决问题

- 官方 DSH 若自行加上「彻底删除」，本插件是否退役、还是继续接管？（接管逻辑依赖 `priority: -1` + `disabled: true` 两步，官方改动会影响它）
- **提交身份**：仓库已 public，而全局 `user.email` 是 iCloud 地址，GitHub 的 email privacy 会直接拒收推送。本仓库的提交用 `49531320+haotian-lu-prog@users.noreply.github.com`（`git -c user.email=... commit`），或改用 SSH remote。
