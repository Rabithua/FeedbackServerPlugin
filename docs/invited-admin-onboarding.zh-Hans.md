# 把 FeedbackKit 交给 Agent 接入

1. 将完整的 FeedbackKit 邀请 Prompt 发给 Codex 或 Claude Code。
2. Agent 安装或升级可信来源 `Rabithua/FeedbackServerPlugin`。
3. Agent 在当前任务定位已安装 bundle，直接运行其中的 `feedbackkit accept-invite`。
4. 一次性令牌只通过 stdin 传入，不进入命令参数、Shell 历史或输出。
5. CLI 先检查系统安全凭据库，再创建已验证邮箱账号、启用 Free、保存 Agent 凭据，并通知服务端清除恢复密文。
6. Agent 重新询问 App 名称、Apple 平台、默认语言；仓库有多个 App 时还会询问目标。
7. 你确认 slug 后创建 Product。修改 Apple 工程前，Agent 会说明目标工程和文件并取得批准；之后接入 SDK、构建并运行 Doctor。

邀请默认 7 天有效且只能使用一次。同一 enrollment 可在 15 分钟内恢复网络中断后的凭据，其他 enrollment 不能重放邀请。如果本机已有账号，CLI 会在消费邀请前让你选择保留、添加命名 Profile 或替换。

FeedbackKit 账号没有用户名和密码。后续在 feedkit.cn 使用邮箱验证码或 Passkey 登录和恢复。Agent 凭据存入 macOS Keychain、Windows Credential Manager 或 Linux Secret Service，不提供明文文件回退。
