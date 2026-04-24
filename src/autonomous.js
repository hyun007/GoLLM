import { runAgent } from './agent.js';

const SYSTEM_PROMPT = `You are an autonomous Minecraft server manager running periodic health checks and player engagement tasks.

On each tick you should:
1. Check who is online with list_players
2. Based on the results, take ONE OR TWO helpful, non-intrusive actions

Good autonomous actions:
- Welcome players who are online (use send_message with gold color)
- Share a useful Minecraft tip (aqua color)
- Set pleasant time/weather if the server is active
- Announce interesting in-game events or mini-challenges
- Check and fix game rules that affect player experience
- Set up small surprises (a brief event, a fun gamerule toggle, etc.)

Rules:
- At most 2 player-visible actions per tick to avoid spam
- Skip sending messages if no players are online
- Keep player messages SHORT and friendly
- End your response with a brief summary of what you did and why`;

/**
 * Autonomous mode: Claude periodically checks server state and takes actions.
 * @param {import('./rcon.js').RconClient} rcon
 * @param {string} model
 * @param {number} intervalMs
 */
export async function runAutonomousMode(rcon, model, intervalMs = 60_000) {
  console.log('\n=== Autonomous Mode ===');
  console.log(`Ticking every ${intervalMs / 1000}s. Press Ctrl+C to stop.\n`);

  let running = true;
  let tickTimer = null;

  const tick = async () => {
    if (!running) return;

    const now = new Date().toLocaleTimeString();
    console.log(`[${now}] Tick...`);

    try {
      const summary = await runAgent({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: `Perform your periodic server check. Wall clock time: ${new Date().toISOString()}`,
        rcon,
        model,
        maxTokens: 2048,
        onToolUse: (tool, toolInput, result) => {
          const preview = tool === 'run_command' ? toolInput.command
            : tool === 'send_message' ? toolInput.message
            : '';
          console.log(`  [${tool}${preview ? ': ' + preview : ''}] → ${result}`);
        },
      });
      if (summary) console.log(`  → ${summary}\n`);
    } catch (err) {
      console.error(`  Tick error: ${err.message}\n`);
    }

    if (running) {
      tickTimer = setTimeout(tick, intervalMs);
    }
  };

  tick();

  return new Promise((resolve) => {
    process.once('SIGINT', () => {
      running = false;
      if (tickTimer) clearTimeout(tickTimer);
      console.log('\nStopping autonomous agent...');
      resolve();
    });
  });
}
