import { Rcon } from 'rcon-client';

export class RconClient {
  constructor({ host, port, password }) {
    this.host = host;
    this.port = parseInt(port, 10);
    this.password = password;
    this._client = null;
  }

  async connect() {
    this._client = await Rcon.connect({
      host: this.host,
      port: this.port,
      password: this.password,
    });
    console.log(`Connected to RCON at ${this.host}:${this.port}`);
  }

  async send(command) {
    if (!this._client) throw new Error('RCON not connected');
    return await this._client.send(command);
  }

  async disconnect() {
    if (this._client) {
      await this._client.end();
      this._client = null;
    }
  }
}
