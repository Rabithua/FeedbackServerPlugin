---
name: configure-notifications
description: Inspect or configure FeedbackServer Bark and Product Webhook notifications, test delivery, retry failed deliveries, and review delivery history. Use when the user mentions notifications, Bark, webhook endpoints, signing secrets, or outbox delivery. Do not use for ordinary feedback replies.
---

# Configure FeedbackServer notifications

Resolve the Product explicitly. Read masked configuration and delivery history before changing it.
A Bark device key or Webhook signing secret may appear only as the selected tool parameter; never
repeat it in chat, previews, results, logs, or summaries. Treat a masked result only as evidence
that a secret is stored.

Configuration, test delivery, and failed-delivery retry are protected because they can change an
external system or send a notification. Show the redacted endpoint/event/effect preview, wait for
explicit approval, then call `execute_confirmation` with the returned ID. Do not automatically
retry delivery. A Webhook endpoint must be controlled by the Product owner.
