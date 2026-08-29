# 把 FeedbackKit 交给 Agent 接入

1. 将完整的 FeedbackKit 邀请 Prompt 发给 Codex 或 Claude Code。
2. Agent 安装或升级可信来源 `Rabithua/FeedbackServerPlugin`。
3. Agent 调用匿名 `accept_invitation`，只把 Prompt 中的邀请码用于这一次调用，不复述、不记录。
4. Agent 立即主动展示工具返回的十分钟连接码，并重试 `connection_status`，宿主只打开一次
   FeedbackKit OAuth。
5. 在 OAuth 页面粘贴十位连接码；配对成功后页面才显示受邀邮箱、订阅权益、客户端和申请权限。
   连接码不是第二次身份验证。
6. 核对载入的信息并点击“接受并连接”。邀请流程不需要输入邮箱，也不会再发送验证码邮件。
7. 宿主交换并保存 OAuth Token。Agent 确认连接后重新询问 App 信息，并要求明确选择 Bark、Product
   Webhook 或暂不配置；Agent 将该选择随 Product 一起保存，再在获批后继续 SDK 接入。

如果中途关闭或放弃，邀请码不会被消费；只有最终批准 OAuth 时才会消费。所有邀请浏览器都使用
短连接码，不依赖邀请 Cookie 自动绑定。

普通已有账号不使用邀请码：调用受保护工具，在浏览器 OAuth 页面切换到“邮箱验证码”，输入邮箱和
六位验证码，再确认授权。OAuth Token 只由宿主保存，不返回 Agent，也不进入网站存储。
