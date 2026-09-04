# 通过 Agent 接入 FeedbackKit 2.0

1. 把可信的 FeedbackKit 邀请说明交给 Agent。接入数据只有：

   ```text
   mcp_server: https://api.feedkit.cn/mcp
   account_email: person@example.com
   ```

2. Agent 从 `Rabithua/FeedbackServerPlugin` 安装或升级
   `feedback-server@feedback-server`，连接 `mcp_server`，并调用 `whoami` 以启动受保护访问。
3. OAuth 浏览器打开后，使用 `account_email` 登录。FeedbackKit 会向该邮箱发送一次性 Magic
   Link；请自行打开，不要把链接粘贴到 Agent 对话中。
4. 回到浏览器授权流程并批准所需权限。该邮箱对应的有效邀请会在首次登录时自动应用。
5. Agent 调用 `whoami` 核对返回的邮箱，再调用 `list_products`。
6. 如果还没有 Product，请提供 App 名称、平台、默认语言，以及明确的 Bark、Webhook 或
   延后配置通知选择。Agent 创建 Product；修改 App 工程前，还会先确定目标工程和文件并征得批准。

高风险工具优先使用 MCP 原生 elicitation。客户端不支持时，Agent 会展示准确影响、等待明确批准，
然后以完全相同的参数重新调用同一工具，只额外加入 `confirm: true`。
