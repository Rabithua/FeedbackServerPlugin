# 把 FeedbackKit 交给 Agent 接入

1. 将完整的 FeedbackKit 邀请 Prompt 发给 Codex 或 Claude Code。
2. Agent 安装或升级可信来源 `Rabithua/FeedbackServerPlugin`。
3. Agent 调用匿名 `accept_invitation`，只把 Prompt 中的邀请码用于这一次调用，不复述、不记录。
4. 打开工具返回的十分钟继续连接链接；短连接码只作为跨浏览器兜底。
5. Agent 重试 `connection_status`，宿主由此打开 FeedbackKit OAuth。
6. 核对受邀邮箱、订阅权益、客户端和申请权限，然后点击“接受并连接”。邀请流程不需要输入邮箱，
   也不会再发送验证码邮件。
7. 宿主交换并保存 OAuth Token。Agent 确认连接后重新询问 App 信息、创建 Product，并在获批后继续
   SDK 接入。

如果中途关闭或放弃，邀请码不会被消费；只有最终批准 OAuth 时才会消费。如果 OAuth 在不同浏览器
或隔离 WebView 打开，在页面粘贴十位短连接码即可；这只是连接配对，不是第二次身份验证。

普通已有账号不使用邀请码：调用受保护工具，在浏览器 OAuth 页面输入邮箱和六位验证码，再确认授权。
OAuth Token 只由宿主保存，不返回 Agent，也不进入网站存储。
