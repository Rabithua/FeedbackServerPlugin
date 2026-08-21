---
name: manage-feedback-server
description: Manage FeedbackServer apps (Products), subscription limits and Product access, private/public Feedback, private diagnostic bundles, internal notes and developer replies, Developer Posts, Product roadmaps, translations, Releases, attachments, Bark and Product Webhook configuration and delivery records, App Store changelog initialization, and audit history through the feedback-server MCP tools. Use when a user asks to inspect, triage, organize, reply to, publish, configure, or delete FeedbackServer data, or refers to app feedback, diagnostics, subscription usage, activity, roadmap, changelog, notifications, or FeedbackServer administration.
---

# Manage FeedbackServer

Use the `feedback-server` MCP tools as the only Product and Feedback management interface. Do not
fall back to direct SQL, production shell access, or undocumented HTTP calls. Administrator
invitations and Agent credential setup are the sole exception: they use the plugin's documented
Keychain-backed CLI commands because PAT-authenticated MCP tools cannot access authentication
routes. The documented `doctor` preflight and explicit `test roundtrip` acceptance command are also
CLI exceptions; do not reproduce their HTTP calls manually.

## Manage administrator onboarding

- Never ask a user to paste an administrator password, refresh token, or PAT into chat. Invitation
  management must use the super administrator password already saved in macOS Keychain. Do not open
  Terminal, spawn a private PTY, use a GUI password dialog, or wait for password input in chat.
  The canonical administrator password item is service `dev.rote.feedback-server.admin` with the
  normalized server origin and administrator username as the account, formatted
  `<server-origin>|<username>`. Time-limited invitation tokens may appear in the invite
  handoff text because they are single-use onboarding credentials.
- To create a shareable invitation for the current user, run this plugin's CLI directly; do not scan
  the workspace, read source files, or use `command -v` first. Resolve the plugin root from this
  Skill location and run `../../bin/feedback-server admin invite` from there, or the equivalent
  absolute cached plugin path. The command infers URL and username from the existing Keychain Agent
  credentials when possible, reads the super administrator password from macOS Keychain, and prints
  a complete Markdown handoff package to stdout. Return that package to the user as a code block.
  If the password is missing from Keychain, stop and report the missing service/account from the CLI
  error instead of switching to another input path. Use `--delivery clipboard` only when the user
  explicitly asks for clipboard delivery.
- Use `feedback-server admin invitations` to list non-secret invitation metadata and
  `feedback-server admin invite revoke --id <uuid>` to revoke an unaccepted invitation.
- The recipient uses `feedback-server admin accept-invite` in a visible, user-controlled interactive
  terminal because the command requires hidden password input. An Agent may install the plugin,
  clone the repository, collect the non-secret username and display name, and prepare the exact
  command. It must include `cd` to the repository's real absolute path, must not execute
  `accept-invite` itself, and must never open a private PTY or ask for a password in chat.
- In Codex, inspect `codex plugin marketplace list --json` and `codex plugin list --json` before
  installation. Add the FeedbackServer marketplace only when absent; otherwise upgrade it with
  `codex plugin marketplace upgrade feedback-server`. Run `codex plugin add
  feedback-server@feedback-server` only when the plugin is missing. If Codex requests command
  approval, the user must approve it in that same task; another Agent or task cannot do so.
- When Agent credentials already exist, show only the current non-secret username and service URL,
  then ask whether the user wants to keep the existing account or switch to the invited account.
  Explain that this Keychain account is shared by every FeedbackServer-enabled Codex and Claude
  session on the Mac, so switching is not isolated to the current project. Never choose on the
  user's behalf. Keeping is the CLI default: it stops before new-password input and does not consume
  the invitation. Only an explicit `switch` entered in the user's visible terminal may continue;
  warn first that it revokes the current Agent PAT and removes the Mac's shared local credentials.
  Both the current and new account passwords remain hidden CLI input. If invitation acceptance
  fails after the switch, the CLI automatically attempts to restore the old account; use
  `feedback-server agent configure` only when automatic restoration also fails.
  The CLI accepts a time-limited `--token` from the handoff, verifies the new tenant is empty, and
  configures a personal PAT in macOS Keychain. If account creation committed but configuration
  failed, use `feedback-server agent configure` with the new account; do not retry the invitation.
  If PAT rollback also failed, use the reported `feedback-server agent revoke-token --id <uuid>`
  recovery command.
- Use `feedback-server admin create-local` when the super administrator should create both sides locally
  without exposing an invitation token.
- Installing the plugin and accepting an invitation are separate. New administrators own no
  Products and cannot access or receive another administrator's Product.

## Verify setup and integration

- Run `feedback-server doctor` after setup or upgrade. It is read-only and checks plugin version,
  credentials, live health, PAT metadata, pending token cleanup, the server-computed effective
  subscription, Apps and storage usage, read-only Products, and Product selection without printing
  a PAT or Product key. Treat usage at or above 80% and read-only Products as warnings. Pass
  `--product <id-or-slug>` whenever more than one Product is visible.
- A successful tool result may include `updateNotice` when a newer stable plugin release exists.
  Briefly tell the user which version is available and show the supplied manual upgrade command.
  Never upgrade automatically or repeat a notice that is absent from later results.
- For an iOS host, pass `--app-path <absolute-path>` and an explicit Product. Doctor checks the
  resolved FeedbackKit version against both the minimum and latest stable GitHub Release, server
  URL and Product binding, explicit visitor Keychain service, and `.followHost` or `.fixed(Locale)`
  language policy. Treat warnings as decisions to review and failures as integration blockers.
- Run `feedback-server test roundtrip --product <id-or-slug> --confirm <product-slug>` only when the
  user explicitly asks for a live end-to-end test and a brief harmless test post is acceptable for
  that Product. The repeated slug is mandatory and must not be inferred for the user. The CLI uses
  a unique random Visitor, verifies submit/administrator receive/reply/client unread/read, then
  deletes the Visitor and confirms cascade cleanup. If cleanup fails, report that failure
  prominently; never claim the Product was left clean.

## Select the app

- Treat each app as a separate Product.
- When no Product is named, list Products owned by the connected account first.
- If exactly one Product clearly matches, continue without a separate selection update and name it
  in the final result.
- If multiple Products could match, ask the user; never guess or keep an implicit current Product.
- Pass explicit Product, Feedback, Developer Post, Item, Release, Attachment, or Outbox IDs to every
  later tool.

## Inspect subscription access

- Use `get_subscription` for the server-computed declared and effective plans, lifecycle and dates,
  limits, enabled features, finalized and reserved storage, primary Product, and each Product's
  `read_write` or `read_only` access. Never infer access from locally cached Plugin state.
- The Plugin deliberately has no grant, renewal, or downgrade tool. Do not attempt to change a
  subscription through undocumented routes, direct database access, or Product state changes.
- Treat `set_primary_product` as protected even when its current affected-Product list is empty.
  Show the current and target Product IDs and every access transition, then wait for explicit user
  confirmation. If the precondition is stale, reread the risk context and present a new preview.
- Switching the primary Product does not change a subscription plan, delete data, or change Product
  status. It can change which Product remains writable under a constrained effective plan.

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
  Developer Posts, pinning, private Developer Post edits, private Roadmap placement, Bark
  configuration, internal notes and links, App Store binding, and draft changelog import. Do not ask
  for an additional conversational confirmation.
- Protected tools return `confirmation_required` for Product deactivation or archival, switching a
  Product default to public, first publication of private Feedback, public Feedback replies, actual
  Feedback status changes, Developer Post publication/deletion, publishable key rotation, entity or
  translation deletion, published Developer Post edits, Item or Release translations, public
  Roadmap content or placement changes, Release publication or edits, Product Webhook configuration
  and test delivery, Bark test delivery, and failed-delivery retry. Re-publication after a Feedback
  has previously been public executes directly. Same-state
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
- Never expose a Bark device key or Product Webhook signing secret in a preview or result.

## Manage Product Webhooks

- Read masked Product configuration with `get_product_webhook_config` and delivery history with
  `list_webhook_deliveries`.
- Configuration, test delivery, and failed-delivery retry are protected actions. Show the redacted
  preview and wait for explicit confirmation before repeating the same call with `confirmationId`.
- Never display, log, or return a signing secret. A configured endpoint must remain owned and
  controlled by the Product owner.

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
- Release translations contain only localized `body` text. The Release `version` is its heading;
  never invent or request a separate Release title.
- Summarize whether the import created a draft, added a missing locale, or made no change.

## Handle errors

- Preserve the server error `status`, `code`, and `message` in the explanation.
- On 401, report that the Agent connection must be reconfigured; never ask the user to paste a Token into chat.
- On 403, report the missing scope or role and stop.
- On ambiguous or missing IDs, list or reread entities instead of guessing.
- Do not retry writes automatically. Safe reads may be repeated only when the user still needs the result.
