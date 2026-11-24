import { readEnv } from "../lib/infra";
import { handleFeed, handleFeedCreate } from "../lib/reminders";
import { header, headerMap, queryMap, safely } from "../lib/adapter";

export default safely(async (req) => {
  const env = readEnv();
  if (req.method === "POST") return handleFeedCreate(env, headerMap(req), header(req, "x-forwarded-host") ?? header(req, "host") ?? "");
  return handleFeed(env, queryMap(req).k ?? "", Date.now());
});
