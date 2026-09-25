# 发布流程

上线通过推送到 GitHub 的 `main` 分支触发自动构建和部署。

- 用户要求“上线”或“部署”时，完成必要验证、提交改动并执行 `git push`，然后检查自动部署结果。
- 除非用户明确要求手动部署，否则不要运行 `npm run deploy`、`wrangler deploy` 或通过 Cloudflare API 直接发布。
- 用户同时要求“上线并 push”时，push 就是发布步骤，不要先手动部署再 push。
