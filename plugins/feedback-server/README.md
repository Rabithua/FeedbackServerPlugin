# FeedbackKit remote plugin

This installable plugin contains only Skills and remote MCP metadata. Codex and Claude Code connect
to `https://api.feedkit.cn/mcp` over HTTP and use host-managed OAuth. There is no local executable,
Bun dependency, CLI, package install, or runtime JavaScript distribution.

Anonymous tools:

- `health`

All other anonymous interaction is limited to MCP protocol discovery. `authenticate` is
OAuth2-protected and declares an empty scopes list, so its first invocation lets the host establish
an OAuth connection that is not yet bound to a FeedbackKit account.

After OAuth, call either `authenticate({ method: "email", email })` or
`authenticate({ method: "invitation", code })`. Email returns `pending_verification`; the user opens
the one-time email link and the Agent observes completion through `authentication_status`. An
invitation code binds immediately. Only then call `connection_status` and continue Product and
notification onboarding.
