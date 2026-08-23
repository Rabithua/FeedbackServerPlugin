# Changelog

All notable changes to FeedbackServer Plugin are documented here.

## 0.9.0 - 2026-08-24

- Add global named Keychain profiles with resumable migration of the legacy default pointer.
- Split FeedbackServer guidance into six focused Skills plus a compatibility router.
- Add single-use `execute_confirmation` execution while retaining the legacy confirmation protocol through 1.0.
- Return request IDs, Retry-After guidance, remediation, semantic parameter descriptions, and calibrated tool annotations.
- Add Claude Code routing evals for setup, triage, waitlists, publishing, errors, profiles, and negative triggers.

## 0.8.0 - 2026-08-24

- Accept FeedbackKit 0.2's fixed endpoint, bundle-derived visitor Keychain service, and follow-host language defaults in `doctor`.
- Add credential-free `prepare_local_setup` commands from the installed plugin bundle.
- Make Codex and Claude Code installation, upgrade, reload, and invitation handoff instructions host-specific.
- Use Claude Code's canonical root `.mcp.json` and expose waitlist discovery metadata.

## 0.7.0 - 2026-08-23

- Add owner-scoped FeedbackKit waitlist management tools and Agent PAT scopes.

Earlier release notes remain available in the GitHub Releases history.
