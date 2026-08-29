# Generic remote MCP clients

FeedbackKit is a hosted Streamable HTTP MCP server:

```text
https://api.feedkit.cn/mcp
```

Do not configure a local command, Bun runtime, API token, or environment credential. The client
must support remote HTTP MCP plus OAuth authorization-code flow with PKCE and dynamic client
registration.

## Cursor

Start from [`examples/cursor.mcp.json`](../examples/cursor.mcp.json):

```json
{
  "mcpServers": {
    "feedback-server": {
      "url": "https://api.feedkit.cn/mcp"
    }
  }
}
```

## OpenCode

Start from [`examples/opencode.json`](../examples/opencode.json):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "feedback-server": {
      "type": "remote",
      "url": "https://api.feedkit.cn/mcp",
      "enabled": true
    }
  }
}
```

Anonymous access is limited to MCP discovery and `health`. To connect an account, invoke the
OAuth2-protected `authenticate` tool, whose declared scopes list is empty. The client completes
remote MCP OAuth first, leaving the connection unbound. Then call `authenticate` with exactly one
of these inputs:

```json
{ "method": "email", "value": "person@example.com" }
```

```json
{ "method": "invitation", "value": "the-code-from-the-invitation" }
```

Email authentication returns `pending_verification`; the user opens the one-time email link and the
Agent checks `authentication_status`. Invitation authentication binds immediately. Call
`connection_status` only after binding succeeds. A client that cannot complete remote MCP OAuth is
not supported by this distribution.
