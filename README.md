# FeedbackKit Agent Plugin 2.0

FeedbackKit connects Codex and Claude Code to the hosted FeedbackServer 2.0 MCP for Product setup,
feedback triage, waitlists, roadmaps, Releases, notifications, analytics, and account administration.
This is a 2.0-only, runtime-free plugin: it ships Skills and remote MCP metadata, not a local server,
CLI, Bun dependency, token store, or JavaScript bundle.

## Install

Codex:

```bash
codex plugin marketplace add Rabithua/FeedbackServerPlugin --ref main
codex plugin add feedback-server@feedback-server
```

Claude Code:

```bash
claude plugin marketplace add Rabithua/FeedbackServerPlugin
claude plugin install feedback-server@feedback-server --scope user
```

Both hosts connect to `https://api.feedkit.cn/mcp` over Streamable HTTP. Business tools require an
OAuth access token; only the OAuth discovery metadata and browser sign-in surface are public.

## Browser OAuth and magic-link sign-in

Call `whoami` as the first protected tool. If the host is not connected, that call starts its OAuth
2.1 authorization-code flow and FeedbackServer uses Better Auth to open the FeedbackKit login page.
Enter the account email in that browser, open the
one-time sign-in link delivered to the same inbox, return to the browser flow, and approve the
requested access. Never paste the emailed link or an OAuth token into the Agent conversation.

An invitation gives the Agent only these setup values:

```text
mcp_server: https://api.feedkit.cn/mcp
account_email: person@example.com
```

The Agent connects to `mcp_server`; the user signs in as `account_email` in the browser. A live
invitation for that address is applied during first sign-in. There is no separate Agent-side account
linking step. When the host reports that OAuth completed, the Agent calls `whoami` and verifies the
returned email before doing any Product work.

## Product setup

After `whoami`, the Agent calls `list_products`:

- If there are no Products, it asks for the App name, platform, default locale, and an explicit
  notification choice (`bark`, `webhook`, or `deferred`), derives a readable slug, and calls
  `create_product` with that choice in `notificationSetupPreference`.
- If there is one Product, it confirms that Product is the requested target and reads its current
  settings. If there are several, it asks the user to select one and never guesses an ID.
- If a Product still has `notificationSetupPreference: "unresolved"`, it collects the missing choice
  and saves it with `set_notification_setup_preference` before claiming onboarding is complete.
- Bark and webhook choices continue through the matching notification tools. Apple project changes
  require an explicit project/file target and approval before the Agent edits the App, then a focused
  build verifies the SDK integration.

The plugin does not use a separate onboarding-status tool. Current identity, Product records,
subscription limits, and notification configuration are the source of truth.

## Confirmation contract

An explicit request to change a Feedback record's status or visibility, or to send a specified
Feedback reply, authorizes that exact `update_feedback` or `reply_to_feedback` call without another
chat confirmation. Read-only review, drafting, planning, and previewing do not authorize a write.

Other tools marked as risky use the FeedbackServer 2.0 contract:

1. Prefer the MCP client's native elicitation prompt.
2. If the client cannot elicit, the first call returns `confirmation_required`. Show the exact target,
   visible or external effect, and any redacted secret handling, then wait for explicit approval.
3. Repeat the same tool with the same arguments plus `confirm: true`. Never substitute another tool
   or change the payload during the confirmed retry.

Do not use confirmation tickets or identifiers. Do not retry a declined, failed, or stale mutation
automatically; reread current state and obtain fresh approval when the proposed effect changes.

## Security model

- OAuth credentials, magic links, sessions, API keys, Bark device keys, and webhook signing secrets
  never belong in Agent output, repository files, commands, logs, or summaries.
- Resolve Product and entity IDs with list/get tools before mutation. Never infer ownership or
  subscription access.
- Private feedback context, internal notes, diagnostic artifacts, and waitlist email addresses remain
  private unless the user's task specifically requires them.
- Other tool-marked public-content, destructive, account-access, key, and external-delivery
  operations follow the v2 confirmation contract above.

See [English invitation onboarding](docs/invited-admin-onboarding.en.md),
[中文邀请接入说明](docs/invited-admin-onboarding.zh-Hans.md), and
[generic remote MCP configuration](docs/generic-mcp.md).

## Validate

No package installation or local runtime is required:

```bash
npm run check
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/feedback-server
python3 /path/to/skill-creator/scripts/quick_validate.py plugins/feedback-server/skills/setup-feedback-server
claude plugin validate --strict .
```

The distribution validator checks every manifest version, every skill and eval, the v2 setup and
confirmation vocabulary, and the absence of retired setup/tool guidance. The sensitive-content scan
also rejects committed personal access tokens, browser sessions, bearer JWTs, and live magic links.

The Codex `.app.json` will be added only after OpenAI assigns a production connector ID. Until then,
Codex and Claude Code use the checked remote HTTP MCP descriptor.
