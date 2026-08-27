# Generic remote MCP clients

FeedbackKit is a hosted Streamable HTTP MCP server:

```text
https://api.feedkit.cn/mcp
```

Do not configure a local command, Bun runtime, PAT, API token, or environment credential. The client
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

After configuration, call `health`, then `connection_status`. The protected call should open the
client's OAuth linking UI. If the client cannot complete remote MCP OAuth, it is not supported by
this distribution; do not fall back to putting a PAT in a JSON file.
