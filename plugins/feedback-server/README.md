# FeedbackKit plugin bundle

This directory is the installable FeedbackKit Agent plugin. `bin/feedbackkit` loads the bundled CLI;
`dist/server.mjs` is the MCP server. The public passwordless onboarding commands are:

```bash
feedbackkit accept-invite
feedbackkit onboarding status
feedbackkit product create --name "My App" --platform ios
feedbackkit doctor --product <uuid> --app-path /absolute/path
```

The invitation token is accepted only through stdin or hidden TTY input. Credentials are stored in
macOS Keychain, Windows Credential Manager, or Linux Secret Service through the native keyring
backend. No password or plaintext-file fallback exists.

Run `bun run check` from this directory to typecheck, lint, test, build, and smoke-test the bundle.
