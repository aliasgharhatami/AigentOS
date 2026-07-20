/**
 * PermissionManager
 * ------------------
 * Every agent must DECLARE which permissions it needs (e.g. "filesystem:read",
 * "internet", "clipboard"). Nothing is auto-granted. The desktop shell (or any
 * future shell) is responsible for showing the user a prompt and calling
 * grant()/deny() based on the human's choice.
 *
 * This keeps the trust boundary inside the core, not the UI — so a malicious
 * or buggy shell can never silently grant itself more access than the user
 * approved.
 */

class PermissionManager {
  constructor() {
    // agentId -> Set of granted permission strings
    this.grants = new Map();
    // agentId -> Set of permissions the agent has *declared* it needs
    this.declarations = new Map();
  }

  declare(agentId, permissions = []) {
    this.declarations.set(agentId, new Set(permissions));
    if (!this.grants.has(agentId)) {
      this.grants.set(agentId, new Set());
    }
  }

  grant(agentId, permission) {
    const declared = this.declarations.get(agentId);
    if (!declared || !declared.has(permission)) {
      throw new Error(
        `Refusing to grant undeclared permission "${permission}" to agent ${agentId}. ` +
        `Agents can only be granted permissions they declared up front.`
      );
    }
    if (!this.grants.has(agentId)) this.grants.set(agentId, new Set());
    this.grants.get(agentId).add(permission);
  }

  revoke(agentId, permission) {
    this.grants.get(agentId)?.delete(permission);
  }

  has(agentId, permission) {
    return this.grants.get(agentId)?.has(permission) ?? false;
  }

  // What the agent asked for vs. what it currently has — used by the UI
  // to render the permission prompt / the Task Manager panel.
  getStatus(agentId) {
    const declared = [...(this.declarations.get(agentId) || [])];
    const granted = [...(this.grants.get(agentId) || [])];
    return {
      agentId,
      declared,
      granted,
      pending: declared.filter((p) => !granted.includes(p)),
    };
  }
}

module.exports = { PermissionManager };
