# 把 FeedbackKit 交给 Agent 接入

1. 将完整的 FeedbackKit 邀请 Prompt 发给 Codex 或 Claude Code。
2. Agent 安装或升级可信来源 `Rabithua/FeedbackServerPlugin`。
3. Agent 调用由 OAuth2 保护的 `authenticate`；该工具声明空 scopes，宿主先建立 OAuth 连接，
   不授予 FeedbackKit 账号访问权。
4. OAuth 完成时连接仍未绑定账号。Agent 调用
   `authenticate({ method: "invitation", code })`，只把邀请短码作为工具输入。
5. 邀请短码立即绑定连接，不需要在浏览器中另行输入，也没有邮箱验证步骤。
6. Agent 调用 `connection_status`，重新询问 App 信息，并要求明确选择 Bark、Product
   Webhook 或暂不配置；Agent 将该选择随 Product 一起保存，再在获批后继续 SDK 接入。

邮箱认证时，宿主完成 OAuth 后，Agent 改为调用
`authenticate({ method: "email", email })`，结果为 `pending_verification`。用户点击邮件中的
一次性链接，不把链接复制回对话；Agent 通过 `authentication_status` 观察完成，然后才调用
`connection_status`。OAuth Token 只由宿主保存，不返回 Agent。
