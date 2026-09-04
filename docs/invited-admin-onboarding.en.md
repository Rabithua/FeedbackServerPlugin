# Join FeedbackKit 2.0 with your Agent

1. Give the Agent the trusted FeedbackKit invitation instructions. The setup data contains only:

   ```text
   mcp_server: https://api.feedkit.cn/mcp
   account_email: person@example.com
   ```

2. The Agent installs or upgrades `feedback-server@feedback-server` from
   `Rabithua/FeedbackServerPlugin`, connects to `mcp_server`, and calls `whoami` to start protected
   access.
3. When the OAuth browser opens, sign in as `account_email`. FeedbackKit emails a one-time magic
   link to that inbox. Open the link yourself; never paste it into the Agent conversation.
4. Return to the browser flow and approve the requested access. The live invitation for the email is
   applied during first sign-in.
5. The Agent calls `whoami` and verifies the returned email, then calls `list_products`.
6. If no Product exists, provide the App name, platform, default locale, and an explicit Bark,
   webhook, or deferred notification choice. The Agent creates the Product and continues the SDK
   workflow only after resolving the target App project and obtaining approval for project edits.

Risky tools use native MCP elicitation when available. On clients without elicitation, the Agent
shows the exact effect, waits for approval, and repeats the same operation with the same arguments
plus `confirm: true`.
