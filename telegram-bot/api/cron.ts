import { readEnv } from "../lib/infra";
import { handleCron } from "../lib/reminders";
import { headerMap, queryMap, safely } from "../lib/adapter";

export default safely((req) => handleCron(readEnv(), headerMap(req), queryMap(req), Date.now()));
