import { DurableObject } from "cloudflare:workers";
import { RedisEngine, type Command, type Entry } from "../../telegram-bot/lib/redis-engine";

/**
 * The bot's database: a Redis-compatible engine whose keys are persisted in Durable Object storage.
 * A Durable Object handles one call at a time, so sequences such as "claim a due reminder with
 * ZREM" are atomic without any locking.
 */
export class RedisDO extends DurableObject {
  private engine = new RedisEngine();

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.blockConcurrencyWhile(async () => {
      this.engine.load(await ctx.storage.list<Entry>());
    });
  }

  private async persist(): Promise<void> {
    const { puts, deletes } = this.engine.takeDirty();
    for (let i = 0; i < puts.length; i += 100) await this.ctx.storage.put(Object.fromEntries(puts.slice(i, i + 100)));
    for (let i = 0; i < deletes.length; i += 100) await this.ctx.storage.delete(deletes.slice(i, i + 100));
  }

  async run(command: Command): Promise<unknown> {
    try {
      return this.engine.run(command);
    } finally {
      await this.persist();
    }
  }

  async pipeline(commands: Command[]): Promise<unknown[]> {
    try {
      return commands.map((c) => this.engine.run(c));
    } finally {
      await this.persist();
    }
  }
}
