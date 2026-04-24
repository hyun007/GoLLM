import 'dotenv/config';
import { RconClient } from './src/rcon.js';
import { watchLocalLog, watchDockerLog } from './src/logWatcher.js';
import { GoTTYClient } from './src/gotty.js';
import { runAdminMode } from './src/admin.js';
import { runChatbotMode } from './src/chatbot.js';
import { runAutonomousMode } from './src/autonomous.js';

const {
  // LLM endpoint
  LLM_MODEL = 'llama3',

  // GoTTY web console (replaces both RCON and log watching when set)
  GOTTY_HOST,
  GOTTY_PORT = '8222',
  GOTTY_USER,
  GOTTY_PASSWORD,

  // RCON — supports remote hosts directly (used when GOTTY_HOST is not set)
  RCON_HOST = 'localhost',
  RCON_PORT = '25575',
  RCON_PASSWORD,

  // Chatbot log source: 'docker' or 'local' (used when GOTTY_HOST is not set)
  LOG_MODE = 'docker',

  // Docker mode: SSH to host, stream container logs
  DOCKER_CONTAINER,
  SSH_HOST,
  SSH_PORT = '22',
  SSH_USER,
  SSH_KEY_PATH,
  SSH_PASSWORD,

  // Local mode: read a log file directly
  LOG_PATH = '/opt/minecraft/logs/latest.log',

  // Autonomous mode
  AUTONOMOUS_INTERVAL = '60000',
} = process.env;

const mode = process.argv[2] || process.env.MODE;

if (!['admin', 'chatbot', 'autonomous'].includes(mode)) {
  console.error('Usage: node index.js <admin|chatbot|autonomous>');
  console.error('');
  console.error('  admin       — interactive REPL: natural language → RCON commands');
  console.error('  chatbot     — stream container logs and respond to player chat');
  console.error('  autonomous  — periodic agent that checks server state and takes actions');
  process.exit(1);
}

if (!GOTTY_HOST && !RCON_PASSWORD) {
  console.error('Error: set GOTTY_HOST (+ GOTTY_USER/GOTTY_PASSWORD) or RCON_PASSWORD in .env');
  process.exit(1);
}

/**
 * Build the watcher factory for chatbot mode based on LOG_MODE.
 * Returns a function: (onChat) => stopFn
 */
function buildRconWatcher() {
  if (LOG_MODE === 'docker') {
    if (!DOCKER_CONTAINER) {
      console.error('Error: DOCKER_CONTAINER must be set when LOG_MODE=docker');
      process.exit(1);
    }
    if (!SSH_HOST || !SSH_USER) {
      console.error('Error: SSH_HOST and SSH_USER must be set when LOG_MODE=docker');
      process.exit(1);
    }
    if (!SSH_KEY_PATH && !SSH_PASSWORD) {
      console.error('Error: SSH_KEY_PATH or SSH_PASSWORD must be set for SSH auth');
      process.exit(1);
    }
    const sshConfig = {
      host: SSH_HOST,
      port: parseInt(SSH_PORT, 10),
      username: SSH_USER,
      ...(SSH_KEY_PATH ? { privateKey: SSH_KEY_PATH } : { password: SSH_PASSWORD }),
    };
    return (onChat) => watchDockerLog(sshConfig, DOCKER_CONTAINER, onChat);
  }

  if (LOG_MODE === 'local') {
    console.log(`Watching local log: ${LOG_PATH}`);
    return (onChat) => watchLocalLog(LOG_PATH, onChat);
  }

  console.error(`Error: Unknown LOG_MODE "${LOG_MODE}". Use "docker" or "local".`);
  process.exit(1);
}

try {
  if (GOTTY_HOST) {
    // --- GoTTY mode: single WebSocket for both commands and log watching ---
    if (!GOTTY_USER || !GOTTY_PASSWORD) {
      console.error('Error: GOTTY_USER and GOTTY_PASSWORD must be set when GOTTY_HOST is set');
      process.exit(1);
    }
    const gotty = new GoTTYClient({
      host: GOTTY_HOST,
      port: parseInt(GOTTY_PORT, 10),
      username: GOTTY_USER,
      password: GOTTY_PASSWORD,
    });
    await gotty.connect();

    try {
      switch (mode) {
        case 'admin':
          await runAdminMode(gotty, LLM_MODEL);
          break;
        case 'chatbot':
          await runChatbotMode(gotty, gotty.buildWatcher(), LLM_MODEL);
          break;
        case 'autonomous':
          await runAutonomousMode(gotty, LLM_MODEL, parseInt(AUTONOMOUS_INTERVAL, 10));
          break;
      }
    } finally {
      await gotty.disconnect();
      console.log('Disconnected from GoTTY.');
    }
  } else {
    // --- RCON + SSH/local log mode ---
    const rcon = new RconClient({
      host: RCON_HOST,
      port: RCON_PORT,
      password: RCON_PASSWORD,
    });
    await rcon.connect();

    try {
      switch (mode) {
        case 'admin':
          await runAdminMode(rcon, LLM_MODEL);
          break;
        case 'chatbot':
          await runChatbotMode(rcon, buildRconWatcher(), LLM_MODEL);
          break;
        case 'autonomous':
          await runAutonomousMode(rcon, LLM_MODEL, parseInt(AUTONOMOUS_INTERVAL, 10));
          break;
      }
    } finally {
      await rcon.disconnect();
      console.log('Disconnected from RCON.');
    }
  }
} catch (err) {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
}
