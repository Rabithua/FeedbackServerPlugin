# FeedbackServer invited-administrator onboarding

You received a time-limited, single-use FeedbackServer administrator invitation. Give the complete
invitation message to Codex or Claude Code so the Agent can install FeedbackServer Plugin and
prepare the exact command from the installed bundle. Run the final `accept-invite` command yourself
in a visible interactive terminal because it asks for a hidden new password.

Never paste an administrator password, verification code, PAT, or refresh token into chat, source
control, tickets, screenshots, or shared documents.

## What the invitation creates

Acceptance creates an independent ordinary `admin` account, applies the Free/Solo/Studio grant
shown in the invitation, and configures a local Agent credential. The emailed recipient address is
bound to the new account as verified. The account initially owns no Products and cannot see the
inviter's Products. Invitation expiry and a paid subscription term are separate; a fixed paid term
starts only when the invitation is accepted.

## 1. Install the plugin

For Codex, inspect existing state first:

```bash
codex plugin marketplace list --json
codex plugin list --json
```

Add the marketplace only when absent; otherwise upgrade it. Install the plugin only when absent:

```bash
codex plugin marketplace add Rabithua/FeedbackServerPlugin --ref main
codex plugin marketplace upgrade feedback-server
codex plugin add feedback-server@feedback-server
```

For Claude Code, use `claude plugin marketplace list` and `claude plugin list`, then add or update
the `feedback-server` marketplace and install or update
`feedback-server@feedback-server --scope user`. Start a new Codex task after installation/upgrade,
or run `/reload-plugins` in Claude Code.

## 2. Accept the invitation

Paste the complete invitation message into the Agent task. The Agent asks for your username and
display name, then uses `prepare_local_setup` to produce a command from the installed bundle. Do
not clone a repository or guess a plugin-cache path.

Run that exact command in your own visible terminal. The CLI hides the new password and confirms it,
accepts the invitation, verifies login and subscription state, creates a 365-day scoped Agent PAT,
stores it in macOS Keychain, and logs out temporary sessions.

If another FeedbackServer profile is already active, the CLI shows its non-secret identity and
asks whether to keep or switch. `keep` is the default and does not consume the invitation. An
explicit `switch` affects all FeedbackServer-enabled Codex and Claude sessions on that Mac and
revokes the former Agent PAT.

## 3. Finish app setup

Return to the same Agent task and send:

```text
Help me finish FeedbackServer setup
```

The Agent reads live onboarding state one step at a time. Run `feedback-server doctor` for a
read-only connection and configuration check. An empty Product list is normal for a new account;
create the first Product for the app you own.

## Recovery

- If the invitation is expired, revoked, or already accepted, ask the inviter for a new one.
- If account creation committed but local Agent configuration failed, do not reuse the invitation;
  run `feedback-server agent configure` with the new username.
- Bind or change email with `feedback-server admin email bind` in a visible terminal.
- Recover a password with `feedback-server admin password-reset`. The reset changes only the
  password; existing sessions, PATs, and Passkeys remain valid by Server policy.

Named Keychain profiles are global to the Mac rather than repository-local. Environment-based
credentials take priority and have no active Keychain profile.
