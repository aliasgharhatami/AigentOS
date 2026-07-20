/**
 * aiProvider
 * ----------
 * The brain behind the chat layer. Deliberately provider-agnostic, because
 * the choice of model is the user's, not ours:
 *
 *   - openai / anthropic: the user supplies their own key. We never ship a
 *     shared key — one publisher key used by every installed copy would be
 *     both a runaway cost and a security hole.
 *   - ollama: a model running locally. Free, private, no key, works offline.
 *     The trade-off is hardware: small local models are noticeably weaker at
 *     the structured tool-selection this layer depends on.
 *
 * Configuration lives in settings.json next to the user's agents, written
 * through the API — never hardcoded, never committed.
 */

const PROVIDERS = {
  openai: {
    label: "OpenAI",
    needsKey: true,
    defaultModel: "gpt-4o-mini",
    async complete({ apiKey, model, system, messages, baseUrl }) {
      const res = await fetch(`${baseUrl || "https://api.openai.com/v1"}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: system ? [{ role: "system", content: system }, ...messages] : messages,
          temperature: 0.2,
        }),
      });
      if (!res.ok) {
        throw new Error(await describeHttpError(res, "OpenAI"));
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    },
  },

  anthropic: {
    label: "Anthropic",
    needsKey: true,
    defaultModel: "claude-sonnet-4-6",
    async complete({ apiKey, model, system, messages }) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model, max_tokens: 2000, system, messages }),
      });
      if (!res.ok) {
        throw new Error(await describeHttpError(res, "Anthropic"));
      }
      const data = await res.json();
      return (data.content || []).map((b) => b.text || "").join("\n");
    },
  },

  ollama: {
    label: "Local model (Ollama)",
    needsKey: false,
    defaultModel: "llama3.1",
    async complete({ model, system, messages, baseUrl }) {
      const url = `${baseUrl || "http://127.0.0.1:11434"}/api/chat`;
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages: system ? [{ role: "system", content: system }, ...messages] : messages,
            stream: false,
          }),
        });
      } catch {
        throw new Error(
          "Couldn't reach Ollama. Make sure it's installed and running (ollama.com)."
        );
      }
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 404) {
          throw new Error(
            `The model "${model}" isn't downloaded yet. Run: ollama pull ${model}`
          );
        }
        throw new Error(`Ollama error: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      return data.message?.content || "";
    },
  },
};

async function describeHttpError(res, providerLabel) {
  const text = await res.text();
  if (res.status === 401) {
    return `Your ${providerLabel} API key was rejected. Check it in Settings.`;
  }
  if (res.status === 429) {
    return `${providerLabel} is rate limiting or your account is out of credit.`;
  }
  return `${providerLabel} error (${res.status}): ${text.slice(0, 200)}`;
}

class AiProvider {
  constructor(settings = {}) {
    this.update(settings);
  }

  update(settings) {
    this.provider = settings.provider || null;
    this.model = settings.model || null;
    this.apiKey = settings.apiKey || null;
    this.baseUrl = settings.baseUrl || null;
  }

  get configured() {
    if (!this.provider) return false;
    const spec = PROVIDERS[this.provider];
    if (!spec) return false;
    return spec.needsKey ? Boolean(this.apiKey) : true;
  }

  /** Description of the current setup, safe to send to the UI (no key). */
  status() {
    const spec = PROVIDERS[this.provider];
    return {
      provider: this.provider,
      label: spec?.label,
      model: this.model || spec?.defaultModel,
      configured: this.configured,
      keySet: Boolean(this.apiKey),
      available: Object.entries(PROVIDERS).map(([id, p]) => ({
        id,
        label: p.label,
        needsKey: p.needsKey,
        defaultModel: p.defaultModel,
      })),
    };
  }

  async complete(system, messages) {
    if (!this.configured) {
      throw new Error(
        "No AI model is set up yet. Open Settings and choose a provider — your own API key, or a local model with Ollama."
      );
    }
    const spec = PROVIDERS[this.provider];
    return spec.complete({
      apiKey: this.apiKey,
      model: this.model || spec.defaultModel,
      baseUrl: this.baseUrl,
      system,
      messages,
    });
  }

  /**
   * Ask the model for JSON and parse it defensively — models often wrap JSON
   * in prose or code fences even when told not to.
   */
  async completeJson(system, messages) {
    const raw = await this.complete(system, messages);
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const start = cleaned.search(/[{[]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start === -1 || end === -1) {
      throw new Error("The model didn't return usable JSON.");
    }
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new Error("The model returned malformed JSON.");
    }
  }
}

module.exports = { AiProvider, PROVIDERS };
