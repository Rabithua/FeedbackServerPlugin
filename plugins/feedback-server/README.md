# FeedbackKit remote plugin

This installable plugin contains only Skills and remote MCP metadata. Codex and Claude Code connect
to `https://api.feedkit.cn/mcp` over HTTP and use host-managed OAuth. There is no local executable,
Bun dependency, CLI, keyring, Profile, package install, or runtime JavaScript distribution.

Anonymous tools:

- `health`
- `accept_invitation`

All other tools declare OAuth scopes and trigger host linking on first use. For invitation setup,
call `accept_invitation`, retain the returned short code, then immediately retry `connection_status`.
Show the short code to the user before the retry. The host opens OAuth once, and the page always
requires that code before it reveals the invited identity. After approval, continue the onboarding
actions returned by `connection_status`, including the explicit notification choice.
