/**
 * Anthropic Claude Adapter
 */

import { BaseAdapter } from "./base.mjs";

export class AnthropicAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, role: options.role || "architect" });
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = options.model || "claude-3-7-sonnet-20250219";
  }

  async sendTurn({ history = [], instruction = "", extraContext = "" } = {}) {
    if (!this.apiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY for AnthropicAdapter");
    }

    const systemPrompt = this.getSystemPrompt();
    const contextPrompt = this.formatContextMessages(history);

    const userContent = [
      contextPrompt ? `## Prior Dialogue:\n${contextPrompt}` : "",
      extraContext ? `## System & Repository Context:\n${extraContext}` : "",
      instruction ? `## Current Objective:\n${instruction}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const payload = {
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent || "Proceed with current project state." }],
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const textContent = data.content
      ?.filter((b) => b.type === "text")
      ?.map((b) => b.text)
      ?.join("\n") || "";

    return {
      content: textContent,
      metadata: {
        model: this.model,
        usage: data.usage,
      },
    };
  }
}
