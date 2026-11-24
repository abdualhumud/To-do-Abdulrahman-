import { readEnv } from "../lib/infra";
import { handlePush } from "../lib/reminders";
import { headerMap, safely } from "../lib/adapter";

export default safely((req) => handlePush(readEnv(), req.method ?? "GET", headerMap(req), req.body));
