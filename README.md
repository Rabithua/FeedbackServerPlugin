# FeedbackKit Agent Plugin 1.2

FeedbackKit connects Codex and Claude Code directly to the hosted FeedbackServer MCP for Product
setup, user-feedback triage, roadmaps, releases, waitlist invitations, notifications, and audit
history. Version 1.2 uses host-managed OAuth and ships no local MCP runtime, CLI, Bun dependency, or
JavaScript bundle.

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

Installation does not force sign-in. The only anonymous MCP surface at
`https://api.feedkit.cn/mcp` is protocol discovery and `health`.

## OAuth and account authentication

The `authenticate` tool is OAuth2-protected with an empty scopes list. Its first invocation lets the
host complete OAuth without granting FeedbackKit account access. OAuth success creates an unbound
connection; it does not select or create an account.

After OAuth, the Agent calls `authenticate` with exactly one discriminated input:

```json
{ "method": "email", "email": "person@example.com" }
```

or:

```json
{ "method": "invitation", "code": "the-code-from-the-invitation" }
```

Email authentication returns `pending_verification`. The user clicks the one-time link in the
email; the link is never copied back to the Agent. The Agent observes completion with
`authentication_status`. An invitation code binds the connection immediately, without a separate
browser step.

Only after account binding succeeds does the Agent call `connection_status`, then continue Product
and notification onboarding instead of stopping at “OAuth connected.”

## Security model

- Anonymous access is limited to MCP discovery and health.
- OAuth credentials remain in the host and never enter Agent output, plugin files, or the repository.
- OAuth completion and FeedbackKit account binding are separate states; an unbound connection has
  no account access.
- Email verification uses a one-time link that is opened by the user and observed through
  `authentication_status`.
- Invitation codes are passed only to the `invitation` branch of `authenticate` and bind immediately.
- Protected tools declare their own OAuth scopes and return the standard MCP authentication
  challenge when additional authorization is required.
- Destructive, public, and external effects retain encrypted ten-minute, single-use confirmation
  previews through `execute_confirmation`.

After binding, `connection_status` returns live onboarding actions. First-Product creation requires
an explicit Bark, Product Webhook, or defer choice, and an existing Product with an unresolved
choice prompts immediately.

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
