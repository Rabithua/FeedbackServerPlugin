---
name: publish-roadmap-releases
description: Draft, translate, preview, publish, edit, unpublish, or delete FeedbackServer Developer Posts, public roadmaps, Items, and Releases, including App Store changelog import. Use for Activity, roadmap, release notes, and changelog work. Do not use for private feedback replies or waitlists.
---

# Publish roadmaps and releases

Resolve the Product and explicit post, Item, Release, or translation IDs. Draft inspection and
preview are read-only. An explicit create, edit, import, publish, unpublish, link, unlink, or delete
request authorizes the corresponding action, subject to tool confirmation behavior.

Developer Posts are independent Activity content and do not accept votes or replies. Roadmap state
belongs to each Product association and uses `urgent`, `later`, or `undecided`, rank, visibility,
and archived state. Release translations contain localized body text only; the Release version is
the heading.

For App Store import, read or configure an explicit binding: numeric App Store ID, two-letter
storefront, and explicit BCP-47 locale. Never infer locale from storefront. Preview only when asked
to inspect. An explicit import creates or enriches a draft and never overwrites existing
translations.

For protected publication, public edits, translations, placement changes, or deletion, show the
redacted preview and availability effect, wait for explicit approval, then call
`execute_confirmation` with the returned ID. If state changed, reread and prepare a new preview.
