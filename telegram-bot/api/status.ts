import { handleStatus, readEnv } from "../lib/core";
import { safely } from "../lib/adapter";

export default safely((req) => handleStatus(readEnv(), req.method ?? "GET"));
