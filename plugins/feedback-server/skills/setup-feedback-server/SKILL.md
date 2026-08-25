---
name: setup-feedback-server
description: Install, upgrade, accept a FeedbackKit invitation, connect an Agent, create the first Product, integrate the Apple SDK, or run Doctor. Use for first-use onboarding, connection failures, profiles, or setup status; not routine feedback triage.
---

# Set up FeedbackKit

For an invitation Prompt, install or upgrade the trusted `feedback-server` plugin first. Locate its
installed directory from `codex plugin list --json` (`source.path`) or `claude plugin list --json`
(`installPath`); do not clone the repository or guess a cache path. In the same task, run the
bundle's `bin/feedbackkit accept-invite`. The invitation token may appear in the user-supplied Prompt
and current Agent conversation. Pass it through stdin, consume it immediately, and never repeat it
in command arguments, shell history, logs, or the final response.

The CLI checks the operating system's native credential store before consuming the invitation. If a
profile already exists, show its non-secret email and let the user choose keep, add a named profile,
or replace. Do not choose for them. Profiles are device-global across local Codex and Claude Code
tasks. There is no legacy username-profile migration or plaintext credential-file fallback.

After acceptance, completely re-ask for App name, Apple platform (`iOS`, `iPadOS`, or `macOS`),
default user language, and—when the repository contains several Apps—the target. Do not reuse
waitlist details. Generate a slug and show it for confirmation, then use the installed
`feedbackkit product create`; defaults are active, private feedback, and diagnostics off.

Immediately after Product creation, obtain an explicit notification preference before requesting
approval for Apple project edits: Bark, Product Webhook, or defer notification setup. Do not infer
defer from silence. For Bark or Webhook, follow `$configure-notifications`, including its protected
preview and confirmation. If notification tools are unavailable in the current task because the MCP
server has not reloaded, state that notifications are not yet configured and ask the user to
continue that selected setup in a new task; do not silently convert the choice to defer.

Before modifying an Apple project, identify the target project and files and obtain explicit
approval. Then integrate the FeedbackKit SDK, write the Product's publishable key without echoing it,
build the target, and run installed `feedbackkit doctor --product ID --app-path ABSOLUTE_PATH`.
Android and Web may complete account and Product creation, but state that automatic SDK integration
is not available in this release.

`feedbackkit onboarding status`, `product create`, and `doctor` are available immediately after
installation and do not require MCP hot reload. In later tasks, use `connection_status` and
`get_onboarding_status`; with several Products, ask for an explicit Product selection. Treat Doctor
failures as blockers and warnings as review items. Run a live roundtrip only when explicitly asked.

For a new device or credential recovery, use `request_email_login` without existing credentials.
If it reports `profile_choice_required`, show the existing Profile email and let the user choose to
keep it, add a named Profile, or replace it; never choose for them or request email first. Ask the
user to reply directly in the Agent conversation with the six-digit code, then call
`complete_email_login`. The one-time code does not need hidden input. The result must contain only
account UUID/email, Profile, token ID, scopes, expiry, and status; a PAT must never appear in Agent
context, output, logs, or a file.

Before email changes or listing/revoking other Agent credentials, call
`request_email_reauthentication`, ask the user to reply with the six digits, and call
`complete_email_reauthentication`. The plugin keeps the resulting ten-minute PAT-bound token in the
native credential store. Use the email-change tools to verify the new address. Never revoke the
currently active PAT through the other-credential tool. There is no website login, Passkey,
password, username, display name, or password reset.
