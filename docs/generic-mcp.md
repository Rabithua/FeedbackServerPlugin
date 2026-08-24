# Generic MCP clients

The committed `plugins/feedback-server/dist/server.mjs` file is a standalone Bun stdio MCP server.
Replace `/ABSOLUTE/PATH/FeedbackServerPlugin` below with the absolute path of a trusted checkout.
Do not add a PAT to these JSON files.

## Cursor

Copy [`examples/cursor.mcp.json`](../examples/cursor.mcp.json) to the user-level or project-level
`mcp.json` supported by Cursor:

```json
{
  "mcpServers": {
    "feedback-server": {
      "command": "bun",
      "args": [
        "/ABSOLUTE/PATH/FeedbackServerPlugin/plugins/feedback-server/dist/server.mjs"
      ]
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
      "type": "local",
      "command": [
        "bun",
        "/ABSOLUTE/PATH/FeedbackServerPlugin/plugins/feedback-server/dist/server.mjs"
      ],
      "enabled": true
    }
  }
}
```

The server reads the active FeedbackKit profile from macOS Keychain, Windows Credential Manager, or
Linux Secret Service. Use `feedbackkit accept-invite` to create it; no plaintext credential file is
supported. A controlled headless runtime may instead inject the complete
`FEEDBACK_SERVER_BASE_URL`, `FEEDBACK_SERVER_ADMIN_ID`, `FEEDBACK_SERVER_ADMIN_EMAIL`,
`FEEDBACK_SERVER_API_TOKEN_ID`, `FEEDBACK_SERVER_API_TOKEN`, `FEEDBACK_SERVER_API_SCOPES`, and
`FEEDBACK_SERVER_API_TOKEN_EXPIRES_AT` set through its secret environment. Never commit those values.

## Check the transport

From the repository root, run:

```bash
bun --cwd=plugins/feedback-server run test
```

The tests initialize the stdio server, verify its 71-tool surface, and exercise request
routing. After client configuration, start a fresh client session and call `connection_status`
before making changes.
