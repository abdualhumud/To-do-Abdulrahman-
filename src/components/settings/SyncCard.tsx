"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Monitor, RefreshCw, Smartphone, Unplug } from "lucide-react";
import toast from "react-hot-toast";
import { useSyncStatus } from "@/lib/sync-status";
import { useLocalSync, useTelegramConfig } from "@/lib/use-local-store";
import { fmtTime, useT } from "@/lib/i18n";
import { createPairCode, enableSync, joinSync, leaveSync, syncNow } from "@/lib/sync";

export function SyncCard() {
  const t = useT();
  const sync = useLocalSync();
  const telegram = useTelegramConfig();
  const status = useSyncStatus();
  const [link] = useState(() => (typeof window === "undefined" ? null : /^#join=([A-Za-z0-9-]+)$/.exec(window.location.hash)));
  const [serverInput, setServer] = useState<string | null>(null);
  const [code, setCode] = useState(link ? link[1] : "");
  const server = serverInput ?? (telegram?.mode === "server" ? telegram.serverUrl : "");
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<{ display: string; until: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A #join=<server>|<code> link (from "Add a device") prefills the join form; the hash is then removed.
  useEffect(() => {
    if (/^#join=/.test(window.location.hash)) history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div className="flex items-center gap-2">
      <RefreshCw className="w-4 h-4 text-secondary-fg" />
      <h2 className="font-semibold text-base-fg">{t("Sync across devices")}</h2>
    </div>
  );

  if (!sync) {
    return (
      <div className="card p-5 space-y-5" id="sync">
        {header}
        <p className="text-sm text-secondary-fg">
          {t("Keep the same tasks and habits on your phone and computer. Everything is encrypted on your device before it is uploaded — the server stores only unreadable data and never has the key. It needs your bot server (the Cloudflare Worker).")}
        </p>

        <div className="space-y-1.5">
          <label htmlFor="sync-server" className="text-sm font-semibold text-base-fg">{t("Bot server address")}</label>
          <input id="sync-server" type="text" value={server} onChange={(e) => setServer(e.target.value)} className="input-base font-mono text-xs" placeholder="https://taskflow-bot.your-name.workers.dev" dir="ltr" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label={t("Server address")} />
          <p className="text-xs text-secondary-fg">{t("The same address for every device (the one you use for Telegram).")} {t("Needs Telegram connected to the same server first (it proves you own the server).")}</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => enableSync(server), t("Sync is on — add your other devices with a code"));
          }}
          className="space-y-3"
        >
          <h3 className="text-sm font-semibold text-base-fg">{t("This is my first device")}</h3>
          <button type="submit" disabled={busy || !server.trim()} className="btn-primary disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("Turn on sync")}
          </button>
        </form>

        <div className="flex items-center gap-3 text-xs text-muted-fg">
          <span className="flex-1 h-px bg-secondary" /> {t("or")} <span className="flex-1 h-px bg-secondary" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => joinSync(server, code), t("Joined — your tasks are arriving"));
          }}
          className="space-y-3"
        >
          <h3 className="text-sm font-semibold text-base-fg">{t("I already use sync on another device")}</h3>
          <p className="text-xs text-secondary-fg">{t("On the other device open Settings → Sync across devices → “Add a device”, then type the code it shows. Tasks already here are kept and merged.")}</p>
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)} className="input-base font-mono tracking-widest" placeholder="ABCD-EFGH-JKLM" dir="ltr" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} aria-label={t("Pairing code")} required />
          <button type="submit" disabled={busy || !server.trim() || !code.trim()} className="btn-secondary disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("Join")}
          </button>
        </form>
      </div>
    );
  }

  const left = pair ? Math.max(0, Math.round((pair.until - now) / 1000)) : 0;
  const pairLink = pair ? `${window.location.origin}${window.location.pathname.replace(/\/settings\/?$/, "")}/settings/#join=${pair.display.replace(/-/g, "")}` : "";

  return (
    <div className="card p-5 space-y-4" id="sync">
      {header}
      <p className="text-sm text-base-fg">
        <span className={`inline-block w-2 h-2 rounded-full me-2 ${status.error ? "bg-danger" : status.current ? "bg-success" : "bg-warning"}`} />
        {status.error ? t("Sync problem") : status.syncing ? t("Syncing…") : status.current ? t("Up to date") : t("Waiting to sync")}
        <span className="text-xs text-muted-fg"> · {new URL(sync.serverUrl).host} · {t("last")} {status.lastSync ? fmtTime(new Date(status.lastSync)) : t("not yet")}</span>
      </p>
      {status.error && <p className="text-sm text-danger">{status.error}</p>}

      <div className="flex flex-wrap gap-2">
        <button onClick={() => void run(syncNow, t("Synced"))} disabled={busy || status.syncing} className="btn-secondary text-sm">
          <RefreshCw className={`w-4 h-4 ${status.syncing ? "animate-spin" : ""}`} /> {t("Sync now")}
        </button>
        <button
          onClick={() => void run(async () => { const p = await createPairCode(); setPair({ display: p.display, until: Date.now() + 600_000 }); }, t("Code ready"))}
          disabled={busy}
          className="btn-primary text-sm"
        >
          <Smartphone className="w-4 h-4" /> {t("Add a device")}
        </button>
      </div>

      {pair && left > 0 && (
        <div className="bg-secondary rounded-xl p-4 space-y-2">
          <p className="text-xs text-secondary-fg">{t("On the new device: Settings → Sync across devices → I already use sync. Enter the server address and this code (valid once, {time} left):", { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` })}</p>
          <code className="block text-xl font-mono font-semibold text-base-fg tracking-widest" dir="ltr">{pair.display}</code>
          <p className="text-xs text-secondary-fg break-all" dir="ltr">{t("Server")}: {sync.serverUrl}</p>
          <button
            onClick={() => void navigator.clipboard.writeText(pairLink).then(() => toast.success(t("Link copied — open it on the other device")), () => toast.error(t("Couldn't copy")))}
            className="btn-ghost text-xs px-2 py-1"
          >
            <Copy className="w-3.5 h-3.5" /> {t("Copy a one-tap link instead")}
          </button>
        </div>
      )}
      {pair && left === 0 && <p className="text-sm text-warning">{t("That code expired — make a new one.")}</p>}

      <p className="text-xs text-muted-fg flex items-start gap-1.5">
        <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-success" />
        {t("Changes upload a second after you make them and arrive on other devices within about 20 seconds (instantly when you open the app).")}
      </p>

      <button
        onClick={() => {
          const wipe = confirm(t("Turn sync off on this device?\n\nOK = also delete the encrypted copy from the server (other devices stop syncing).\nCancel = ask me differently."));
          if (wipe) return void run(() => leaveSync(true), t("Sync turned off and server copy deleted"));
          if (confirm(t("Only stop syncing on this device and keep the server copy for your other devices?"))) void run(() => leaveSync(false), t("Sync turned off on this device"));
        }}
        className="btn-ghost text-sm text-danger"
        disabled={busy}
      >
        <Unplug className="w-4 h-4" /> {t("Turn off sync…")}
      </button>
      <p className="text-[11px] text-muted-fg flex items-center gap-1"><Monitor className="w-3 h-3" /> {t("Device")} {sync.dev}</p>
    </div>
  );
}
