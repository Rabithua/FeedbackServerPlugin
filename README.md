# FeedbackKit Agent Plugin 1.0

FeedbackKit connects Codex and Claude Code directly to the hosted FeedbackServer MCP for Product
setup, user-feedback triage, roadmaps, releases, waitlist invitations, notifications, and audit
history. Version 1.0 uses browser OAuth and ships no local MCP runtime, CLI, Bun dependency, native
keyring integration, Profile, or JavaScript bundle.

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

Installation does not force sign-in. The remote MCP at `https://api.feedkit.cn/mcp` anonymously
publishes `health` and `accept_invitation`; the first protected tool starts OAuth.

## Invitation connection

Paste the complete invitation Prompt into a Codex or Claude Code task. The Agent calls anonymous
`accept_invitation`, then shows a ten-minute continuation link and ten-character pairing code. Open
the link and let the Agent retry `connection_status`; the host opens OAuth.

The consent page already knows the invited email and subscription entitlement. Click **Accept and
connect** after reviewing scopes. No email entry or second verification message is required. The
invitation is consumed only at final approval, in the same transaction that creates the account,
entitlement, OAuth grant, and authorization code.

If OAuth uses another browser or isolated WebView, paste the pairing code on the page. This only
pairs the browser to the handoff; it does not authenticate a second time.

## Existing accounts

Calling a protected tool such as `connection_status` opens the same OAuth page. Existing accounts
enter their email and six-digit code in the browser, review requested scopes, and approve. The host
exchanges and stores the opaque access and rotating refresh tokens. Tokens never enter Agent output,
plugin files, website storage, or the repository.

## Security model

- Invitation tokens are used only by the first anonymous tool call and are never logged or repeated.
- Handoffs and short codes expire after ten minutes, are stored as hashes, are single-use, and are
  rate-limited after five failed guesses.
- Protected tools declare their own OAuth scopes and return the standard MCP authentication
  challenge when linking is required.
- Destructive, public, and external effects retain encrypted ten-minute, single-use confirmation
  previews through `execute_confirmation`.
- Existing REST/PAT and legacy invitation credentials remain server-compatible, but plugin 1.0
  neither creates nor stores PATs.

See [English onboarding](docs/invited-admin-onboarding.en.md),
[中文接入说明](docs/invited-admin-onboarding.zh-Hans.md), and
[generic remote MCP configuration](docs/generic-mcp.md).

## Validate

No package installation or Bun environment is required:

```bash
python3 scripts/validate_distribution.py
python3 scripts/check_sensitive_content.py
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/feedback-server
```

The Codex `.app.json` is added only after OpenAI assigns the production connector ID. Until that
registration step, Codex and Claude Code both use the checked remote HTTP MCP descriptor; no fake
connector identifier is committed.
