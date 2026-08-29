/**
 * TheDelegator Agent Auto-Join Client
 *
 * Runs inside any IDE terminal (Cursor, Claude Code, Codex, Antigravity) to
 * connect to the live chat room and receive tasks.
 */

export async function joinChatRoom({
  agentName = "cursor",
  role = "builder",
  branch = "feat/platform",
  owns = "app/**, src/components/**",
  serverUrl = "http://localhost:4141",
} = {}) {
  const cleanName = agentName.trim().toLowerCase();

  console.log(`\n⚡ Connecting ${cleanName.toUpperCase()} to TheDelegator Live Chat at ${serverUrl}...`);

  try {
    // 1. Register agent in workspace
    const regRes = await fetch(`${serverUrl}/api/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: cleanName,
        role,
        branch,
        owns: typeof owns === "string" ? owns.split(",").map((s) => s.trim()) : owns,
        title: `${agentName} IDE Agent`,
      }),
    });

    if (!regRes.ok) {
      throw new Error(`Registration failed with status ${regRes.status}`);
    }

    console.log(`✔ Registered successfully in lane: [${owns}]`);
    console.log(`📡 Listening for tasks from Claude and the team. Type your message and hit Enter to post to the chat:\n`);

    // 2. Listen to stdin to allow interactive messaging from IDE terminal
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", async (chunk) => {
      const text = chunk.trim();
      if (!text) return;
      await fetch(`${serverUrl}/api/message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Identity travels as a field. Prefixing it into the text made every
        // agent responsible for labelling itself, and the label was then just
        // prose the UI could not style or filter on.
        body: JSON.stringify({ content: text, sender: cleanName, target: "all" }),
      });
    });
  } catch (err) {
    console.error(`❌ Could not connect to TheDelegator at ${serverUrl}: ${err.message}`);
    console.error(`Make sure the server is running with: npm run chat`);
  }
}
