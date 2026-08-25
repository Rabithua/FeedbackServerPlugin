# FeedbackKit Agent Plugin

FeedbackKit connects Codex and Claude Code to FeedbackServer for Product setup, user-feedback
triage, roadmap and release publishing, waitlist invitations, notifications, and audit history.
Version 0.12 adds Agent-native email-code login and recovery without a browser account surface.

## Install

Codex:

```bash
codex plugin marketplace add Rabithua/FeedbackServerPlugin --ref main
codex plugin add feedback-server@feedback-server
```

Claude Code:

```bash
claude plugin marketplace add Rabithua/FeedbackServerPlugin
claude plugin install feedback-server@feedback-server --scope user
```

## Accept an invitation

Paste the complete invitation Prompt into a Codex or Claude Code task. The Agent installs or
upgrades this plugin, locates the installed bundle from plugin metadata, and runs `feedbackkit
accept-invite` in the same task. The invitation Prompt may contain its one-time token in the current
conversation; the Agent sends it through stdin and consumes it immediately, never placing it in a
command argument, shell history, log, or repeated output.

Acceptance atomically creates the verified-email account, enables Free, issues a 365-day Agent
credential, stores it in the operating system's native keyring, and acknowledges storage so the
Server clears its encrypted 15-minute recovery copy. Supported stores are macOS Keychain, Windows
Credential Manager, and Linux Secret Service. There is no plaintext file fallback.

If a local profile exists, the CLI asks whether to keep it, add a named profile, or replace it
before consuming the invitation. Old username-based profiles are intentionally not migrated.

## First App

The Agent asks again for App name, Apple platform, default language, and target App when a repository
contains several Apps. It confirms the generated slug, creates an active Product with private
feedback and diagnostics disabled, then asks you to choose Bark, Product Webhook, or explicitly
defer notification setup. It persists that answer on the Product so later tasks continue the chosen
channel or respect the defer choice instead of asking again. After that choice it describes the
intended Apple project edits and waits for approval. After SDK integration it builds and runs Doctor.

These commands are available immediately after installation, without MCP hot reload:

```bash
feedbackkit onboarding status
feedbackkit product create --name "My App" --platform ios --locale zh-CN
feedbackkit notification preference set --product <uuid> --choice bark|webhook|defer
feedbackkit doctor --product <uuid> --app-path /absolute/path/to/app
feedbackkit profile list
feedbackkit profile use work
feedbackkit profile remove work
```

Android and Web can create the account and Product in 0.12; automatic SDK integration is currently
Apple-only.

## Log in on another device

Tell the Agent to log in to FeedbackKit. The plugin's `request_email_login` tool checks the native
credential store before sending email. Reply to the Agent with the six-digit code, and
`complete_email_login` creates a new 365-day PAT, stores it in the native keyring, and returns only
the account UUID/email, Profile, scopes, token ID, and expiry. The PAT never enters MCP output or the
Agent context. The same flow is available immediately after installation:

```bash
feedbackkit login email request --email owner@example.com
printf '%s' '123456' | feedbackkit login email complete --request <uuid>
```

If the target Profile exists, the Agent shows its email and asks whether to keep it, add a named
Profile, or replace it before any login email is sent. Email changes and Agent credential listing or
revocation require a separate email code that creates a ten-minute authorization bound to the
current PAT.

## Security model

- Accounts use UUID identity and a normalized verified email. There are no usernames, display
  names, passwords, or password reset.
- Email codes are the only human recovery and sensitive-operation authentication method; there is
  no website login or Passkey surface.
- Invitation tokens and email codes may appear in the current Agent conversation because they are
  single-use and immediately consumed. They must not enter logs, command arguments, or repeated output.
- Long-lived Agent PATs remain only in native credential storage and never enter Agent context.
- Agent credentials use named native-keyring profiles. Environment credentials remain available for
  controlled headless runtimes only and require complete non-secret identity metadata.
- External invitation email and destructive/public changes retain explicit confirmation gates.

See [English onboarding](docs/invited-admin-onboarding.en.md), [中文接入说明](docs/invited-admin-onboarding.zh-Hans.md),
and [generic MCP configuration](docs/generic-mcp.md).

## Development

```bash
bun install --cwd=plugins/feedback-server --frozen-lockfile
bun run check
bun run validate
bun run scan
```

The checked distribution includes Codex and Claude Code manifests, focused Skills, bundled CLI/MCP
artifacts, tests, and structural/secret scans.
