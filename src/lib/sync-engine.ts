/**
 * One synchronisation round, independent of where the bytes go (fetch in the app, direct handler
 * calls in tests) and of where the data lives (local-store in the app, memory in tests).
 */

import {
  applyRemote,
  commitPush,
  diffLocal,
  type Item,
  type Kind,
  type LocalData,
  type Pending,
  type Remote,
  type SyncMeta,
} from "./sync-core";
import { DecryptError, decryptRecord, encryptRecord } from "./sync-crypto";

export interface ExchangeRequest {
  since: number;
  dev: string;
  push: { key: string; u: number; dev: string; c: string }[];
}

export interface ExchangeResponse {
  accepted: string[];
  rejected: string[];
  changes: { key: string; seq: number; u: number; dev: string; c: string }[];
  cursor: number;
  more: boolean;
}

export interface Transport {
  exchange(req: ExchangeRequest): Promise<ExchangeResponse>;
}

export interface Host {
  read(): LocalData;
  write(data: LocalData): void;
  meta: SyncMeta;
  save(): void;
  userId(): string;
  now(): number;
  validate(kind: Kind, item: Item): boolean;
}

export interface RoundResult {
  pushed: number;
  pulled: number;
  undecryptable: number;
}

const MAX_PUSH = 200;
const MAX_ROUNDS = 100;

export async function syncOnce(host: Host, transport: Transport, key: CryptoKey): Promise<RoundResult> {
  const result: RoundResult = { pushed: 0, pulled: 0, undecryptable: 0 };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const pending: Pending[] = diffLocal(host.read(), host.meta, host.now()).slice(0, MAX_PUSH);
    const push = await Promise.all(
      pending.map(async (p) => ({ key: p.key, u: p.u, dev: p.dev, c: await encryptRecord(key, p, p.payload) })),
    );
    const res = await transport.exchange({ since: host.meta.cursor, dev: host.meta.dev, push });

    commitPush(host.meta, pending, res.accepted, res.rejected);
    result.pushed += res.accepted.length;

    const remote: Remote[] = [];
    for (const c of res.changes) {
      try {
        remote.push({ key: c.key, u: c.u, dev: c.dev, payload: await decryptRecord<Item>(key, c, c.c) });
      } catch (e) {
        if (!(e instanceof DecryptError)) throw e;
        result.undecryptable++;
      }
    }
    if (res.changes.length > 0 && remote.length === 0 && result.undecryptable > 0 && host.meta.cursor === 0) {
      throw new DecryptError("This device's sync key does not match the data on the server.");
    }

    // Read AFTER the awaits so an edit made while we were talking to the server is never overwritten.
    const merged = applyRemote(host.read(), host.meta, remote, { userId: host.userId(), validate: host.validate });
    if (merged.changed) host.write(merged.data);
    result.pulled += merged.applied;
    host.meta.cursor = Math.max(host.meta.cursor, res.cursor);
    host.save();

    const progressed = res.accepted.length + res.rejected.length > 0;
    if (!res.more && !(progressed && pending.length === MAX_PUSH)) break;
  }
  return result;
}
