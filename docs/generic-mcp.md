# Generic FeedbackServer 2.0 MCP clients

FeedbackKit exposes a hosted Streamable HTTP MCP server:

```text
https://api.feedkit.cn/mcp
```

Do not configure a local command, runtime, API token, environment credential, or browser cookie. A
compatible client supports remote HTTP MCP, OAuth 2.1 authorization code with PKCE, and dynamic
client registration or client-ID metadata documents. The server publishes its OAuth discovery
metadata and challenges unauthenticated MCP requests.

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

## Sign in and verify

Call `whoami` first. If the client has not connected yet, the protected call opens the FeedbackKit
browser flow. Enter the account email, open the
one-time sign-in link delivered to that inbox, return to the authorization flow, and approve the
requested scopes. Keep the magic link and OAuth credentials out of the Agent conversation.

After the client reports a successful connection, call `whoami`. Verify the returned email and role,
then call `list_products`; do not treat the browser redirect alone as completed Product setup. An
invited user follows the same flow using only the invitation's `mcp_server` and `account_email`
values.

For a risky v2 tool, use native MCP elicitation when the client supports it. Otherwise the tool
returns `confirmation_required`; after the user approves the described effect, repeat that same
operation with unchanged arguments plus `confirm: true`. Confirmation identifiers are not part of
the 2.0 protocol.

A client that cannot complete the browser OAuth flow is not supported by this distribution.
