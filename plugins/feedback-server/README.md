# FeedbackKit plugin bundle

This directory is the installable FeedbackKit Agent plugin. `bin/feedbackkit` loads the bundled CLI;
`dist/server.mjs` is the MCP server. The public passwordless onboarding commands are:

```bash
feedbackkit accept-invite
feedbackkit login email request --email owner@example.com
feedbackkit login email complete --request <uuid>
feedbackkit onboarding status
feedbackkit product create --name "My App" --platform ios
feedbackkit doctor --product <uuid> --app-path /absolute/path
```

Invitation tokens and email codes are accepted through stdin or ordinary TTY input. They may come
from the current Agent conversation and are consumed immediately. Long-lived credentials are stored in
macOS Keychain, Windows Credential Manager, or Linux Secret Service through the native keyring
backend. No password or plaintext-file fallback exists.

Run `bun run check` from this directory to typecheck, lint, test, build, and smoke-test the bundle.
