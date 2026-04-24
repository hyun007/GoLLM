import fs from 'fs';
import readline from 'readline';
import { Client as SshClient } from 'ssh2';

// Matches vanilla Minecraft chat: [HH:MM:SS] [Server thread/INFO]: <PlayerName> message
const CHAT_PATTERN = /^\[\d{2}:\d{2}:\d{2}\] \[Server thread\/INFO\][^:]*: <([^>]+)> (.+)$/;

// Strip ANSI escape codes that Docker or the terminal emulator may inject
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Parse a log line for a player chat message.
 * @param {string} line
 * @returns {{ player: string, message: string } | null}
 */
export function parseChatLine(line) {
  const clean = line.replace(ANSI_PATTERN, '').trim();
  const match = CHAT_PATTERN.exec(clean);
  if (!match) return null;
  return { player: match[1], message: match[2] };
}

/**
 * Watch a local Minecraft log file for new chat messages (poll-based).
 * @param {string} logPath
 * @param {(chat: { player: string, message: string }) => void} onChat
 * @returns {() => void} Stop function
 */
export function watchLocalLog(logPath, onChat) {
  let cursor = 0;
  try {
    cursor = fs.statSync(logPath).size;
  } catch {
    // file may not exist yet
  }

  const timer = setInterval(() => {
    try {
      const stat = fs.statSync(logPath);
      if (stat.size <= cursor) return;

      const stream = fs.createReadStream(logPath, { start: cursor, end: stat.size - 1 });
      cursor = stat.size;

      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const chat = parseChatLine(line);
        if (chat) onChat(chat);
      });
    } catch {
      // ignore transient errors (log rotation, etc.)
    }
  }, 1000);

  return () => clearInterval(timer);
}

/**
 * Watch a Docker container's logs over SSH for new chat messages.
 * SSHes to the Docker host and runs `docker logs --follow --tail 0 <container>`.
 * Works with containers that don't have sshd (binhex/arch-minecraftserver, etc.).
 *
 * @param {{
 *   host: string, port?: number, username: string,
 *   privateKey?: string,  // local path to private key file
 *   password?: string
 * }} sshConfig
 * @param {string} containerName  Docker container name or ID
 * @param {(chat: { player: string, message: string }) => void} onChat
 * @returns {() => void} Stop function
 */
export function watchDockerLog(sshConfig, containerName, onChat) {
  const conn = new SshClient();
  let stopped = false;

  conn.on('ready', () => {
    console.log(`SSH ready — streaming logs from container: ${containerName}`);

    // --tail 0: skip historical lines, only stream new output
    // 2>&1: merge stderr so we catch logs regardless of which fd Docker uses
    const cmd = `docker logs --follow --tail 0 ${containerName} 2>&1`;

    conn.exec(cmd, (err, stream) => {
      if (err) {
        console.error('SSH exec error:', err.message);
        return;
      }

      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const chat = parseChatLine(line);
        if (chat) onChat(chat);
      });

      stream.on('close', (code) => {
        if (!stopped) {
          console.error(`Docker log stream closed (exit ${code}). Restart to reconnect.`);
        }
      });
    });
  });

  conn.on('error', (err) => {
    console.error('SSH error:', err.message);
  });

  const connectOpts = {
    host: sshConfig.host,
    port: sshConfig.port ?? 22,
    username: sshConfig.username,
    readyTimeout: 10_000,
  };

  if (sshConfig.privateKey) {
    connectOpts.privateKey = fs.readFileSync(sshConfig.privateKey);
  } else if (sshConfig.password) {
    connectOpts.password = sshConfig.password;
  }

  conn.connect(connectOpts);
  console.log(`SSH: connecting to ${sshConfig.username}@${sshConfig.host}:${connectOpts.port}`);

  return () => {
    stopped = true;
    conn.end();
  };
}
