---
name: administer-feedback-server
description: Administer FeedbackServer 2.0 Products, subscriptions, primary Product, publishable keys, administrator access, invitations, automation tokens, audit records, App Store bindings, and non-triage attachments. Use for account and Product administration; not installation, waitlists, routine feedback triage, or publishing.
---

# Administer FeedbackServer 2.0

Start with `whoami` when account or role matters. Use `list_products`, `get_product`, and
`get_subscription` before changing Products or plan-dependent access. Never infer ownership,
subscription grants, or write eligibility. The Product publishable key is an identifier, but rotating
it immediately breaks shipped clients that still use the old value.

`create_product` is a direct write after the user supplies App name, platform, default locale, and an
explicit Bark, webhook, or deferred notification choice. `set_notification_setup_preference` records
that choice. `update_product`, `set_primary_product`, `delete_product`, and `rotate_product_key` have
live or destructive effects and must follow their tool's risk marker.

Use `list_administrators` before `update_administrator`; disabling an account or promoting its role
requires the exact target and current state. Use `list_invitations`, `list_all_invitations`,
`invite_administrator`, `retry_invitation_email`, and `revoke_invitation` for account invitations.
Invitation onboarding passes only `mcp_server` and `account_email` to the recipient workflow and
continues through browser magic-link sign-in plus `whoami`.

Create an automation token only on an explicit request with `create_automation_token`. Its full value
is returned once; do not echo it in chat, logs, commands, or summaries. Use
`list_automation_tokens` for masked inventory and `revoke_automation_token` for the exact selected
token. Do not claim broader permissions than the returned scopes.

Read App Store bindings with `get_product_app_store_binding` before using
`configure_product_app_store_binding` or `remove_product_app_store_binding`. Use
`preview_latest_app_store_release` before an explicit `import_latest_app_store_release`. Generate an
attachment URL only for an explicit access request. Use `list_audit` for immutable account history
and preserve its exact resource IDs.

For every tool marked risky, prefer native MCP elicitation. If the client cannot elicit and the tool
returns `confirmation_required`, show the exact target, role/access/public/client/external effect,
and redacted secret handling, wait for approval, then repeat the same operation with identical
arguments plus `confirm: true`. Never use a confirmation identifier or alter the confirmed payload.
Reread current state after conflicts and never retry a mutation automatically.
