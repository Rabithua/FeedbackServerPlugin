---
name: setup-feedback-server
description: Install, upgrade, connect, diagnose, or complete first-use setup for the local FeedbackServer plugin in Codex or Claude Code, including named profiles and FeedbackKit iOS integration. Use for onboarding, connection_status failures, profile switching, doctor, or setupNotice. Do not use for routine feedback triage or publishing.
---

# Set up FeedbackServer

Use `connection_status` first. If credentials are absent, call `prepare_local_setup` with
`configure_account`, show the exact command, and require the user to run it in a visible terminal.
Never ask for a password or PAT in chat, open a private PTY, clone the repository, or guess a plugin
cache path. Continue in the current task after the CLI succeeds; the running MCP process reloads
Keychain credentials on its next call.

Administrator login accepts a username or verified email. If the user needs to bind/change account
email or recover a password, provide the installed bundle's `feedback-server admin email bind` or
`feedback-server admin password-reset` command for a visible terminal. Passwords and emailed codes
must remain hidden terminal input and never enter Agent context. A password reset preserves existing
sessions, PATs, and Passkeys by current Server policy.

Automatic setup requires macOS Keychain. On another platform, do not present the CLI account setup
as runnable; require both `FEEDBACK_SERVER_BASE_URL` and `FEEDBACK_SERVER_API_TOKEN` in the MCP
process environment and restart that process. Never ask the user to paste either value into chat.

Profiles are global to this Mac, not repository-local. Environment credentials override Keychain
and have no active profile. Before `profile use`, `profile remove`, or configuring a different
profile, state that the change affects all FeedbackServer Codex and Claude sessions on this Mac.
Profile IDs contain 1–40 lowercase letters, numbers, dots, underscores, or hyphens. Use the bundled
CLI in a visible terminal for `profile list`, `profile use NAME`, `profile remove NAME`,
`agent configure --profile NAME`, and `agent disconnect --profile NAME`.

For installation, inspect host state first. In Codex, add a missing marketplace, otherwise run
`codex plugin marketplace upgrade feedback-server`; run `codex plugin add
feedback-server@feedback-server` only if absent. In Claude Code, add or update the marketplace,
then install a missing plugin or run `claude plugin update feedback-server@feedback-server`.
Reload only after installation or plugin upgrade, never after credential or profile changes.

After connection, call `get_onboarding_status` and act on only its first `nextActions` item. Never
claim app setup is complete merely because account connection succeeded. With multiple Products,
list names and IDs and ask for an explicit selection. Before changing an iOS workspace, describe
the files and obtain explicit approval. Keep publishable keys out of prose and previews.

Run the installed `feedback-server doctor` after setup or upgrade. For multiple Products pass an
explicit `--product`; for iOS pass an absolute `--app-path`. Treat warnings as review decisions and
failures as blockers. Run the live roundtrip only when explicitly requested and require the user to
supply the Product slug via `--confirm`; do not infer it.
