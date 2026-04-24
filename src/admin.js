import readline from 'readline';
import { runAgent } from './agent.js';

const SYSTEM_PROMPT = `You are an expert Minecraft server administrator assistant with full RCON access.

You can execute any server command, check player status, and send messages in-game.
When given a natural language instruction, determine the appropriate Minecraft command(s) and execute them.

Available actions:
- run_command: Execute any Minecraft server command (without leading slash)
- list_players: See who is currently online
- send_message: Broadcast a formatted message to all players

Command reference examples:
- Player management: kick <name> [reason], ban <name> [reason], pardon <name>, op <name>, deop <name>
- Teleportation: tp <player> <x> <y> <z>, tp <player1> <player2>
- Items: give <player|@a|@e> <item> [count]
- World: time set <day|night|0-24000>, weather <clear|rain|thunder>
- Game rules: gamerule <rule> <value> (e.g. keepInventory true, mobGriefing false)
- Difficulty: difficulty <peaceful|easy|normal|hard>
- Effects: effect give <player> <effect> [duration] [amplifier]
- Server: say <message>, whitelist <add|remove|list>, stop

After executing commands, report what you did and include any server response.
If a request is unclear or potentially destructive, ask for confirmation before proceeding.`;

/**
 * Interactive REPL mode: type natural language, Claude executes RCON commands.
 * @param {import('./rcon.js').RconClient} rcon
 * @param {string} model
 */
export async function runAdminMode(rcon, model) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on('SIGINT', () => rl.close());

  console.log('\n=== Admin Mode ===');
  console.log('Enter natural language commands to control the server.');
  console.log('Type "exit" to quit.\n');

  await new Promise((resolve) => {
    const prompt = () => {
      rl.question('> ', async (input) => {
        const trimmed = input.trim();

        if (trimmed === 'exit') {
          rl.close();
          resolve();
          return;
        }

        if (!trimmed) {
          prompt();
          return;
        }

        try {
          const reply = await runAgent({
            systemPrompt: SYSTEM_PROMPT,
            userMessage: trimmed,
            rcon,
            model,
            onToolUse: (tool, toolInput, result) => {
              const inputStr = tool === 'run_command' ? toolInput.command
                : tool === 'send_message' ? toolInput.message
                : '';
              console.log(`  [${tool}${inputStr ? ': ' + inputStr : ''}] → ${result}`);
            },
          });
          if (reply) console.log(`\n${reply}\n`);
        } catch (err) {
          console.error(`Error: ${err.message}\n`);
        }

        prompt();
      });
    };

    rl.on('close', resolve);
    prompt();
  });
}
