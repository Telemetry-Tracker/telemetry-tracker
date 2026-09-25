# Cloudflare AI crawler decision

This is a policy note. It does not change the Cloudflare zone. Applying it needs dashboard access.

## Allow (search and answer engines)

These crawlers fetch pages to answer questions or to index the site. Allow them.

- Googlebot, Bingbot, Applebot
- OAI-SearchBot and ChatGPT-User (OpenAI search and live retrieval, not the training crawl)
- PerplexityBot
- Claude-SearchBot

## Do not allow (model training and bulk scrapers)

Do not turn these on for the marketing site.

- GPTBot (OpenAI training)
- Google-Extended (Gemini training opt-out signal)
- ClaudeBot (Anthropic training; distinct from Claude-SearchBot)
- CCBot, Bytespider, Amazonbot, Meta-ExternalAgent

## Why not “allow all AI crawlers”

Cloudflare’s one-click AI crawler toggle mixes training bots with search bots. Training crawlers copy the site into model weights. Search crawlers are how answer engines cite the product. Leave the training bots blocked.
