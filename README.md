# FeedbackServer Codex

FeedbackServer Codex is the public Codex plugin and marketplace for administering a compatible
FeedbackServer instance. The plugin talks only to the documented HTTPS API; it contains no server
source, deployment configuration, database access, or administrator secrets.

## Install

The easiest setup keeps a local checkout so its trusted-terminal account commands are available:

```bash
git clone https://github.com/Rabithua/FeedbackServer-Codex.git
cd FeedbackServer-Codex
bun install --cwd=plugins/feedback-server --frozen-lockfile
codex plugin marketplace add .
codex plugin add feedback-server@feedback-server
```

Existing administrators configure a personal Agent connection with:

```bash
bun run agent:configure
```

Invited administrators instead run:

```bash
bun run admin:accept-invite
```

Both commands hide passwords and bearer secrets. Agent PATs are created with a 365-day lifetime,
stored in macOS Keychain, and never printed. Start a new Codex task after installation so the MCP
tools and management Skill are loaded.

For an install without a checkout, add the Git marketplace directly:

```bash
codex plugin marketplace add Rabithua/FeedbackServer-Codex --ref main
codex plugin add feedback-server@feedback-server
```

Trusted-terminal account commands still require a checkout. Update a Git marketplace with
`codex plugin marketplace upgrade feedback-server`, reinstall the plugin, and start a new task.

## Invite administrators

Only an enabled `super_admin` may create or revoke invitations. Authentication-management routes
require a short-lived interactive session and deliberately are not exposed as MCP tools.

```bash
bun run admin:invite                         # create a 7-day invitation
bun run admin:invite --expires-in-days 1    # choose 1–30 days
bun run admin:invitations                    # list status and non-secret prefixes
bun run admin:invite:revoke --id <uuid>     # revoke an unaccepted invitation
bun run admin:create-local                   # create and accept locally without exposing a token
```

`admin:invite` writes the one-time token to the macOS clipboard through stdin, never stdout,
arguments, or disk. Share it through a trusted channel and press Return to clear it if the
clipboard still contains the same token. If clipboard delivery fails, the command revokes the new
invitation. Every temporary administrator session is logged out.

`admin:accept-invite` requires macOS Keychain and refuses to consume an invitation while another
Agent credential is configured. It creates the account, verifies the account is an ordinary
administrator with no Products, creates a personal PAT, stores it atomically, and logs out temporary
sessions. A committed account whose Agent setup fails must use `agent:configure`; the invitation
must not be reused.

## Ownership and privacy

Each administrator owns an independent tenant. A new account starts with no Products, and neither
an ordinary administrator nor a `super_admin` can access another owner's Products. The plugin does
not provide Product sharing or ownership transfer.

The MCP process reads macOS Keychain by default. CI and non-macOS environments may provide both
`FEEDBACK_SERVER_BASE_URL` and `FEEDBACK_SERVER_API_TOKEN` through a secure process environment.
Never commit either value or send a PAT, password, or invitation token through a Codex chat.

## Development

```bash
bun install --cwd=plugins/feedback-server --frozen-lockfile
bun run check
bun run validate
```

The committed `plugins/feedback-server/dist/server.mjs` bundle is deterministic and must match the
TypeScript source. FeedbackServer Codex is licensed under the [MIT License](LICENSE).
