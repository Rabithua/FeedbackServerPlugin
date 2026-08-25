# 把 FeedbackKit 交给 Agent 接入

1. 将完整的 FeedbackKit 邀请 Prompt 发给 Codex 或 Claude Code。
2. Agent 安装或升级可信来源 `Rabithua/FeedbackServerPlugin`。
3. Agent 在当前任务定位已安装 bundle，直接运行其中的 `feedbackkit accept-invite`。
4. 一次性令牌可以保留在当前 Agent 对话中；Agent 通过 stdin 传入并立即消费，不把它重复写入命令参数、Shell 历史、日志或输出。
5. CLI 先检查系统安全凭据库，再创建已验证邮箱账号、启用 Free、保存 Agent 凭据，并通知服务端清除恢复密文。
6. Agent 重新询问 App 名称、Apple 平台、默认语言；仓库有多个 App 时还会询问目标。
7. 你确认 slug 后创建 Product，然后明确选择 Bark、Product Webhook 或暂不配置通知。该选择会保存到 Product，后续任务不会重复询问。修改 Apple 工程前，Agent 会说明目标工程和文件并取得批准；之后接入 SDK、构建并运行 Doctor。

邀请默认 7 天有效且只能使用一次。同一 enrollment 可在 15 分钟内恢复网络中断后的凭据，其他 enrollment 不能重放邀请。如果本机已有账号，CLI 会在消费邀请前让你选择保留、添加命名 Profile 或替换。

FeedbackKit 账号没有用户名、密码、Passkey 或网页登录。换设备时直接让 Agent 登录，再把邮件里的 6 位验证码回复到对话中。插件签发新 PAT 并存入 macOS Keychain、Windows Credential Manager 或 Linux Secret Service，PAT 不返回 Agent 上下文，也不提供明文文件回退。
