# Changelog

## 0.11.0 - 2026-08-25

- Replace username/password onboarding with verified-email accounts, one-time Agent enrollment, and
  email-code or Passkey browser access.
- Add `feedbackkit accept-invite`, `onboarding status`, `product create`, and `doctor` for same-task
  onboarding without MCP hot reload.
- Store complete named profiles through macOS Keychain, Windows Credential Manager, or Linux Secret
  Service with no plaintext fallback or legacy username-profile migration.
- Default every waitlist invitation to Free and provide concise branded invitation Prompts that keep
  tokens out of arguments, logs, and output.

All notable changes to FeedbackServer Plugin are documented here.

## 0.10.3 - 2026-08-24

- Continue through macOS Keychain executable fallbacks when the hidden prompt wrapper cannot launch a configured `security` candidate.
- Preserve actionable Keychain diagnostics while redacting password prompts and secret input.

## 0.10.2 - 2026-08-24

- Write PATs and administrator passwords through a hidden pseudo-terminal so macOS Keychain never prompts the user or receives an empty secret.

## 0.10.1 - 2026-08-24

- Validate and normalize account-email endpoints before transmitting passwords or verification codes.
- Require an interactive terminal before requesting password-reset email, and warn when email binding cannot close its temporary session.
- Store the server-returned canonical username after verified-email login.
- Make Doctor identify PATs that lack the `waitlist:invite` scope.

## 0.10.0 - 2026-08-24

- Add explicitly confirmed waitlist invitation send, retry, and revoke tools with typed Free/Solo/Studio grants.
- Show the connected administrator's own verified-email status without exposing other accounts' addresses.
- Add visible-terminal email binding/change and password-reset commands with hidden password and code input.
- Accept username or verified email in administrator login prompts and document that reset preserves sessions, PATs, and Passkeys.

## 0.9.2 - 2026-08-24

- Recognize `FeedbackConfiguration.init(...)` and typed `.init(...)` syntax, including `try`, `try?`, and `try!`, in Doctor.
- Protect cross-profile PAT references using non-secret metadata without reading unrelated token items.
- Preserve credential records, profile indexes, and their PATs when pointer rollback cannot be verified.

## 0.9.1 - 2026-08-24

- Prevent pending PAT recovery for one profile from revoking credentials still used by another profile.
- Reject excess profiles before writing credentials and roll back incomplete profile activation.
- Require confirmation before changing global or Product Bark configuration.
- Limit Doctor endpoint conflicts to FeedbackKit configuration and warn for unresolved endpoint, Keychain service, or language overrides.
- Reject automatic account setup off macOS with paired environment-variable remediation.
- Return credential-source-aware remediation when environment credentials receive HTTP 401.

## 0.9.0 - 2026-08-24

- Add global named Keychain profiles with resumable migration of the legacy default pointer.
- Split FeedbackServer guidance into six focused Skills plus a compatibility router.
- Add single-use `execute_confirmation` execution while retaining the legacy confirmation protocol through 1.0.
- Return request IDs, Retry-After guidance, remediation, semantic parameter descriptions, and calibrated tool annotations.
- Add Claude Code routing evals for setup, triage, waitlists, publishing, errors, profiles, and negative triggers.

## 0.8.0 - 2026-08-24

- Accept FeedbackKit 0.2's fixed endpoint, bundle-derived visitor Keychain service, and follow-host language defaults in `doctor`.
- Add credential-free `prepare_local_setup` commands from the installed plugin bundle.
- Make Codex and Claude Code installation, upgrade, reload, and invitation handoff instructions host-specific.
- Use Claude Code's canonical root `.mcp.json` and expose waitlist discovery metadata.

## 0.7.0 - 2026-08-23

- Add owner-scoped FeedbackKit waitlist management tools and Agent PAT scopes.

Earlier release notes remain available in the GitHub Releases history.
