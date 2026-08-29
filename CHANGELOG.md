# Changelog

## 1.1.1 - 2026-08-30

- Make the ten-character connection code the only invitation-to-OAuth pairing path and require the
  Agent to show it before opening OAuth; remove automatic same-browser invitation loading.
- Continue live onboarding immediately after OAuth instead of stopping at “connected,” including an
  action-required notification choice for unresolved Products.
- Require Bark, Product Webhook, or deferred notification preference in MCP Product creation so the
  choice is stored atomically with the Product and cannot be skipped by instruction drift.

## 1.1.0 - 2026-08-29

- Bind same-browser invitation handoffs directly to the OAuth authorization request and retain the
  ten-character code only for isolated WebViews or different browsers.
- Describe invitation activation as one OAuth approval transaction that creates the account,
  applies its entitlement, and issues the authorization code without a separate signup step.
- Remove invitation PAT enrollment compatibility guidance; independent PAT authentication remains
  available outside invitation onboarding.

## 1.0.0 - 2026-08-28

- Replace the local Bun/stdio MCP, CLI, native keyring, Profiles, and runtime JavaScript bundle with
  the hosted `https://api.feedkit.cn/mcp` connector.
- Defer Marketplace authentication until a protected tool is used, keeping `health` and anonymous
  `accept_invitation` available before linking.
- Add the ten-minute invitation handoff and cross-browser pairing-code workflow; invited users
  approve the recognized email and entitlement in browser OAuth without another email code.
- Move access/refresh token storage entirely into Codex, ChatGPT, or Claude Code and preserve
  tool-specific scopes plus encrypted single-use confirmations.

## 0.12.3 - 2026-08-25

- Persist each Product's explicit Bark, Product Webhook, or defer onboarding choice so later tasks
  continue the selected path instead of repeating the question.
- Show prioritized next actions and notification choices in the default `onboarding status` text
  output, matching the structured JSON status.
- Add same-task CLI and MCP operations for saving the notification preference, with deferred setup
  remaining resolved without falsely reporting an effective delivery channel.

## 0.12.2 - 2026-08-25

- Require an explicit Bark, Product Webhook, or defer choice immediately after first Product
  creation and before requesting approval for Apple project edits.
- Return the same structured notification choice from the same-task Product CLI and guided
  onboarding status so Agents do not depend on documentation recall.
- Preserve notification setup as optional and report it accurately when MCP notification tools need
  a fresh task after plugin installation.

## 0.12.1 - 2026-08-25

- Restore explicit Free, Solo, and Studio grants for confirmed waitlist invitations while keeping
  Free as the safe default.
- Require an explicit month, year, or perpetual term for paid grants and include the exact grant in
  the protected send preview and API request.
- Accept paid subscription metadata returned by passwordless invitation enrollment.

## 0.12.0 - 2026-08-25

- Add credential-free Agent email login with six-digit codes pasted directly into the conversation,
  recoverable enrollment, native-keyring persistence, and PAT-free MCP results.
- Add PAT-bound email reauthentication, Agent email replacement, and non-secret PAT listing and
  confirmed revocation tools.
- Remove website and Passkey guidance; keep invitation tokens and email codes usable in the current
  Agent conversation while preventing long-lived credentials from entering Agent context.
- Add same-task email login CLI commands and cover Profile conflict, response loss, replay, keyring
  expiry, and sensitive request placement.

## 0.11.1 - 2026-08-25

- Bootstrap locked production dependencies before loading the CLI or MCP server when a marketplace
  install does not contain `node_modules`.
- Route Codex and Claude Code through the dependency-aware MCP launcher and cover the first-run
  bootstrap without weakening native Keyring requirements.

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
