import { handleWebhook, readEnv } from "../lib/core";
import { headerMap, safely } from "../lib/adapter";

export default safely(async (req) =>
  req.method === "POST"
    ? handleWebhook(readEnv(), headerMap(req), req.body)
    : { status: 200, body: { ok: true, service: "TaskFlow Telegram bot" } },
);
