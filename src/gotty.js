import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { parseChatLine } from './logWatcher.js';

// Strip ANSI/VT escape sequences (CSI final bytes are 0x40-0x7E, i.e. @-~)
const STRIP_RE = /\x1b\[[0-9;]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[\]()]|\r/g;

const FRAME_OUTPUT = 0x31; // '1' — server→client terminal output
const FRAME_INPUT  = '1'; // '1' — client→server keystrokes ('2' is ping)

/**
 * GoTTY WebSocket client — replaces both RconClient and the SSH+docker log watcher.
 *
 * Protocol:
 *   1. Connect with Basic Auth header
 *   2. Send JSON init frame: {"Arguments":"","AuthToken":"user:pass"}
 *   3. Receive output frames: "0" + base64(terminal output)
 *   4. Send input frames:    "1" + base64(keystrokes)
 */
export class GoTTYClient extends EventEmitter {
  #basicAuth;
  #authToken;
  #ws = null;
  #buf = '';

  constructor({ host, port = 8222, username, password }) {
    super();
    this.url = `ws://${host}:${port}/ws`;
    this.#basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
    this.#authToken = `${username}:${password}`;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.#ws = new WebSocket(this.url, {
        headers: { Authorization: `Basic ${this.#basicAuth}` },
      });

      this.#ws.once('open', () => {
        this.#ws.send(JSON.stringify({ Arguments: '', AuthToken: this.#authToken }));
        // Resize to wide terminal so long commands don't wrap and execute prematurely
        this.#ws.send('3' + JSON.stringify({ Columns: 250, Rows: 50 }));
        resolve();
      });

      this.#ws.on('message', (data) => this.#onMessage(data));
      this.#ws.on('error', (err) => { this.emit('error', err); reject(err); });
      this.#ws.on('close', (code, reason) => this.emit('close', code, reason));
    });
    console.log(`GoTTY connected: ${this.url}`);
  }

  #onMessage(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const debug = process.env.DEBUG_GOTTY === '1';

    if (debug) {
      console.log(`[gotty raw] type=${buf[0]} (0x${buf[0].toString(16)}) len=${buf.length} data=${buf.slice(0, 80).toString('base64')}`);
    }

    if (buf[0] !== FRAME_OUTPUT) return;

    const text = Buffer.from(buf.slice(1).toString(), 'base64').toString('utf8').replace(STRIP_RE, '');

    if (debug) console.log(`[gotty text] ${JSON.stringify(text)}`);

    this.#buf += text;

    const lines = this.#buf.split('\n');
    this.#buf = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim()) this.emit('line', line.trim());
    }
  }

  /**
   * Send a server console command and collect output for 400 ms.
   * Drop-in replacement for RconClient.send().
   * @param {string} command  Console command without leading slash
   * @returns {Promise<string>}
   */
  async send(command) {
    const collected = [];
    const onLine = (line) => collected.push(line);
    this.on('line', onLine);

    this.#ws.send(FRAME_INPUT + command + '\n');

    await new Promise((r) => setTimeout(r, 400));
    this.off('line', onLine);

    return collected.join('\n'); // empty string lets callers fall back to '(ok)'
  }

  /**
   * Returns a watcher factory compatible with chatbot.js / runChatbotMode().
   * @returns {(onChat: (chat: {player: string, message: string}) => void) => () => void}
   */
  buildWatcher() {
    return (onChat) => {
      const handler = (line) => {
        const chat = parseChatLine(line);
        if (chat) onChat(chat);
      };
      this.on('line', handler);
      return () => this.off('line', handler);
    };
  }

  async disconnect() {
    this.#ws?.close();
  }
}
