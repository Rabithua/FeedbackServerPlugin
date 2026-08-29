---
name: setup-feedback-server
description: Install, upgrade, accept a FeedbackKit invitation, connect an Agent with browser OAuth, create the first Product, integrate the Apple SDK, or diagnose setup. Use for first-use onboarding, connection failures, or setup status; not routine feedback triage.
---

# Set up FeedbackKit

FeedbackKit uses the hosted `https://api.feedkit.cn/mcp` connector. Do not look for or run a local
MCP process, Bun runtime, CLI, native keyring, Profile, PAT, or token file. OAuth credentials belong
to the host and must never be requested, displayed, copied, or written by the Agent.

## Invitation flow

When the user supplies an invitation Prompt:

1. Install or upgrade the trusted `feedback-server` plugin. Authentication is deferred until a
   protected tool is used, so do not start ordinary email login first.
2. Read `invitation_token` from the Prompt and call the anonymous `accept_invitation` tool once for
   the current handoff. Do not call it again while that handoff remains active. Never repeat the
   token in chat, logs, commands, previews, or the final response.
3. Immediately show the returned ten-character connection code to the user and explain that the
   OAuth page will require it. Then retry protected `connection_status`; its OAuth challenge lets the host open the
   authorization flow once. Do not show or ask the user to open a separate continuation link.
4. Have the user paste the connection code on the OAuth page. Complete input binds this OAuth
   request and then reveals the invited email, subscription entitlement, client, and scopes. The
   code is not another identity check and is not an OAuth credential.
5. Tell the user to click **Accept and connect** after reviewing the loaded identity and scopes.
   Never request a second email verification code for an invitation.
6. Retry `connection_status` after approval. Continue only when it reports an authenticated OAuth
   connection. If the handoff expired, call `accept_invitation` again; the invitation remains usable
   until final approval or its own expiry; this expiry recovery is the exception to the one-call
   rule for the previous handoff.

Do not route an invited user through email verification. Every invitation browser uses the short
connection code; there is no cookie-based automatic invitation bind.

## Existing-account connection

For a normal installation without an invitation, call protected `connection_status` immediately.
The host opens FeedbackKit OAuth; the user switches to **Email code**, enters the existing account
email and six-digit code on `feedkit.cn/connect`, reviews scopes, and approves. The email and code
stay in the browser flow, not the Agent conversation. Retry `connection_status` after approval, then
continue its onboarding actions rather than stopping at “connected.”

## First Product and SDK setup

Immediately after connection, call `get_onboarding_status`; never finish a turn by reporting only
that OAuth connected. If there is no Product, completely re-ask for App name, platform (`iOS`,
`iPadOS`, `macOS`, Android, or Web), default user language, the target when several Apps exist, and
an explicit notification preference: Bark, Product Webhook, or defer. Do not reuse waitlist details
or infer defer from silence. Generate a slug, show it for confirmation, and pass the saved
`notificationSetupPreference` in `create_product`; defaults remain active, private feedback, and
diagnostics off.

For an existing selected Product whose onboarding action requires a notification choice, ask
immediately and persist it with `set_notification_setup_preference` before App integration. For Bark
or Webhook, follow `$configure-notifications`, including its protected preview and confirmation. A
saved Bark or Webhook choice remains action-required until its channel is configured; an explicit
defer resolves the step. Do not claim setup is complete while a notification action is unresolved.

Before modifying an Apple project, identify the target project and files and obtain explicit
approval. Then integrate the FeedbackKit SDK, write the Product publishable key without echoing it,
build the smallest relevant target, and verify endpoint, key placement, language behavior, and SDK
initialization directly in the project. Android and Web may complete account and Product creation,
but automatic SDK integration is not available in this release.

Use the returned onboarding status for remaining server-side steps. With several Products, ask for
an explicit Product selection. Treat build or configuration failures as blockers and warnings as
review items. Run a live feedback roundtrip only when explicitly asked.

Before email changes or listing/revoking other Agent connections, call
`request_email_reauthentication`, ask the user for the six digits, and call
`complete_email_reauthentication`. OAuth recent-auth state is held by the server and no token is
returned. Never revoke the currently active connection through `revoke_agent_credential`.
