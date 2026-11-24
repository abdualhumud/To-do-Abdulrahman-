// The root project does not install web-push (only telegram-bot/ does); this lets the unit tests
// type-check the server modules that load it lazily.
declare module "web-push" {
  const webpush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(subscription: unknown, payload: string, options?: { TTL?: number }): Promise<unknown>;
  };
  export default webpush;
}
