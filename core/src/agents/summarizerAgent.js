/**
 * Example agent: Summarizer
 * --------------------------
 * This is what an ".agent" package looks like in code form, before we build
 * the real packaging/signing format. Every agent exports:
 *   - manifest: static metadata + declared permissions
 *   - run(input, ctx): the actual work. `ctx` gives access to permission
 *     checks and to the shared AI provider — the agent never touches the
 *     filesystem or network directly, only through ctx, so the core can
 *     enforce permissions centrally.
 */

const { complete } = require("../aiProvider");

module.exports = {
  manifest: {
    id: "summarizer",
    name: "Summarizer Agent",
    version: "0.1.0",
    description: "Reads a block of text and produces a short summary.",
    permissions: [], // needs no filesystem/internet access beyond the shared AI provider
  },

  async run(input, ctx) {
    ctx.log("Summarizer started");
    if (!input || typeof input.text !== "string") {
      throw new Error('Expected input of the form { text: "..." }');
    }
    const result = await complete(
      `Summarize the following text in 2-3 sentences:\n\n${input.text}`
    );
    ctx.log("Summarizer finished");
    return { summary: result };
  },
};
