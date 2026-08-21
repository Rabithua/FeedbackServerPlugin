# FeedbackServer agent plugin

This directory is the single `feedback-server` plugin source for Codex and Claude Code. It contains
the shared MCP server, `manage-feedback-server` Skill, Keychain-backed CLI, tests, and deterministic
standalone bundles. It uses only FeedbackServer's documented `/v1/api` HTTPS surface.

Platform-specific metadata is isolated under `.codex-plugin/`, `.claude-plugin/`, the inline Codex
MCP declaration, and `.mcp.claude.json`. Both platforms load the same `skills/`, `dist/server.mjs`,
and Keychain credential. `bin/feedback-server` loads `dist/cli.mjs`, so account workflows run from a
cached or cloned distribution without installing source dependencies.

```text
feedback-server doctor
feedback-server test roundtrip --product <id-or-slug> --confirm <product-slug>
feedback-server agent configure
feedback-server agent disconnect
feedback-server agent revoke-token --id <uuid>
feedback-server admin invite
feedback-server admin invitations
feedback-server admin invite revoke --id <uuid>
feedback-server admin accept-invite
feedback-server admin create-local
```

`doctor` is a read-only account, server, subscription, Product, and optional host-App preflight. It
reports effective plan and lifecycle, Apps and storage usage, read-only Products, and near-limit
warnings. Passing `--app-path` checks FeedbackKit 0.1.29 or newer, warns when a newer stable GitHub
Release is available, and checks the endpoint and Product binding, language policy, and dedicated
visitor Keychain service without printing credentials or the Product key. The MCP surface can read
this server-computed subscription state and switch the primary Product through a protected risk
preview, but cannot grant, renew, or downgrade a subscription.
`test roundtrip` is an explicit live acceptance test: it requires the selected Product slug to be
repeated with `--confirm`, covers submit/receive/reply/unread/read, and deletes the unique test
Visitor and its Feedback afterward, including on intermediate failure.

New account passwords, refresh tokens, and PATs use hidden TTY input or stdin-only Keychain writes.
Invitation creation reads the super administrator password only from macOS Keychain service
`dev.rote.feedback-server.admin` with account `<server-origin>|<username>`, prints a recipient handoff package to
stdout by default, and never opens Terminal or prompts for that password. The package contains the
time-limited one-time token and an Agent-ready task prompt that the recipient can paste directly
into Codex or Claude Code. In Codex, the Agent lists marketplaces and plugins first, upgrades an
existing marketplace or adds it when absent, and installs the plugin only when missing. It then
prepares a command rooted at the checkout's real absolute path; the recipient runs `accept-invite`
in a visible interactive terminal so hidden password input never passes through chat or a private
Agent PTY. The older macOS clipboard handoff
remains available with `--delivery clipboard`. PAT storage uses split macOS Keychain records with
the token passed only through stdin. A separate Keychain ledger stores only server URL, username,
and token ID for recoverable PAT revocation. CI and non-macOS MCP processes may use paired
`FEEDBACK_SERVER_BASE_URL` and `FEEDBACK_SERVER_API_TOKEN` environment values.
The canonical default endpoint is `https://api.feedkit.cn/v1/api`; credentials saved with the former
production hostname are normalized to this endpoint while preserving the existing PAT.
Legacy username-only administrator-password items are read only as migration candidates. The
plugin moves one to the server-scoped account only after that password authenticates successfully
against the selected server, preventing cross-server credential reuse.

Once per MCP process, the plugin checks the latest stable FeedbackServer Plugin GitHub Release.
When an update exists, one successful tool result includes an `updateNotice` containing the current
and latest versions, release URL, and manual upgrade command. The check is advisory, never upgrades
the plugin automatically, and fails silently when GitHub is unavailable.

If Agent credentials already exist, `accept-invite` shows their non-secret username and service URL
and asks whether to keep or switch accounts. Keeping is the default and stops without consuming the
invitation. Only an explicit `switch` proceeds after warning that it revokes the current PAT and
removes local credentials. Those Keychain credentials are shared by every FeedbackServer-enabled
Codex and Claude session on the Mac, so switching is not project-local. Current and new passwords
remain hidden terminal input. If invitation acceptance then fails, the CLI automatically attempts
to restore the previous account.

Development commands:

```bash
bun install --frozen-lockfile
bun run check
```

See the repository [README](../../README.md) for installation, upgrades, onboarding, ownership, and
security behavior.
