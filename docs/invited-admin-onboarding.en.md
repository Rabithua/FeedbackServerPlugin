# Join FeedbackKit with your Agent

1. Paste the complete FeedbackKit invitation Prompt into Codex or Claude Code.
2. The Agent installs or upgrades the trusted `Rabithua/FeedbackServerPlugin` plugin.
3. The Agent calls anonymous `accept_invitation` with the token without repeating or logging it.
4. The Agent shows the returned ten-minute connection code and immediately retries
   `connection_status`, causing the host to open FeedbackKit OAuth once.
5. Paste the ten-character code on the OAuth page. A complete code automatically loads the invited
   email, entitlement, client, and requested scopes; it is pairing, not another identity check.
6. Review the loaded details and click **Accept and connect**. Do not enter an email or request
   another verification message.
7. The host exchanges and stores the OAuth tokens. The Agent confirms the connection, asks for the
   App details again, creates the Product, and continues SDK setup after approval.

The invitation remains unused if you close or abandon the flow. It is consumed only at final OAuth
approval. The same short-code flow works in a normal browser or isolated WebView.

For an existing account without an invitation, call a protected tool. Switch to **Email code**,
enter the email and six-digit code on the browser OAuth page, then approve. OAuth tokens remain in
the host and are never shown to the Agent or stored by the website.
