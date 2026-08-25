# Join FeedbackKit with your Agent

1. Paste the complete FeedbackKit invitation Prompt into Codex or Claude Code.
2. The Agent installs or upgrades the trusted `Rabithua/FeedbackServerPlugin` plugin.
3. In the same task, the Agent locates the installed bundle and runs its `feedbackkit accept-invite`.
4. The one-time token may stay in the current Agent conversation. The Agent passes it through stdin,
   consumes it immediately, and never repeats it in arguments, shell history, logs, or output.
5. The CLI checks the native credential store, creates your verified-email account, enables Free,
   saves the Agent credential, and confirms storage to the Server.
6. The Agent asks for your App name, Apple platform, default language, and target App again.
7. After you confirm the slug, it creates the Product and asks you to choose Bark, Product Webhook,
   or explicitly defer notification setup. It saves that choice on the Product so later tasks do not
   ask again. Before Apple project changes it shows the files it will
   touch and asks for approval, then integrates the SDK, builds, and runs Doctor.

Invitations expire after seven days and can be used once. A retry from the same enrollment can
recover an interrupted credential for 15 minutes; another enrollment cannot replay the invitation.
If another local account exists, choose keep, add a named profile, or replace before acceptance.

Your FeedbackKit account has no username, password, Passkey, or browser login. On another device,
ask the Agent to log in, then reply directly with the six-digit email code. The plugin creates and
stores a new PAT in macOS Keychain, Windows Credential Manager, or Linux Secret Service without
returning it to the Agent. There is no plaintext fallback.
