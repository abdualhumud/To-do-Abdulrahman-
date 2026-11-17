import { handlePair, readEnv } from "../lib/core";
import { safely } from "../lib/adapter";

export default safely((req) => handlePair(readEnv(), req.method ?? "GET", req.body));
