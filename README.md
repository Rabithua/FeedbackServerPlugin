# FeedbackServer Plugin

FeedbackServer Plugin is the public multi-agent distribution for administering a compatible
FeedbackServer instance. One audited TypeScript implementation provides a shared MCP server,
management Skill, and trusted-terminal account CLI for Codex and Claude Code. The repository
contains no FeedbackServer source, deployment configuration, database access, or credentials.

## Install for Codex

```bash
codex plugin marketplace add Rabithua/FeedbackServerPlugin --ref main
codex plugin add feedback-server@feedback-server
```

Start a new Codex task after installation. To update, run
`codex plugin marketplace upgrade feedback-server`, reinstall
`feedback-server@feedback-server`, and start another task.

## Install for Claude Code

```bash
claude plugin marketplace add Rabithua/FeedbackServerPlugin
claude plugin install feedback-server@feedback-server --scope user
```

Restart or reload Claude Code after installation. The plugin starts its MCP server from the cached
bundle through `${CLAUDE_PLUGIN_ROOT}` and exposes the same `manage-feedback-server` Skill.

Cursor and OpenCode can use the same standalone MCP bundle. See
[Generic MCP clients](docs/generic-mcp.md) for checked configuration templates.

## Configure an Agent account

The distributable CLI runs from the committed bundle and does not require `node_modules`:

```bash
git clone https://github.com/Rabithua/FeedbackServerPlugin.git
cd FeedbackServerPlugin
plugins/feedback-server/bin/feedback-server agent configure
```

The CLI hides passwords, invitation tokens, and PATs. On macOS it stores credentials under the
existing Keychain service `dev.rote.feedback-server.mcp`, so Codex and Claude Code reuse the same
account without copying or rotating its PAT. Non-macOS MCP processes must receive both
`FEEDBACK_SERVER_BASE_URL` and `FEEDBACK_SERVER_API_TOKEN` from a secure process environment.

Supported commands:

```text
feedback-server agent configure
feedback-server agent disconnect
feedback-server agent revoke-token --id <uuid>
feedback-server admin invite
feedback-server admin invitations
feedback-server admin invite revoke --id <uuid>
feedback-server admin accept-invite
feedback-server admin create-local
```

Existing checkout workflows such as `bun run agent:configure` and
`bun run admin:invite:revoke --id <uuid>` remain available as compatibility aliases.

## Invite administrators

Only an enabled `super_admin` may create or revoke invitations. Authentication-management routes
require a short-lived interactive session and are deliberately not exposed as MCP tools.

For a recipient-facing handoff, `admin invite` copies a complete Simplified Chinese handoff package
that includes the one-time invitation, a safe prompt the recipient can give to Codex or Claude Code,
and a link to [the onboarding guide](docs/invited-admin-onboarding.zh-Hans.md). The package tells
the recipient not to paste the invitation token into Agent chat; it belongs only in the hidden
terminal prompt.

`admin invite` creates a 7-day invitation by default, with `--expires-in-days` accepting 1–30. It
writes the handoff package to the macOS clipboard through stdin, reports only the invitation ID,
prefix, and expiry, and clears the package after the sharing handoff when unchanged. A clipboard or handoff
failure revokes the invitation before logout.

`admin accept-invite` refuses to consume an invitation when another Agent credential is configured.
It creates an ordinary administrator, verifies the account owns no Products, creates a 365-day PAT,
stores it atomically, and logs out every temporary session. If account creation committed but local
configuration failed, do not reuse the invitation: run `feedback-server agent configure` with the
new account. Any PAT whose compensating revocation also failed is recorded by non-secret ID in a
separate Keychain ledger and can be removed with the reported `agent revoke-token` command.

Each administrator owns an independent tenant. New administrators start with no Products and
cannot access another owner's Product.

## Security and development

Remote endpoints must use HTTPS. Plain HTTP is accepted only for exact loopback hosts
`localhost`, `127.0.0.1`, and `[::1]`. Secrets are never accepted as command arguments or written to
logs, bundles, repository files, or pending-revocation metadata.

```bash
bun install --cwd=plugins/feedback-server --frozen-lockfile
bun run check
bun run validate
bun run scan
claude plugin validate --strict .
```

Both `dist/server.mjs` and `dist/cli.mjs` are deterministic committed bundles. FeedbackServer
Plugin is licensed under the [MIT License](LICENSE).
