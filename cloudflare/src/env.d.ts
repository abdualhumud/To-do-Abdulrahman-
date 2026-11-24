// readEnv() defaults to process.env for Node hosts; the Worker always passes its bindings instead.
declare const process: { env: Record<string, string | undefined> };
