# FeedbackServer Plugin

FeedbackServer Plugin is the public multi-agent distribution for administering a compatible
FeedbackServer instance. One audited TypeScript implementation provides a shared MCP server,
six focused Skills plus a compatibility router, and a Keychain-backed account CLI for Codex and Claude Code. The repository
contains no FeedbackServer source, deployment configuration, database access, or credentials.

## Install for Codex

```bash
codex plugin marketplace add Rabithua/FeedbackServerPlugin --ref main
codex plugin add feedback-server@feedback-server
```

Start a new Codex task after the first installation so the MCP server is loaded. To update, run
`codex plugin marketplace upgrade feedback-server` and start another task; do not reinstall an
already installed plugin.
Beginning with version 0.6.8, the MCP server checks the repository's latest stable GitHub Release
once per process. When a newer plugin exists, the first successful tool result after the check
includes an `updateNotice` with the release URL and upgrade command; update checks never modify the
installation and network failures do not affect FeedbackServer operations.

After account connection, continue the current Agent task and send `帮我完成 FeedbackServer 初始配置` (or
choose the plugin's first starter prompt). The Agent reads live setup state, selects or creates a
Product, detects a local iOS App when present, offers Bark/Webhook/defer notification choices,
recommends an optional roundtrip, and only then introduces Diagnostics and App Store binding.
Onboarding does not store completion or skip flags. Once per MCP process, the first successful tool
result may include a non-blocking `setupNotice` when a required action, missing read permission, or
missing effective notification channel remains; it can appear alongside `updateNotice`.

## Install for Claude Code

```bash
claude plugin marketplace add Rabithua/FeedbackServerPlugin
claude plugin install feedback-server@feedback-server --scope user
```

Restart or reload Claude Code after installation. The plugin starts its MCP server from the cached
bundle through `${CLAUDE_PLUGIN_ROOT}` and exposes the same setup, triage, waitlist, publishing,
notification, and administration Skills as Codex.

Cursor and OpenCode can use the same standalone MCP bundle. See
[Generic MCP clients](docs/generic-mcp.md) for checked configuration templates.

## Configure an Agent account

The installed plugin includes a distributable CLI and does not require a repository clone or
`node_modules`. In a loaded Codex or Claude Code task, ask the Agent to configure the account. It
calls the credential-free `prepare_local_setup` tool and shows the exact command for the current
cached bundle. Run that command in a visible, user-controlled terminal.

The CLI hides new account passwords and PATs. Time-limited invitation tokens can be printed in
onboarding handoffs and passed to `accept-invite --token` for Agent-assisted setup. An Agent may
inspect the configured marketplaces and plugins, update an existing installation or add it when
absent, install the plugin only when missing, and prepare the exact installed-bundle command. The recipient must run that
command in a visible, user-controlled interactive terminal so the password remains inside the
CLI's hidden prompt. On macOS the CLI
stores credentials under the existing Keychain service `dev.rote.feedback-server.mcp`, so Codex and
Claude Code reuse global named profiles without copying or rotating PATs. Profile IDs use 1–40
lowercase letters, numbers, dots, underscores, or hyphens. Switching the active profile affects
every local FeedbackServer Codex and Claude session; profiles are never repository-local. The old
`default` pointer migrates on first read without rotating its PAT and can resume after interruption.
Paired environment variables override Keychain, in which case `connection_status` reports
`credentialSource: "environment"` and `activeProfile: null`. Non-macOS MCP processes
must receive both
`FEEDBACK_SERVER_BASE_URL` and `FEEDBACK_SERVER_API_TOKEN` from a secure process environment.
The default service URL is `https://api.feedkit.cn/v1/api`. Existing credentials that reference the
former `feedbackserver.rote.ink` endpoint are routed to the canonical URL without replacing the PAT.

Supported commands:

```text
feedback-server doctor
feedback-server test roundtrip --product <id-or-slug> --confirm <product-slug>
feedback-server agent configure [--profile <name>]
feedback-server agent disconnect [--profile <name>]
feedback-server agent revoke-token --id <uuid>
feedback-server profile list
feedback-server profile use <name>
feedback-server profile remove <name>
feedback-server admin invite --plan free
feedback-server admin invite --plan solo --subscription-term month
feedback-server admin invite --plan studio --subscription-term year
feedback-server admin invite --plan studio --subscription-term perpetual
feedback-server admin invitations
feedback-server admin invite revoke --id <uuid>
feedback-server admin accept-invite
feedback-server admin create-local --plan free
feedback-server admin email bind
feedback-server admin password-reset
```

## Verify an integration

Run the read-only preflight after account setup, and optionally point it at an iOS host App:

```bash
plugins/feedback-server/bin/feedback-server doctor --product danci-ios
plugins/feedback-server/bin/feedback-server doctor \
  --product danci-ios \
  --app-path /absolute/path/to/App
```

`doctor` reports the plugin version, Keychain or environment credential state, PAT scopes and
expiry, pending token cleanup, live server health, effective subscription and lifecycle, Apps and
storage usage, read-only Products, Product selection, Product status, and an ordered `Next actions`
section derived from the same live onboarding state as `get_onboarding_status`. JSON output adds
backward-compatible `onboarding` and `nextActions` fields. With
`--app-path`, it also checks FeedbackKit's resolved version (minimum 0.1.29), compares it with the
latest stable FeedbackKit GitHub Release, and checks the server URL, Product binding, visitor
Keychain service, and language policy. FeedbackKit 0.2 or newer is checked against its fixed
production endpoint, bundle-derived visitor Keychain service, and follow-host language defaults;
older integrations retain the explicit checks. A newer compatible
SDK is a warning rather than a blocking failure. Output never includes a PAT or publishable Product
key. Use `--format json` for automation.

The MCP surface exposes `get_onboarding_status`, the server-computed subscription overview, and a protected primary Product
switch with risk preview and mutation preconditions. It does not expose subscription grants,
renewals, or downgrades. The Keychain-backed super-administrator CLI is the sole exception: it can
attach an immutable initial Free, Solo, or Studio grant to a new-account invitation.

Protected previews return `executeTool: "execute_confirmation"`. After explicit user approval,
call `execute_confirmation` with the single-use ID; pending payloads and handlers stay in memory,
expire after ten minutes, and are bound to the account, endpoint, active profile, and write
precondition. Repeating the original tool with unchanged arguments and `confirmationId` remains
compatible through 1.0. API errors keep the legacy text fields while structured output adds status,
code, message, request ID, Retry-After seconds, remediation, and redacted data.

Plugin 0.7.0 adds owner-scoped FeedbackKit waitlist tools for stable listing/search, detail with
internal notes, preconditioned lifecycle updates, note append, and explicitly confirmed permanent
deletion. Waitlist entries are independent from Products and do not consume subscription capacity.

Plugin 0.10.0 adds typed waiting-list invitation email. The Agent previews the private recipient,
language, App, Free/Solo/Studio grant, expiry, and message summary, then requires explicit approval
before it sends or retries. It can also revoke a pending invitation. The connected PAT needs
`waitlist:invite`, and its administrator must still be a current `super_admin` in the Server
database.

Account email binding/change and password recovery remain outside MCP. Run `feedback-server admin
email bind` or `feedback-server admin password-reset` in a visible terminal so the current password,
verification code, and new password never enter Agent context. Login accepts username or verified
email. Password reset intentionally leaves existing sessions, PATs, and Passkeys valid.

For a live acceptance test, explicitly select a Product and repeat its slug:

```bash
plugins/feedback-server/bin/feedback-server test roundtrip \
  --product danci-ios \
  --confirm danci-ios
```

The command uses a unique random Visitor to bootstrap, submit a harmless Feedback item, confirm it
appears in the administrator list, reply, verify the client's unread event and reply detail,
acknowledge the inbox, and verify the unread count returns to zero. It then deletes that Visitor and
verifies the Feedback was cascaded away. Cleanup is attempted even when an intermediate assertion
fails. Because a Product may be public-by-default, run this only when a brief automated test post is
acceptable; `--confirm` prevents an accidental Product selection.

Existing checkout workflows such as `bun run agent:configure` and
`bun run admin:invite:revoke --id <uuid>` remain available as compatibility aliases.

## Invite administrators

Only an enabled `super_admin` may create or revoke invitations. Authentication-management routes
require a short-lived interactive session and are deliberately not exposed as MCP tools.

For a recipient-facing handoff, `admin invite` prints a complete Simplified Chinese Markdown
package that includes the one-time invitation, a prompt the recipient can give directly to Codex or
Claude Code, and a link to [the onboarding guide](docs/invited-admin-onboarding.zh-Hans.md).
Invitation tokens are time-limited and single-use; administrator passwords, PATs, and refresh
tokens are never sent through chat. Invitation management reads the super administrator password
from macOS Keychain service `dev.rote.feedback-server.admin`, using account
`<normalized-server-origin>|<username>`. A legacy username-only item is accepted once and moved to
the server-scoped account only after successful authentication.

`admin invite` creates a 7-day invitation by default, with `--expires-in-days` accepting 1–30.
`--plan` accepts `free`, `solo`, or `studio` and defaults to Free. Solo and Studio require
`--subscription-term month|year|perpetual`; Free forbids a term, and Indie is not supported. Month
and year terms begin only when the invitation is accepted and use UTC calendar arithmetic. The
invitation expiry and subscription term are independent. An invitation grant cannot be edited;
revoke it and create another invitation instead. The same plan flags are accepted by `admin
create-local`.

The command
infers `--url` and `--username` from the existing Keychain Agent configuration when possible, reads
the saved super administrator password from Keychain without opening Terminal or prompting, then
prints the handoff package to stdout so an Agent can paste it back as a chat code block. The old
clipboard handoff is still available with `--delivery clipboard`. Plugin 0.6.14 verifies that the
Server echoes the requested grant; if an older Server ignores it, the CLI immediately revokes the
new invitation and reports that the Server must be upgraded.

When another Agent credential is configured, `admin accept-invite` shows its non-secret username
and service URL, then asks whether to keep it or switch to the invited account. Keeping is the
default: the command stops before password input and does not consume the invitation. Only an
explicit `switch` continues after warning that the current PAT will be revoked and its local
credentials removed. Keychain credentials are shared by every FeedbackServer-enabled Codex and
Claude session on the Mac, so switching is not isolated to one project. Both account passwords
remain hidden terminal input. If invitation acceptance fails after disconnecting the old account,
the CLI automatically attempts to restore it. It accepts a time-limited `--token` argument for
Agent-assisted onboarding and requires a visible interactive terminal. The Agent prepares the
checkout path and command; the recipient makes the account choice and runs it directly. The command
creates an ordinary administrator, verifies the account owns no Products, creates a 365-day PAT,
stores it atomically, and logs out every temporary session. Its completion message reports the
subscription summary actually returned by the Server, including fixed-term expiry and grace end.
If account creation committed but local configuration failed, do not reuse the invitation: run
`feedback-server agent configure` with the new account. Any PAT
whose compensating revocation also failed is recorded by non-secret ID in a separate Keychain ledger
and can be removed with the reported `agent revoke-token` command.

Each administrator owns an independent tenant. New administrators start with no Products and
cannot access another owner's Product.

## Security and development

Remote endpoints must use HTTPS. Plain HTTP is accepted only for exact loopback hosts
`localhost`, `127.0.0.1`, and `[::1]`. Long-lived secrets are never accepted as command arguments
or written to logs, bundles, repository files, or pending-revocation metadata. Invitation creation
uses the Keychain-stored super administrator password only. Time-limited single-use invitation
tokens may appear in onboarding handoff text and `accept-invite --token`.

```bash
bun install --cwd=plugins/feedback-server --frozen-lockfile
bun run check
bun run validate
bun run scan
claude plugin validate --strict .
```

Both `dist/server.mjs` and `dist/cli.mjs` are deterministic committed bundles. FeedbackServer
Plugin is licensed under the [MIT License](LICENSE).
