/**
 * Google Gemini Adapter
 */

import { BaseAdapter } from "./base.mjs";

export class GeminiAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({ ...options, role: options.role || "builder" });
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.model = options.model || "gemini-2.5-flash";
  }

  async sendTurn({ history = [], instruction = "", extraContext = "" } = {}) {
    if (!this.apiKey) {
      throw new Error("Missing GEMINI_API_KEY for GeminiAdapter");
    }

    const systemPrompt = this.getSystemPrompt();
    const contextPrompt = this.formatContextMessages(history);

    const userText = [
      contextPrompt ? `## Prior Conversation:\n${contextPrompt}` : "",
      extraContext ? `## Repository & Lane State:\n${extraContext}` : "",
      instruction ? `## Current Task:\n${instruction}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const payload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userText || "Acknowledge and proceed." }],
        },
      ],
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const textContent = candidate?.content?.parts?.map((p) => p.text).join("") || "";

    return {
      content: textContent,
      metadata: {
        model: this.model,
        usage: data.usageMetadata,
      },
    };
  }
}
