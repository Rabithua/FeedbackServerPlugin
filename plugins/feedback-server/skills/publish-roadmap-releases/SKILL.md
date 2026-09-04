---
name: publish-roadmap-releases
description: Draft, translate, preview, publish, edit, unpublish, or delete FeedbackServer 2.0 Developer Posts, public roadmap Items, and Releases, including App Store changelog import. Use for Activity, roadmap, release notes, and changelog work. Do not use for private feedback replies or waitlists.
---

# Publish FeedbackServer 2.0 roadmaps and Releases

Resolve the Product and exact Developer Post, Item, Release, translation, or App Store binding with
the matching list/get tool. Never guess IDs. Draft inspection and preview are read-only; a request to
review, draft, plan, or preview does not authorize publication or another write.

Developer Posts are independent Activity content and do not accept votes or replies. Roadmap state
belongs to each Product placement and uses `urgent`, `later`, or `undecided`, plus rank, visibility,
and archived state. Release translations contain localized body text; the Release version is the
heading. Resolve the linked Items before publishing because publication archives those Items from the
roadmap.

Use `list_developer_posts`/`get_developer_post`, `list_items`/`get_item`, and
`list_releases`/`get_release` for exact selection. Draft creation uses the corresponding create tool.
Edits, placement changes, publication state, and deletions use the corresponding update, publication,
translation, or delete tool and follow the risk marker the server advertises. `create_release` and
`update_release` are protected because they may publish or archive linked Items.

For App Store import, read or configure the Product's binding with an explicit numeric App Store ID,
two-letter storefront, and BCP-47 locale. Never infer locale from storefront. Use
`preview_latest_app_store_release` for inspection. `import_latest_app_store_release` creates a draft
or adds a missing translation and does not overwrite an existing translation.

For a publication, public edit, placement change, protected translation, import, or deletion, prefer
native MCP elicitation. If the client cannot elicit and the tool returns `confirmation_required`,
show the exact target, text, locale, Item-archive effect, and public availability change; wait for
explicit approval; then repeat the same operation with identical arguments plus `confirm: true`.
Never use a confirmation identifier. If current state differs from the reviewed state, reread it and
obtain fresh approval. Never retry a mutation automatically.
