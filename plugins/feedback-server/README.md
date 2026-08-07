# FeedbackServer agent plugin

This directory is the single `feedback-server` plugin source for Codex and Claude Code. It contains
the shared MCP server, `manage-feedback-server` Skill, Keychain-backed CLI, tests, and deterministic
standalone bundles. It uses only FeedbackServer's documented `/v1/api` HTTPS surface.

Platform-specific metadata is isolated under `.codex-plugin/`, `.claude-plugin/`, the inline Codex
MCP declaration, and `.mcp.claude.json`. Both platforms load the same `skills/`, `dist/server.mjs`,
and Keychain credential. `bin/feedback-server` loads `dist/cli.mjs`, so account workflows run from a
cached or cloned distribution without installing source dependencies.

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

New account passwords, refresh tokens, and PATs use hidden TTY input or stdin-only Keychain writes.
Invitation creation reads the super administrator password only from macOS Keychain service
`dev.rote.feedback-server.admin` with account `<username>`, prints a recipient handoff package to
stdout by default, and never opens Terminal or prompts for that password. The package contains the
time-limited one-time token and an Agent-ready task prompt that the recipient can paste directly
into Codex or Claude Code. The Agent installs and prepares a command rooted at the checkout's real
absolute path; the recipient runs `accept-invite` in a visible interactive terminal so hidden
password input never passes through chat or a private Agent PTY. The older macOS clipboard handoff
remains available with `--delivery clipboard`. PAT storage uses split macOS Keychain records with
the token passed only through stdin. A separate Keychain ledger stores only server URL, username,
and token ID for recoverable PAT revocation. CI and non-macOS MCP processes may use paired
`FEEDBACK_SERVER_BASE_URL` and `FEEDBACK_SERVER_API_TOKEN` environment values.

Development commands:

```bash
bun install --frozen-lockfile
bun run check
```

See the repository [README](../../README.md) for installation, upgrades, onboarding, ownership, and
security behavior.
