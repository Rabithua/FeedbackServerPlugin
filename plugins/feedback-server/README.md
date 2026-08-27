# FeedbackKit remote plugin

This installable plugin contains only Skills and remote MCP metadata. Codex and Claude Code connect
to `https://api.feedkit.cn/mcp` over HTTP and use host-managed OAuth. There is no local executable,
Bun dependency, CLI, keyring, Profile, package install, or runtime JavaScript distribution.

Anonymous tools:

- `health`
- `accept_invitation`

All other tools declare OAuth scopes and trigger host linking on first use. For invitation setup,
call `accept_invitation`, show the returned link and short code, then retry `connection_status`.
Invited users approve the recognized email without receiving another verification message.
