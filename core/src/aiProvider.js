/**
 * aiProvider
 * ----------
 * Thin wrapper so agents don't call OpenAI/Anthropic/etc. directly.
 * If no API key is configured, falls back to a deterministic mock —
 * this means a fresh clone of the repo runs end-to-end immediately,
 * with zero setup, which matters a lot for a "few clicks and it works"
 * consumer product.
 */

async function complete(prompt) {
  const apiKey = process.env.AIGENTOS_LLM_API_KEY;

  if (!apiKey) {
    // Mock mode — no key configured yet.
    return (
      `[mock response — set AIGENTOS_LLM_API_KEY to use a real model]\n` +
      `Summary of input (${prompt.length} chars): ` +
      prompt.slice(0, 140).replace(/\s+/g, " ") +
      (prompt.length > 140 ? "..." : "")
    );
  }

  // Real call — using Anthropic's Messages API as the default provider.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM provider error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.content?.map((b) => b.text || "").join("\n") ?? "";
}

module.exports = { complete };
