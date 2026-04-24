import OpenAI from 'openai';

let _client = null;

function getClient() {
  if (!_client) {
    _client = new OpenAI({
      baseURL: process.env.LLM_BASE_URL ?? 'http://localhost:8080/v1',
      apiKey: process.env.LLM_API_KEY ?? 'none',
    });
  }
  return _client;
}

// OpenAI-compatible tool definitions (llama.cpp, Ollama, vLLM, etc.)
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: `Execute any Minecraft server console command via RCON and return the server's response.
Use for: gamemode, difficulty, gamerule, kick, ban, op, deop, tp, give, time set, weather, fill,
setblock, effect, enchant, experience, seed, whitelist, scoreboard, title, and any other command.
Do NOT include the leading slash.`,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The Minecraft command without the leading slash. Examples: "say Hello", "time set day", "give @a diamond_sword"',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_players',
      description: 'Get the number of online players and their names.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: `Send a formatted chat message visible to all players using tellraw.
Use this to respond to players, make announcements, share tips, or communicate as the server AI.
Players will see the message in the chat with your chosen color.`,
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The message text to display to all players',
          },
          color: {
            type: 'string',
            description: 'Text color: aqua, gold, green, red, yellow, white, gray, blue, light_purple, dark_green, dark_red, dark_aqua, dark_blue, dark_purple, dark_gray, black',
          },
        },
        required: ['message'],
      },
    },
  },
];

/**
 * Execute a tool call against the RCON server.
 * @param {string} name
 * @param {object} input
 * @param {import('./rcon.js').RconClient} rcon
 * @returns {Promise<string>}
 */
async function executeTool(name, input, rcon) {
  switch (name) {
    case 'run_command':
      return (await rcon.send(input.command)) || '(no output)';

    case 'list_players':
      return await rcon.send('list');

    case 'send_message': {
      const color = input.color ?? 'white';
      const json = JSON.stringify({ text: input.message, color });
      const result = await rcon.send(`tellraw @a ${json}`);
      return result || '(message sent)';
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Run an LLM agent loop with RCON tool access.
 * Compatible with llama.cpp, Ollama, vLLM, and any OpenAI-compatible endpoint.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {import('./rcon.js').RconClient} opts.rcon
 * @param {string} opts.model
 * @param {number} [opts.maxTokens=1024]
 * @param {(tool: string, input: object, result: string) => void} [opts.onToolUse]
 * @returns {Promise<string>} Final text response
 */
export async function runAgent({ systemPrompt, userMessage, rcon, model, maxTokens = 1024, maxIterations = 10, onToolUse }) {
  const client = getClient();

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      tools: TOOLS,
      tool_choice: 'auto',
      messages,
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;
    messages.push(assistantMessage);

    if (choice.finish_reason !== 'tool_calls' || !assistantMessage.tool_calls?.length) {
      return assistantMessage.content ?? '';
    }

    // Execute each tool call and collect results
    for (const toolCall of assistantMessage.tool_calls) {
      let result;
      let input;
      try {
        input = JSON.parse(toolCall.function.arguments);
        result = String(await executeTool(toolCall.function.name, input, rcon));
      } catch (err) {
        input = {};
        result = `Error: ${err.message}`;
      }

      if (onToolUse) onToolUse(toolCall.function.name, input, result);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result.length > 400 ? result.slice(0, 400) + '…' : result,
      });
    }
  }
}
