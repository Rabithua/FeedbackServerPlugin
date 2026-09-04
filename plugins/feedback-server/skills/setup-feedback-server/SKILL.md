---
name: setup-feedback-server
description: Install or upgrade FeedbackKit, complete FeedbackServer 2.0 browser OAuth and magic-link sign-in, verify the account, create the first Product, integrate the Apple SDK, or diagnose setup. Use for first-use onboarding and connection failures; not routine feedback triage.
---

# Set up FeedbackKit 2.0

FeedbackKit uses the remote Streamable HTTP MCP at `https://api.feedkit.cn/mcp`. Do not run a local
MCP process, install a runtime, configure an API token, or create a credential file. OAuth tokens,
browser sessions, and emailed magic links belong to the host and user; never request, display, copy,
or persist them.

## Connect and sign in

For an ordinary existing account, connect the trusted `feedback-server` plugin to the hosted MCP.
For invitation onboarding, read only `mcp_server` and `account_email` from the supplied invitation
instructions, connect to that server, and use that email in the browser. Do not look for any other
invitation credential.

Call `whoami` as the first protected MCP tool. When the host needs a connection, that call starts
Better Auth OAuth 2.1 in the browser. Tell the user to:

1. Enter the intended account email on the FeedbackKit login page.
2. Open the one-time magic link sent to that inbox without pasting it into the conversation.
3. Return to the browser flow and approve the requested scopes.

When the host reports a successful connection, call `whoami`. For an invitation, require its returned
email to match `account_email`; on a mismatch, stop Product work and reconnect with the correct
account. Do not treat the browser redirect alone as proof of the active identity.

## Create or select a Product

Call `list_products` immediately after `whoami`:

- With no Products, ask for the App name, platform (`iOS`, `iPadOS`, `macOS`, Android, or Web),
  default locale, and one explicit notification preference: `bark`, `webhook`, or `deferred`. Do not
  infer a choice from silence or reuse waitlist metadata. Derive and show a readable slug, then call
  `create_product` with `name`, `slug`, `defaultLocale`, and `notificationSetupPreference`. Leave
  status active, feedback private, and diagnostics disabled unless the user requested otherwise.
- With one Product, read its current settings and verify that it is the requested App. With several,
  ask the user to select one and never guess an ID.
- If the selected Product still reports `notificationSetupPreference: "unresolved"`, collect the
  missing choice and persist it with `set_notification_setup_preference` before declaring server-side
  setup complete.

For Bark or webhook, continue with `$configure-notifications`. A risky notification call uses native
MCP elicitation when available. If the tool instead returns `confirmation_required`, show the exact
redacted effect, wait for approval, and repeat the same operation with identical arguments plus
`confirm: true`. Never use a confirmation identifier.

## Integrate the App

Before modifying an Apple project, identify the target project, target, and files and obtain explicit
approval. Then integrate the FeedbackKit SDK, place the Product's publishable key in the intended
configuration without leaking unrelated credentials, build the smallest relevant target, and verify
endpoint, key placement, locale behavior, and SDK initialization. Android and Web setup can complete
the account and Product work, but this plugin does not automate their SDK integration.

Use `whoami`, Product records, `get_subscription`, and notification configuration as the setup source
of truth. With a 401, restart host OAuth; with a 403, report the missing scope, role, or subscription
access. Never ask the user for a bearer token. Run a live feedback roundtrip only when explicitly
requested.
