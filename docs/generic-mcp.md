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

On macOS the server automatically reads the same `dev.rote.feedback-server.mcp` Keychain
credential used by Codex and Claude Code. On other platforms, inject both
`FEEDBACK_SERVER_BASE_URL` and `FEEDBACK_SERVER_API_TOKEN` through the client's secure environment
configuration. Never commit those values.

## Check the transport

From the repository root, run:

```bash
bun --cwd=plugins/feedback-server run test
```

The contract tests initialize the stdio server, verify its 54-tool surface, and exercise request
routing. After client configuration, start a fresh client session and call `connection_status`
before making changes.
