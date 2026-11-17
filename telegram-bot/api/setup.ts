import { handleSetup, readEnv } from "../lib/core";
import { header, safely } from "../lib/adapter";

export default safely((req) => {
  const q = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return handleSetup(readEnv(), q, header(req, "x-forwarded-host") ?? header(req, "host") ?? "");
});
