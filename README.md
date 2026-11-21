# Agent Card · Harbor Bank

Give your AI agent a card, not your login. The agent holds its own key (private key never leaves the agent); the bank stores the public key bound to a mandate. Every payment is a challenge-response signature over nonce + amount + merchant. Unknown merchants are paused for your OK, declines feed a shared blocklist, every receipt carries your original request, one-tap revoke + audit log.

**Live demo:** https://mwonka.github.io/agent-card-demo/ (press Play demo)
