# Join FeedbackKit with your Agent

1. Paste the complete FeedbackKit invitation Prompt into Codex or Claude Code.
2. The Agent installs or upgrades the trusted `Rabithua/FeedbackServerPlugin` plugin.
3. The Agent invokes the OAuth2-protected `authenticate` tool. Its empty scopes list lets the host
   establish the OAuth connection without granting account access.
4. OAuth completes with the connection still unbound. The Agent calls
   `authenticate({ method: "invitation", code })`, passing the invitation code only as the tool
   input.
5. The invitation code binds the connection immediately. There is no separate browser input or
   email verification step.
6. The Agent calls `connection_status`, asks for the
   App details and an explicit Bark, Product Webhook, or defer choice, creates the Product with that
   preference, and continues SDK setup after approval.

For email authentication, the Agent instead calls `authenticate({ method: "email", email })` after
host OAuth. The result is `pending_verification`. Open the one-time link in the email; do not copy
the link back into the conversation. The Agent observes completion with `authentication_status`
before calling `connection_status`. OAuth tokens remain in the host and are never shown to the
Agent.
