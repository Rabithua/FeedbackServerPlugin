---
name: configure-notifications
description: Inspect or configure FeedbackServer 2.0 Bark and Product webhook notifications, test delivery, retry failed deliveries, and review delivery history. Use for notifications, Bark, webhook endpoints, signing secrets, or delivery failures. Do not use for ordinary feedback replies.
---

# Configure FeedbackServer 2.0 notifications

Resolve the Product explicitly with `list_products` or `get_product`. Read masked configuration and
delivery history before changing it. A Bark device key or webhook signing secret may appear only as
the selected tool parameter; never repeat it in chat, previews, results, logs, or summaries. A masked
result proves only that a value is stored.

Use `get_global_bark_config`, `get_product_bark_config`, and `list_bark_deliveries` for Bark reads;
use `get_product_webhook_config` and `list_webhook_deliveries` for webhook reads. Configuration,
`update_global_bark_config`, `update_product_bark_config`, `update_product_webhook_config`,
`test_bark_channel`, `test_product_webhook`, `retry_bark_delivery`, and `retry_webhook_delivery` can
change or contact an external system. A webhook endpoint must be controlled by the Product owner.

For a tool marked risky, prefer native MCP elicitation. If the client cannot elicit and the tool
returns `confirmation_required`, show the redacted endpoint, event, Product, and delivery effect,
wait for explicit approval, then repeat the same operation with identical arguments plus
`confirm: true`. Never use a confirmation identifier, expose a supplied secret, or automatically
retry delivery. After configuration, persist the matching Product onboarding choice with
`set_notification_setup_preference` when it is still unresolved.
