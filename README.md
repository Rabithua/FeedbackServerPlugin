# FeedbackKit Agent Plugin

FeedbackKit connects Codex and Claude Code to FeedbackServer for Product setup, user-feedback
triage, roadmap and release publishing, waitlist invitations, notifications, and audit history.
Version 0.11.0 introduces Agent-first, passwordless onboarding.

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
accept-invite` in the same task. The one-time token is sent only through stdin, never a command
argument or shell history.

Acceptance atomically creates the verified-email account, enables Free, issues a 365-day Agent
credential, stores it in the operating system's native keyring, and acknowledges storage so the
Server clears its encrypted 15-minute recovery copy. Supported stores are macOS Keychain, Windows
Credential Manager, and Linux Secret Service. There is no plaintext file fallback.

If a local profile exists, the CLI asks whether to keep it, add a named profile, or replace it
before consuming the invitation. Old username-based profiles are intentionally not migrated.

## First App

The Agent asks again for App name, Apple platform, default language, and target App when a repository
contains several Apps. It confirms the generated slug, creates an active Product with private
feedback and diagnostics disabled, describes the intended Apple project edits, and waits for
approval. After SDK integration it builds and runs Doctor.

These commands are available immediately after installation, without MCP hot reload:

```bash
feedbackkit onboarding status
feedbackkit product create --name "My App" --platform ios --locale zh-CN
feedbackkit doctor --product <uuid> --app-path /absolute/path/to/app
feedbackkit profile list
feedbackkit profile use work
feedbackkit profile remove work
```

Android and Web can create the account and Product in 0.11.0; automatic SDK integration is currently
Apple-only.

## Security model

- Accounts use UUID identity and a normalized verified email. There are no usernames, display
  names, passwords, or password reset.
- Human website login uses an email code or Passkey.
- Invitation tokens are seven-day, single-use bearer secrets and must not enter logs or output.
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
