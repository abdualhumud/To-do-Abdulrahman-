import { readEnv } from "../lib/infra";
import { handleReminders } from "../lib/reminders";
import { headerMap, queryMap, safely } from "../lib/adapter";

export default safely((req) =>
  handleReminders(readEnv(), req.method ?? "GET", headerMap(req), queryMap(req), req.body, Date.now()),
);
