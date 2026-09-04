# Changelog

## 2.0.0 - 2026-09-04

- Adopt FeedbackServer 2.0 browser OAuth through Better Auth, with magic-link sign-in and `whoami`
  as the connected-account check.
- Make invitation onboarding depend only on the supplied `mcp_server` and `account_email` values.
- Replace ticket-based confirmations with native MCP elicitation or an identical operation repeated
  with `confirm: true` after explicit approval.
- Keep explicitly requested Feedback status, visibility, and reply writes direct, while other
  tool-marked destructive, public-content, account-access, key, and external-delivery operations
  remain protected.
- Rewrite every skill, document, validator, and eval for the v2 Product and tool workflow.

Release history before the 2.0 breaking cutover remains available in the GitHub Releases page.
