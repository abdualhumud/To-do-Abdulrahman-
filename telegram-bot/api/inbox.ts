import { handleInbox, readEnv } from "../lib/core";
import { headerMap, safely } from "../lib/adapter";

export default safely((req) => handleInbox(readEnv(), req.method ?? "GET", headerMap(req), req.body));
