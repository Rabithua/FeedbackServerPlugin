# FeedbackServer Codex plugin

This package contains the `feedback-server` Codex plugin: a Bun stdio MCP server, the
`manage-feedback-server` Skill, trusted-terminal account commands, tests, and a committed standalone
bundle. It uses only FeedbackServer's documented `/v1/api` HTTPS surface.

The MCP tools manage Products, Feedback conversations, diagnostics, Activity posts, Roadmap items,
Releases, attachments, Bark delivery, App Store changelog imports, and audit records. Routine writes
execute directly; protected public, destructive, status, notification, and key-rotation operations
use exact single-use confirmations. Version 0.5.1 retains recoverable PAT cleanup metadata during
credential rotation and adds no authentication-management MCP tools.

Account and Agent credential workflows run only in a trusted terminal:

```bash
bun run configure
bun run disconnect
bun run admin:invite
bun run admin:invitations
bun run admin:invite:revoke --id <uuid>
bun run admin:accept-invite
bun run admin:create-local
```

Passwords and invitation tokens use hidden TTY input. Invitation creation uses the macOS clipboard;
PAT storage uses split macOS Keychain records with the token passed only through stdin. CI and
non-macOS MCP processes may use paired `FEEDBACK_SERVER_BASE_URL` and
`FEEDBACK_SERVER_API_TOKEN` environment values.

Development commands:

```bash
bun install --frozen-lockfile
bun run check
```

See the repository [README](../../README.md) for installation, upgrades, account onboarding,
ownership boundaries, and security behavior.
