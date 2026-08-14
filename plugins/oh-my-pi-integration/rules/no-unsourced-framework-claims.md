---
name: no-unsourced-framework-claims
description: "Never assert framework/library capabilities or limitations without reading actual source or docs"
condition: ["doesn't support", "doesn't have a built-in", "can't just", "plugins are created with.*baked in", "no way to", "does not support"]
scope: "text"
---

You are hallucinating framework behavior. Before claiming what a framework or library does or doesn't support, READ THE ACTUAL SOURCE CODE or docs. Use context7 MCP, read the library's source, or check real examples. Stop asserting limitations from memory — your training data may be wrong or outdated. If you're about to say a framework "doesn't support" something or a capability "doesn't exist", verify it first; unverified negative claims are a common and costly failure mode.
