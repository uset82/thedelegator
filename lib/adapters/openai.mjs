/**
 * OpenAI / Codex Adapter
 */

import { BaseAdapter } from "./base.mjs";

export class OpenAIAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, role: options.role || "builder" });
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.baseUrl = options.baseUrl || "https://api.openai.com/v1";
    this.model = options.model || "gpt-4o";
  }

  async sendTurn({ history = [], instruction = "", extraContext = "" } = {}) {
    if (!this.apiKey) {
      throw new Error("Missing OPENAI_API_KEY for OpenAIAdapter");
    }

    const systemPrompt = this.getSystemPrompt();
    const contextPrompt = this.formatContextMessages(history);

    const userContent = [
      contextPrompt ? `## Prior Dialogue:\n${contextPrompt}` : "",
      extraContext ? `## Repository & Lane Context:\n${extraContext}` : "",
      instruction ? `## Current Task:\n${instruction}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent || "Proceed with assigned work." },
      ],
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const textContent = data.choices?.[0]?.message?.content || "";

    return {
      content: textContent,
      metadata: {
        model: this.model,
        usage: data.usage,
      },
    };
  }
}
