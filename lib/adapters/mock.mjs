/**
 * Mock Adapter for Tests and Simulations
 */

import { BaseAdapter } from "./base.mjs";

export class MockAdapter extends BaseAdapter {
  constructor(options = {}) {
    super(options);
    this.scriptedResponses = options.responses || [];
    this.responseIndex = 0;
  }

  async sendTurn({ history = [], instruction = "" } = {}) {
    if (this.responseIndex < this.scriptedResponses.length) {
      const resp = this.scriptedResponses[this.responseIndex++];
      return typeof resp === "string" ? { content: resp } : resp;
    }

    if (this.role === "architect") {
      return {
        content: `[Architect Decision] Reviewed update for step ${history.length}. All changes verified against acceptance criteria. APROBADO.`,
        metadata: { status: "approved" },
      };
    }

    return {
      content: `[${this.name} Report] Implemented task '${instruction || "assigned work"}'. Modified files in my assigned lane. Ready for review.`,
      metadata: { status: "ready_for_review" },
    };
  }
}
