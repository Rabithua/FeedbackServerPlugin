# FeedbackKit remote plugin 2.0

This bundle contains only FeedbackServer 2.0 Skills and remote MCP metadata. Codex and Claude Code
connect to `https://api.feedkit.cn/mcp` over Streamable HTTP. There is no local executable, package
install, credential file, Bun dependency, or bundled runtime.

The host completes Better Auth OAuth 2.1 in the browser. The user enters their account email, opens
the magic link delivered to that inbox, and approves access. The Agent never handles the link or
OAuth token. After the host reconnects, call `whoami`, verify the email, then use `list_products` and
the v2 Product tools.

Invitation setup consumes only `mcp_server` and `account_email`: connect to the former and sign in as
the latter in the browser. First sign-in applies the live invitation for that email.

Risky tools prefer native MCP elicitation. Without elicitation, describe the exact effect, obtain
explicit approval, and repeat the same operation with unchanged arguments plus `confirm: true`.
Never use a confirmation identifier. Explicit Feedback status/visibility changes and specified
Feedback replies are ordinary direct writes and do not need a duplicate chat approval.
