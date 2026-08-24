---
name: setup-feedback-server
description: Install, upgrade, accept a FeedbackKit invitation, connect an Agent, create the first Product, integrate the Apple SDK, or run Doctor. Use for first-use onboarding, connection failures, profiles, or setup status; not routine feedback triage.
---

# Set up FeedbackKit

For an invitation Prompt, install or upgrade the trusted `feedback-server` plugin first. Locate its
installed directory from `codex plugin list --json` (`source.path`) or `claude plugin list --json`
(`installPath`); do not clone the repository or guess a cache path. In the same task, run the
bundle's `bin/feedbackkit accept-invite` and pass the one-time token only through stdin. Never put it
in command arguments, shell history, logs, or the final response.

The CLI checks the operating system's native credential store before consuming the invitation. If a
profile already exists, show its non-secret email and let the user choose keep, add a named profile,
or replace. Do not choose for them. Profiles are device-global across local Codex and Claude Code
tasks. There is no legacy username-profile migration or plaintext credential-file fallback.

After acceptance, completely re-ask for App name, Apple platform (`iOS`, `iPadOS`, or `macOS`),
default user language, and—when the repository contains several Apps—the target. Do not reuse
waitlist details. Generate a slug and show it for confirmation, then use the installed
`feedbackkit product create`; defaults are active, private feedback, and diagnostics off.

Before modifying an Apple project, identify the target project and files and obtain explicit
approval. Then integrate the FeedbackKit SDK, write the Product's publishable key without echoing it,
build the target, and run installed `feedbackkit doctor --product ID --app-path ABSOLUTE_PATH`.
Android and Web may complete account and Product creation, but state that automatic SDK integration
is not available in this release.

`feedbackkit onboarding status`, `product create`, and `doctor` are available immediately after
installation and do not require MCP hot reload. In later tasks, use `connection_status` and
`get_onboarding_status`; with several Products, ask for an explicit Product selection. Treat Doctor
failures as blockers and warnings as review items. Run a live roundtrip only when explicitly asked.

For subsequent website access, use the feedkit.cn email-code or Passkey flow. Passwords, usernames,
display names, and password reset do not exist. Email changes require recent interactive
authentication and verification of the new address.
