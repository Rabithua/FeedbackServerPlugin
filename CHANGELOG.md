# Changelog

## 1.2.1 - 2026-08-30

- Correct the only supported `authenticate` input to `{ method, value }` for both email and
  invitation authentication.
- Update skills, documentation, and evals to reject method-specific top-level input fields.
- Add distribution validation that prevents the invalid field shapes from returning.

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
