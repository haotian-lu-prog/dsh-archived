# 决策记录

## 2026-10-02 · 包从 `plugin/` 上移到仓库根目录

**背景**：要发布到 npm 并投稿 `awesome-dsh-plugin` catalog。

**选项**

1. 保持 `plugin/` 子目录，catalog 条目用 monorepo 形态：`url` 指到 `/tree/main/plugin`，`name` 写 `owner/repo#plugin`，文件名 `owner__repo--plugin.yml`。
2. 把包上移到仓库根目录，catalog 条目用普通形态：`url` = 仓库根，`name` = `owner/repo`。

**取舍**：方案 1 改动最小，但 npm 只从**包根**取 README/LICENSE，所以 `plugin/` 里得再放一份，同一份内容两处维护；方案 2 会动目录结构，但根 `README.md` / `LICENSE` 同时服务 GitHub 与 npm tarball，且与本账号的 `dsh-notifications` 布局一致。

**结论**：选方案 2。动手前核查过三件事——`tools/` 与 `.github/` 都不引用 `plugin/` 路径；插件当时没有装进任何 profile（不存在会断的 `link:` 软链）；仓库工作树干净。

## 2026-10-02 · 仓库由 private 改为 public

catalog 的 CI（`scripts/check-submission.mjs`）与 dsh-market 前端都以**匿名**身份读仓库来校验 `dsh.bundle`、抓 README / 截图，私库一律 404。发 npm 不需要公开仓库，但进目录必须公开。改公开前确认过仓库里没有密钥：`tools/rpc.py` 只在运行时读 `~/.dsh/.credentials.yaml`，没有任何内嵌凭据。
