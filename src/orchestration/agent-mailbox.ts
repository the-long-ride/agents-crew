import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentMessage } from '../domain/types.js';
import { RunStore } from '../runtime/state.js';
import { atomicJson, withDirectoryLock } from '../shared/durable-fs.js';
import { assertAgentId } from './agent-registry.js';

interface DeliveryReceipt {
  message_id: string;
  delivery: 'a2a' | 'mailbox';
  direct_error?: string;
  updated_at: string;
}

function assertMessageId(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value) || value === '.' || value === '..') {
    throw new Error(`invalid message identifier: ${value}`);
  }
}

function parseDeliveryReceipt(raw: string, expectedId: string): DeliveryReceipt {
  const value = JSON.parse(raw) as DeliveryReceipt;
  if (!value || value.message_id !== expectedId || !['a2a', 'mailbox'].includes(value.delivery)
    || typeof value.updated_at !== 'string') {
    throw new Error(`invalid delivery receipt: ${expectedId}`);
  }
  return value;
}

export class AgentMailbox {
  constructor(readonly store: RunStore) {}

  private mailboxPath(runId: string, agentId: string): string {
    assertAgentId(agentId);
    return join(this.store.runDir(runId), 'communication', `${agentId}.jsonl`);
  }

  private deliveryPath(runId: string, messageId: string): string {
    assertMessageId(messageId);
    return join(this.store.runDir(runId), 'communication', '.delivery', `${messageId}.json`);
  }

  async append(runId: string, message: AgentMessage): Promise<void> {
    const path = this.mailboxPath(runId, message.to);
    await withDirectoryLock(`${path}.lock`, async () => {
      await mkdir(dirname(path), { recursive: true });
      const file = await open(path, 'a');
      try { await file.write(`${JSON.stringify(message)}\n`); }
      finally { await file.close(); }
    });
  }

  async recordDelivery(runId: string, message: AgentMessage): Promise<void> {
    await atomicJson(this.deliveryPath(runId, message.id), {
      message_id: message.id,
      delivery: message.delivery,
      direct_error: message.direct_error,
      updated_at: new Date().toISOString(),
    } satisfies DeliveryReceipt);
  }

  async inbox(runId: string, agentId: string): Promise<AgentMessage[]> {
    await this.store.load(runId);
    const path = this.mailboxPath(runId, agentId);
    if (!existsSync(path)) return [];
    const messages = (await readFile(path, 'utf8')).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as AgentMessage);
    const receiptRoot = join(this.store.runDir(runId), 'communication', '.delivery');
    if (!existsSync(receiptRoot)) return messages;
    const receipts = new Map<string, DeliveryReceipt>();
    for (const entry of await readdir(receiptRoot)) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      receipts.set(id, parseDeliveryReceipt(await readFile(join(receiptRoot, entry), 'utf8'), id));
    }
    return messages.map((message) => {
      const receipt = receipts.get(message.id);
      return receipt ? { ...message, delivery: receipt.delivery, direct_error: receipt.direct_error } : message;
    });
  }
}
