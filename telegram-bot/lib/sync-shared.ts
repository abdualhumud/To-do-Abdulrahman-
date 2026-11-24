/** Small pure helpers used by both the sync server and the app. */

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Stamp {
  u: number; // hybrid-logical-clock time chosen by the editing device
  dev: string; // that device's id, to break exact ties
}

/** Orders two versions of the same item: positive when a is newer. */
export function compareStamps(a: Stamp, b: Stamp): number {
  return a.u - b.u || (a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : 0);
}
