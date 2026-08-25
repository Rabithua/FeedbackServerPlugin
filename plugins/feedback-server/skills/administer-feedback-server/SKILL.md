---
name: administer-feedback-server
description: Administer FeedbackServer Products, subscription access, primary Product, publishable keys, account roles, audit records, and non-triage attachments. Use for tenant and Product administration; not installation, waitlists, routine feedback triage, or release publishing.
---

# Administer FeedbackServer

Use MCP tools for Products, subscription state, access, primary Product, keys, audit, and attachments.
Never infer subscription access or use undocumented grant routes. `set_primary_product` is protected:
show the transition and execute only through `execute_confirmation` after approval.

Account onboarding is email-bound and Agent-first. Route invitation acceptance, profile selection,
first Product creation, and Apple setup through `$setup-feedback-server`. Passwords, usernames, and
display names do not exist. New-device login happens inside the Agent with a six-digit email code;
there is no website login or Passkey. Route login, email changes, and PAT management through
`$setup-feedback-server`, and never return the long-lived PAT to Agent context.

Waitlist invitation email belongs to `$manage-waitlist`: it defaults to Free and requires a redacted
preview plus explicit confirmation. Never reproduce its one-time token or rendered body.

Protected Product archival/deactivation, public defaults, key rotation, and permanent deletion
require a redacted preview and explicit approval. Then call `execute_confirmation` with the returned
ID. Resolve IDs and current preconditions again after stale-state errors.
