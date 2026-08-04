---
name: manage-feedback-server
description: Manage FeedbackServer apps (Products), private/public Feedback, private diagnostic bundles, internal notes and developer replies, Developer Posts, Product roadmaps, translations, Releases, attachments, Bark configuration and delivery records, App Store changelog initialization, and audit history through the feedback-server MCP tools. Use when a user asks to inspect, triage, organize, reply to, publish, configure, or delete FeedbackServer data, or refers to app feedback, diagnostics, activity, roadmap, changelog, Bark notifications, or FeedbackServer administration.
---

# Manage FeedbackServer

Use the `feedback-server` MCP tools as the only Product and Feedback management interface. Do not
fall back to direct SQL, production shell access, or undocumented HTTP calls. Administrator
invitations and Agent credential setup are the sole exception: they use the repository's documented
trusted-terminal commands because PAT-authenticated MCP tools cannot access authentication routes.

## Manage administrator onboarding

- Never ask a user to paste an administrator password, invitation token, refresh token, or PAT into
  chat. These secrets belong only in hidden terminal prompts.
- To create a shareable invitation, direct an enabled `super_admin` to `bun run admin:invite`. The
  command copies the one-time token to the macOS clipboard, reports only its prefix and metadata,
  clears it after sharing when unchanged, and revokes it if clipboard delivery fails.
- Use `bun run admin:invitations` to list non-secret invitation metadata and
  `bun run admin:invite:revoke --id <uuid>` to revoke an unaccepted invitation.
- The recipient uses `bun run admin:accept-invite`. It refuses to consume the invitation when Agent
  credentials already exist, verifies the new tenant is empty, and configures a personal PAT in
  macOS Keychain. If account creation committed but configuration failed, use
  `bun run agent:configure`; do not retry the invitation.
- Use `bun run admin:create-local` when the super administrator should create both sides locally
  without exposing an invitation token.
- Installing the plugin and accepting an invitation are separate. New administrators own no
  Products and cannot access or receive another administrator's Product.

## Select the app

- Treat each app as a separate Product.
- When no Product is named, list Products owned by the connected account first.
- If exactly one Product clearly matches, continue without a separate selection update and name it
  in the final result.
- If multiple Products could match, ask the user; never guess or keep an implicit current Product.
- Pass explicit Product, Feedback, Developer Post, Item, Release, Attachment, or Outbox IDs to every
  later tool.

## Read and summarize

- Perform necessary target and risk reads silently.
- Follow `nextCursor` until the requested range is complete; do not silently treat one page as all data.
- Do not narrate ordinary reads or intermediate tool calls. Return one concise result that identifies
  the Product and changed entities.
- Do not include internal notes, client context, Visitor IDs/credentials, administrator credentials,
  Bark device keys, or attachment URLs unless the user explicitly requests and is authorized to see them.
- Call `get_attachment_url` only after an explicit request to open or download that attachment.
- Treat diagnostic artifacts as more sensitive than ordinary attachments. `get_feedback` may show
  metadata, but call `get_diagnostic_bundle_url` only when the user explicitly asks to inspect or
  download that diagnostic bundle. Never generate diagnostic URLs speculatively.

## Make changes

- Treat an explicit request to create, update, configure, import, publish, link, unlink, or add an
  internal note as permission to call a direct-write tool after resolving its explicit target.
- A request to draft, review, inspect, preview, plan, or summarize is not permission to mutate.
- Direct writes include ordinary Product fields, private Feedback replies, unpublishing Feedback or
  Developer Posts, pinning, Developer Post drafts/edits, private Roadmap placement, translations,
  Releases and Release publication, Bark configuration, internal notes and links, App Store binding,
  and draft changelog import. Do not ask for an additional conversational confirmation.
- Protected tools return `confirmation_required` for Product deactivation or archival, switching a
  Product default to public, first publication of private Feedback, public Feedback replies, actual
  Feedback status changes, Developer Post publication/deletion, publishable key rotation, entity or
  translation deletion, public Roadmap placement changes, Bark test delivery, and failed-delivery
  retry. Re-publication after a Feedback has previously been public executes directly. Same-state
  conditional requests return `no_change`; report that briefly and do not confirm.
- For a protected action, present one compact preview containing the Product, affected entity,
  visible text or requested status, and the deletion, notification, or availability effect.
- Wait for explicit user confirmation. Do not interpret a request to draft, review, inspect, plan, or summarize as permission to execute.
- After confirmation, repeat the same tool call with the returned `confirmationId` and unchanged arguments.
- A confirmation ID is single-use and expires after ten minutes. If it expires or any input changes, prepare a new preview.
- If execution returns `mutation_precondition_failed`, the entity changed after the preview. Do not
  retry automatically; reread it and, if the user still wants the action, present a fresh protected
  preview.
- For batches, prepare every action, show one combined summary, obtain one explicit confirmation, then execute only those prepared actions.
- Public replies must be shown in full before sending.
- Non-internal replies are accepted only while Feedback is `open`. If it is `resolved` or `closed`,
  report that it must be reopened with the protected status tool before continuing the conversation.
- Internal notes remain available after Feedback is resolved or closed.
- Never expose a Bark device key in a preview or result.

## Manage public Activity

- Feedback visibility is controlled only by the developer. Never look for or invent a Visitor
  visibility preference. Publishing exposes the Feedback body, attachments, author display code,
  and every non-internal Visitor or developer message as one unit; client context and internal notes remain
  private.
- Diagnostic artifacts remain private regardless of Feedback visibility. Never describe publishing
  Feedback as publishing its diagnostics, and never substitute `attachments:read` for the required
  `diagnostics:read` permission.
- Developer Posts are independent read-only feed content. Create/edit them as drafts directly;
  publication requires the protected publication tool. They do not accept votes or replies.
- Roadmap state belongs to each Product association. Use `urgent`, `later`, or `undecided`, rank,
  visibility, and archived state; do not use legacy Item status or voting fields.

## Initialize changelog from the App Store

- Read or configure the explicit Product App Store binding before importing.
- Binding requires the App Store numeric ID, two-letter storefront, and explicit BCP-47 target
  locale. Never infer locale from storefront.
- Use `preview_latest_app_store_release` only when the user asks to preview or inspect.
- On an explicit import request, call `import_latest_app_store_release` directly. New Releases remain
  drafts; existing translations are never overwritten.
- Summarize whether the import created a draft, added a missing locale, or made no change.

## Handle errors

- Preserve the server error `status`, `code`, and `message` in the explanation.
- On 401, report that the Agent connection must be reconfigured; never ask the user to paste a Token into chat.
- On 403, report the missing scope or role and stop.
- On ambiguous or missing IDs, list or reread entities instead of guessing.
- Do not retry writes automatically. Safe reads may be repeated only when the user still needs the result.
