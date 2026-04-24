import { runAgent } from './agent.js';

const SYSTEM_PROMPT = `You are a friendly AI assistant embedded in a Minecraft server chat.
Players chat with you in-game and you respond.

Rules:
- ALWAYS use send_message to respond — that's how players see your reply in-game
- Keep messages SHORT (1-2 sentences). Minecraft chat is narrow.
- Address the player by their username.
- Use gold or aqua color to distinguish your messages from player chat.
- Be helpful and upbeat.

What you can do:
- Answer Minecraft questions (crafting recipes, mechanics, tips, coordinates, etc.)
- Execute server commands when players ask politely (give items, teleport, time/weather changes)
- Share fun facts or trivia
- Help troubleshoot in-game problems

Use judgment for command requests: reasonable quality-of-life requests (give a torch, set it to day)
are fine. Don't grant requests that would ruin the game (give @a OP, etc.).`;

/**
 * Chatbot mode: watch the server log and respond to every player chat message.
 *
 * @param {import('./rcon.js').RconClient} rcon
 * @param {(onChat: (chat: { player: string, message: string }) => void) => () => void} startWatcher
 *   A function that starts watching and returns a stop function.
 *   Use watchLocalLog or watchRemoteLog from logWatcher.js, partially applied.
 * @param {string} model
 */
export async function runChatbotMode(rcon, startWatcher, model) {
  console.log('\n=== Chatbot Mode ===');
  console.log('Responding to all player chat. Press Ctrl+C to stop.\n');

  // Debounce: skip if already processing a message from the same player
  const active = new Set();

  const stop = startWatcher(async ({ player, message }) => {
    console.log(`[chat] <${player}> ${message}`);

    if (active.has(player)) {
      console.log(`  (skipped — already processing ${player})`);
      return;
    }
    active.add(player);

    try {
      await runAgent({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: `Player "${player}" said in chat: ${message}`,
        rcon,
        model,
        onToolUse: (tool, toolInput, result) => {
          const preview = tool === 'send_message' ? toolInput.message
            : tool === 'run_command' ? toolInput.command
            : '';
          console.log(`  [${tool}${preview ? ': ' + preview : ''}] → ${result}`);
        },
      });
    } catch (err) {
      console.error(`  Error responding to ${player}: ${err.message}`);
    } finally {
      active.delete(player);
    }
  });

  return new Promise((resolve) => {
    process.once('SIGINT', () => {
      stop();
      console.log('\nStopping chatbot...');
      resolve();
    });
  });
}
