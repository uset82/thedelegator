/**
 * TheDelegator Message & Event Bus
 *
 * Provides in-memory pub/sub broadcasting and file-backed message log persistence
 * in `.delegator/messages/`.
 */

import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createMessage, validateMessage } from "./protocol.mjs";

export class MessageBus extends EventEmitter {
  /**
   * @param {Object} options
   * @param {string} [options.storageDir] - Path to `.delegator/messages/`
   * @param {boolean} [options.persist=true] - Whether to write messages to disk
   */
  constructor({ storageDir = null, persist = true } = {}) {
    super();
    this.storageDir = storageDir;
    this.persist = persist;
    this.messages = [];

    if (this.storageDir && this.persist) {
      this.initStorage();
    }
  }

  initStorage() {
    try {
      if (!existsSync(this.storageDir)) {
        mkdirSync(this.storageDir, { recursive: true });
      }
      this.loadPersistedMessages();
    } catch (err) {
      console.warn(`[bus] Could not initialize message storage in ${this.storageDir}: ${err.message}`);
    }
  }

  loadPersistedMessages() {
    if (!this.storageDir || !existsSync(this.storageDir)) return;
    try {
      const files = readdirSync(this.storageDir).filter((f) => f.endsWith(".json"));
      const loaded = [];

      for (const file of files) {
        try {
          const raw = readFileSync(join(this.storageDir, file), "utf8");
          const msg = JSON.parse(raw);
          if (validateMessage(msg).valid) {
            loaded.push(msg);
          }
        } catch {
          // ignore corrupted single message
        }
      }

      loaded.sort((a, b) => {
        const timeDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        return timeDiff !== 0 ? timeDiff : (a.id || "").localeCompare(b.id || "");
      });
      this.messages = loaded;
    } catch (err) {
      console.warn(`[bus] Failed loading persisted messages: ${err.message}`);
    }
  }

  /**
   * Publish a message to the bus.
   * @param {Object} msgOptions
   * @returns {Object} Normalized message object
   */
  publish(msgOptions) {
    const msg = msgOptions.id && msgOptions.timestamp ? msgOptions : createMessage(msgOptions);

    this.messages.push(msg);

    if (this.storageDir && this.persist) {
      try {
        const filename = `${msg.timestamp.replace(/[:.]/g, "-")}_${msg.id}.json`;
        writeFileSync(join(this.storageDir, filename), JSON.stringify(msg, null, 2), "utf8");
      } catch (err) {
        console.warn(`[bus] Failed saving message to disk: ${err.message}`);
      }
    }

    // Emit generic message event
    this.emit("message", msg);

    // Emit targeted event for receiver
    if (msg.receiver) {
      this.emit(`to:${msg.receiver}`, msg);
    }
    this.emit(`to:all`, msg);

    // Emit role/type events
    if (msg.type) this.emit(`type:${msg.type}`, msg);
    if (msg.sender) this.emit(`from:${msg.sender}`, msg);

    return msg;
  }

  /**
   * Subscribe to messages intended for a specific agent (or 'all').
   * @param {string} agentName
   * @param {Function} handler
   * @returns {Function} Unsubscribe function
   */
  subscribe(agentName, handler) {
    const listener = (msg) => {
      if (msg.receiver === agentName || msg.receiver === "all" || msg.receiver === "*") {
        handler(msg);
      }
    };
    this.on("message", listener);
    return () => this.off("message", listener);
  }

  /**
   * Retrieve message history with optional filtering.
   */
  getHistory({ limit = 100, since = null, agent = null, type = null } = {}) {
    let list = this.messages;

    if (since) {
      const sinceDate = new Date(since).getTime();
      list = list.filter((m) => new Date(m.timestamp).getTime() > sinceDate);
    }

    if (agent) {
      list = list.filter((m) => m.sender === agent || m.receiver === agent || m.receiver === "all");
    }

    if (type) {
      list = list.filter((m) => m.type === type);
    }

    return list.slice(-limit);
  }

  /**
   * Clear in-memory and disk message history.
   */
  clear() {
    this.messages = [];
    if (this.storageDir && existsSync(this.storageDir)) {
      try {
        const files = readdirSync(this.storageDir).filter((f) => f.endsWith(".json"));
        for (const file of files) {
          rmSync(join(this.storageDir, file), { force: true });
        }
      } catch (err) {
        console.warn(`[bus] Failed clearing message storage: ${err.message}`);
      }
    }
    this.emit("clear");
  }
}
