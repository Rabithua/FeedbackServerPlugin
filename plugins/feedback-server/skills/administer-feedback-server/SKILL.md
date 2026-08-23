---
name: administer-feedback-server
description: Administer FeedbackServer Products, subscription access, primary Product, publishable keys, administrator invitations, audit records, and non-triage attachments. Use for tenant and Product administration. Do not use for initial installation, routine feedback triage, waitlists, or release publishing.
---

# Administer FeedbackServer

Use MCP tools for Products, subscription state, access, primary Product, keys, audit, and attachments.
Never infer subscription access locally or attempt grants, renewals, or downgrades through
undocumented routes. `set_primary_product` is protected because it can change Product write access;
show every transition and execute only through `execute_confirmation` after approval.

Invitation/authentication routes are the CLI exception. Never ask for an administrator password,
refresh token, or PAT in chat. Create/list/revoke invitations with the installed bundle's
`feedback-server admin invite`, `admin invitations`, and `admin invite revoke` commands; they read
the saved super-administrator password from macOS Keychain. The recipient calls
`prepare_local_setup` with `accept_invitation`, then runs that exact command in a visible terminal.
Invitation tokens may appear only in that single-use acceptance command. Do not execute it, open a
private PTY, clone source, or guess cache paths.

Invitation creation defaults to Free. Solo or Studio requires `month`, `year`, or `perpetual`; the
term starts when accepted and cannot be changed on that invitation. Existing credentials are
global profiles shared by all Codex and Claude sessions on the Mac. Never choose whether to keep or
switch for the user; route profile and account changes through `$setup-feedback-server`.

Protected Product archival/deactivation, public defaults, key rotation, and permanent deletion
require a redacted preview and explicit approval. Then call `execute_confirmation` with the
returned ID. Resolve IDs and current preconditions again after stale-state errors.
