# Changelog

## 1.2.0 - 2026-08-30

- Limit anonymous access to MCP discovery and health; the account authentication tool now starts
  host-managed OAuth with an empty scopes list.
- Separate OAuth transport connection from FeedbackKit account binding and require the Agent to use
  an explicit email or invitation discriminator.
- Make email authentication complete through a user-opened one-time link observed with
  `authentication_status`, while invitation codes bind immediately.
- Enter `connection_status`, Product creation, and notification onboarding only after account
  binding succeeds.

Earlier release notes remain available in the GitHub Releases history.
