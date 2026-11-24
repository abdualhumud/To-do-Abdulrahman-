// In-memory stand-ins for Upstash Redis (REST), the Telegram Bot API and Resend.
// Shared by the unit tests and the browser-test harness.
import { RedisEngine, type Command } from "../../../telegram-bot/lib/redis-engine";

export class FakeRedis extends RedisEngine {
  /** Handles an Upstash REST request: POST / (one command) or POST /pipeline (array of commands). */
  http(path: string, body: unknown): { status: number; json: unknown } {
    try {
      if (path.endsWith("/pipeline")) return { status: 200, json: (body as Command[]).map((c) => ({ result: this.run(c) })) };
      return { status: 200, json: { result: this.run(body as Command) } };
    } catch (e) {
      return { status: 200, json: { error: String(e) } };
    }
  }
}

export class FakeTelegram {
  constructor(readonly token: string) {}
  webhookUrl = "";
  sent: { chat: number; text: string }[] = [];

  /** Returns the Bot API reply, or null for an unknown token (HTTP 401). */
  call(token: string, method: string, params: URLSearchParams): { ok: boolean; result?: unknown; description?: string } {
    if (token !== this.token) return { ok: false, description: "Unauthorized" };
    switch (method) {
      case "getMe": return { ok: true, result: { username: "taskflow_test_bot" } };
      case "setWebhook": this.webhookUrl = params.get("url") ?? ""; return { ok: true, result: true };
      case "getWebhookInfo": return { ok: true, result: { url: this.webhookUrl } };
      case "sendMessage": this.sent.push({ chat: Number(params.get("chat_id")), text: params.get("text") ?? "" }); return { ok: true, result: {} };
      default: return { ok: true, result: true };
    }
  }
}

export class FakeResend {
  emails: { to: string[]; subject: string; text: string; auth: string }[] = [];
  reject = false;
  send(auth: string, body: { to: string[]; subject: string; text: string }): { status: number; json: unknown } {
    if (this.reject) return { status: 403, json: { message: "domain not verified" } };
    this.emails.push({ to: body.to, subject: body.subject, text: body.text, auth });
    return { status: 200, json: { id: "email_1" } };
  }
}
