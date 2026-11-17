"use client";

import { useEffect, useState } from "react";
import { Activity, Check, ExternalLink, Loader2, RefreshCw, Send, Unplug, X } from "lucide-react";
import toast from "react-hot-toast";
import { useTelegramConfig } from "@/lib/use-local-store";
import {
  connectBot,
  diagnoseTelegram,
  disconnectBot,
  pollTelegram,
  renewPairCode,
  useTelegramStatus,
  type DiagStep,
} from "@/lib/telegram";

export function TelegramCard() {
  const config = useTelegramConfig();
  const status = useTelegramStatus();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [diag, setDiag] = useState<DiagStep[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await connectBot(token);
      setToken("");
      toast.success("Bot connected — now link your Telegram chat");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't connect the bot");
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncNow() {
    setBusy(true);
    const { added } = await pollTelegram();
    setBusy(false);
    toast.success(added.length ? `Added ${added.length} task${added.length === 1 ? "" : "s"}` : "Nothing new");
  }

  async function handleDiagnose() {
    setChecking(true);
    setDiag(await diagnoseTelegram());
    setChecking(false);
  }

  function handleDisconnect() {
    if (!confirm("Disconnect Telegram? Your tasks stay; the bot token is removed from this browser.")) return;
    disconnectBot();
  }

  const header = (
    <div className="flex items-center gap-2">
      <Send className="w-4 h-4 text-secondary-fg" />
      <h2 className="font-semibold text-base-fg">Telegram</h2>
    </div>
  );

  if (!config) {
    return (
      <div className="card p-5 space-y-4">
        {header}
        <p className="text-sm text-secondary-fg">
          Message your own Telegram bot and the text becomes a task here. Create a bot with{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:underline">
            @BotFather
          </a>{" "}
          (send <code className="bg-secondary px-1 rounded">/newbot</code>), then paste its token below.
        </p>
        <form onSubmit={handleConnect} className="space-y-3">
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="input-base font-mono text-xs"
            placeholder="123456789:AA…"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            dir="ltr"
            required
          />
          <button type="submit" disabled={busy || !token.trim()} className="btn-primary disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Connect bot
          </button>
        </form>
        <p className="text-xs text-muted-fg leading-relaxed">
          The token is stored encrypted in this browser only and used to talk to Telegram directly — never sent anywhere else.
          Connecting replaces any webhook the bot had.
        </p>
      </div>
    );
  }

  const linked = config.chatId !== null;
  const expired = !linked && config.pairExpires !== null && now > config.pairExpires;
  const lastSync = status.lastSync ? new Date(status.lastSync).toLocaleTimeString() : "not yet";

  return (
    <div className="card p-5 space-y-4">
      {header}

      {linked ? (
        <>
          <p className="text-sm text-base-fg">
            <span className="inline-block w-2 h-2 rounded-full bg-success mr-2" />
            Connected to <strong>@{config.botUsername}</strong>
          </p>
          <p className="text-sm text-secondary-fg">
            Send the bot any message — one task per line, dates and <code className="bg-secondary px-1 rounded">#category !priority</code> work too.
            Tasks arrive while TaskFlow is open (checked every 30 seconds); Telegram holds messages for 24 hours.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`https://t.me/${config.botUsername}`} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">
              <ExternalLink className="w-4 h-4" /> Open @{config.botUsername}
            </a>
            <button onClick={handleSyncNow} disabled={busy} className="btn-secondary text-sm">
              <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> Sync now
            </button>
            <button onClick={handleDisconnect} className="btn-ghost text-sm text-danger">
              <Unplug className="w-4 h-4" /> Disconnect
            </button>
          </div>
          <p className="text-xs text-muted-fg">Last checked: {lastSync}</p>
        </>
      ) : (
        <>
          <p className="text-sm text-secondary-fg">
            Bot <strong>@{config.botUsername}</strong> is ready. Link your chat so only <em>you</em> can add tasks:
          </p>
          {expired ? (
            <p className="text-sm text-warning">This code expired.</p>
          ) : (
            <div className="bg-secondary rounded-xl p-4 space-y-2">
              <p className="text-xs text-secondary-fg">Open the bot and press Start — or send this message:</p>
              <code className="block text-lg font-mono font-semibold text-base-fg tracking-wider" dir="ltr">
                /link {config.pairCode}
              </code>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!expired && (
              <a
                href={`https://t.me/${config.botUsername}?start=link_${config.pairCode}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary text-sm"
              >
                <ExternalLink className="w-4 h-4" /> Open Telegram
              </a>
            )}
            <button onClick={renewPairCode} className="btn-secondary text-sm">
              <RefreshCw className="w-4 h-4" /> New code
            </button>
            <button onClick={handleDisconnect} className="btn-ghost text-sm text-danger">
              <Unplug className="w-4 h-4" /> Cancel
            </button>
          </div>
          {!expired && (
            <p className="text-xs text-muted-fg flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Waiting for you to link… keep this tab open
            </p>
          )}
        </>
      )}

      <div className="space-y-2">
        <button onClick={handleDiagnose} disabled={checking} className="btn-ghost text-xs px-2 py-1">
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />} Check connection
        </button>
        {diag && (
          <ul className="space-y-1.5 text-xs">
            {diag.map((step) => (
              <li key={step.label} className="flex items-start gap-2">
                {step.ok ? <Check className="w-3.5 h-3.5 mt-0.5 text-success flex-shrink-0" /> : <X className="w-3.5 h-3.5 mt-0.5 text-danger flex-shrink-0" />}
                <span className="text-base-fg">
                  {step.label}: <span className={step.ok ? "text-secondary-fg" : "text-danger"}>{step.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {status.error && <p className="text-sm text-danger">{status.error}</p>}
    </div>
  );
}
