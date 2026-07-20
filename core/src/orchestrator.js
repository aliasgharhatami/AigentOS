/**
 * Orchestrator
 * ------------
 * The conversational layer. A person describes what they want in their own
 * words; this works out which agents deliver it, installs them, and reports
 * exactly what the user still needs to approve or supply.
 *
 * The model's job is deliberately narrow: pick from a catalogue we hand it and
 * explain the choice. It does not invent install commands, it does not run
 * anything, and it never sees the user's credentials. Everything it proposes
 * passes back through the same install/setup/permission path a manual install
 * uses — so the chat layer can never quietly grant itself more than a person
 * clicking buttons would.
 */

const PLANNER_SYSTEM = `You help someone set up AI agents on their computer.

You will be given the person's goal and a catalogue of available agents.
Choose the smallest set of agents that accomplishes the goal. Prefer verified
agents. Do not invent agents that are not in the catalogue.

Reply with JSON only, no prose, in exactly this shape:
{
  "understood": "one sentence restating what they want, in their own words",
  "agents": [
    { "id": "catalogue-id", "why": "one short sentence on what this contributes" }
  ],
  "missing": "if nothing in the catalogue fits, explain briefly what is missing; otherwise empty string"
}`;

const CHAT_SYSTEM = `You are the assistant inside AigentOS, an operating layer that
installs and runs AI agents for ordinary people.

You have a set of installed agents with specific capabilities, listed below.
When the person asks for something:
- If an installed agent can do it, say which one and which capability, and
  what input it needs.
- If nothing installed can do it, say so plainly and suggest searching for an
  agent that can.
Be brief and concrete. Never claim to have done something you have not done.`;

class Orchestrator {
  constructor(runtime, registry, ai) {
    this.runtime = runtime;
    this.registry = registry;
    this.ai = ai;
  }

  /**
   * Stage 1: understand the goal and choose agents. Nothing is installed yet —
   * the user sees the plan and approves it. This gate is the difference
   * between an assistant and something that installs software behind your back.
   */
  async plan(goal) {
    const { results, notes } = await this.registry.searchAll(goal, 12);

    if (results.length === 0) {
      return {
        understood: goal,
        agents: [],
        missing: "No agent in the catalogue matches that yet.",
        notes,
      };
    }

    const catalogue = results.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      verified: Boolean(a.verified),
      needs: (a.setup || []).map((s) => s.label || s.name),
    }));

    let plan;
    try {
      plan = await this.ai.completeJson(PLANNER_SYSTEM, [
        {
          role: "user",
          content: `Goal: ${goal}\n\nCatalogue:\n${JSON.stringify(catalogue, null, 2)}`,
        },
      ]);
    } catch (err) {
      // Without a working model we can still be useful: fall back to the
      // ranked search results rather than failing the whole request.
      return {
        understood: goal,
        agents: results.slice(0, 3).map((a) => ({
          id: a.id,
          why: a.description,
        })),
        missing: "",
        notes: [...notes, `Ranked by keyword match — ${err.message}`],
        fallback: true,
      };
    }

    // Only keep agents that genuinely exist in what we offered.
    const byId = new Map(results.map((a) => [a.id, a]));
    const chosen = (plan.agents || []).filter((a) => byId.has(a.id));

    return {
      understood: plan.understood || goal,
      missing: plan.missing || "",
      notes,
      agents: chosen.map((choice) => {
        const entry = byId.get(choice.id);
        const installed = this.runtime.agents.has(entry.id);
        return {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          why: choice.why,
          verified: Boolean(entry.verified),
          source: entry.source,
          alreadyInstalled: installed,
          willNeed: (entry.setup || []).map((s) => ({
            name: s.name,
            label: s.label || s.name,
            type: s.type || "text",
          })),
          permissions: entry.permissions || [],
        };
      }),
    };
  }

  /**
   * Stage 2: install the approved agents. Returns, per agent, what the user
   * must still do — the setup questions and permissions. The UI turns this
   * into the click-through wizard.
   */
  async installPlan(agentIds) {
    const outcomes = [];

    for (const id of agentIds) {
      const entry = this.registry.get(id) || (await this._findOnline(id));
      if (!entry) {
        outcomes.push({ id, ok: false, error: "That agent is no longer in the catalogue." });
        continue;
      }

      try {
        if (!this.runtime.agents.has(id)) {
          const manifest = this.registry.toManifest(entry);
          await this.runtime.installManifest(manifest);
        }

        const setup = this.runtime.getSetupStatus(id);
        const permissions = this.runtime.permissions.getStatus(id);
        const dependencies = await this.runtime.checkDependencies(id);

        outcomes.push({
          id,
          ok: true,
          name: entry.name,
          needsSetup: setup.missing.map((s) => ({
            name: s.name,
            label: s.label || s.name,
            type: s.type || "text",
            help: s.help,
          })),
          needsPermissions: permissions.pending,
          missingDependencies: dependencies.missing,
          ready:
            setup.ready &&
            permissions.pending.length === 0 &&
            dependencies.satisfied,
        });
      } catch (err) {
        outcomes.push({ id, ok: false, error: String(err.message || err) });
      }
    }

    return outcomes;
  }

  async _findOnline(id) {
    const { results } = await this.registry.searchOnline(id, 20);
    return results.find((a) => a.id === id);
  }

  /**
   * Conversation against the agents the user actually has, with their real
   * capabilities in context.
   */
  async chat(messages) {
    const agents = this.runtime.listAgents();
    const capabilities = [];

    for (const agent of agents) {
      if (!agent.running) continue;
      try {
        const tools = await this.runtime.listTools(agent.id);
        capabilities.push({
          agent: agent.name,
          id: agent.id,
          can: tools.map((t) => ({
            tool: t.name,
            does: (t.description || "").slice(0, 120),
          })),
        });
      } catch {
        // An agent that won't report its tools shouldn't break the chat.
      }
    }

    const system =
      CHAT_SYSTEM +
      "\n\nInstalled agents:\n" +
      (capabilities.length
        ? JSON.stringify(capabilities, null, 2)
        : "(none running — the person may need to connect an agent first)");

    return this.ai.complete(system, messages);
  }
}

module.exports = { Orchestrator };
