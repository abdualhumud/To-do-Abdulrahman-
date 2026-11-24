"use client";

import { useEffect, useState } from "react";
import { Activity, Check, ExternalLink, Loader2, RefreshCw, Send, Unplug, X } from "lucide-react";
import toast from "react-hot-toast";
import { fmtTime, useT } from "@/lib/i18n";
import { useTelegramConfig } from "@/lib/use-local-store";
import {
  connectBot,
  connectServer,
  diagnoseTelegram,
  disconnectBot,
  isLinked,
  pollTelegram,
  renewPairCode,
  useTelegramStatus,
  type DiagStep,
} from "@/lib/telegram";

export function TelegramCard() {
  const t = useT();
  const config = useTelegramConfig();
  const status = useTelegramStatus();
  const [token, setToken] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [diag, setDiag] = useState<DiagStep[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncNow() {
    setBusy(true);
    const { added } = await pollTelegram();
    setBusy(false);
    toast.success(added.length ? (added.length === 1 ? t("Added 1 task") : t("Added {n} tasks", { n: added.length })) : t("Nothing new"));
  }

  async function handleDiagnose() {
    setChecking(true);
    setDiag(await diagnoseTelegram());
    setChecking(false);
  }

  function handleDisconnect() {
    if (!confirm(t("Disconnect Telegram from this browser? Your tasks stay."))) return;
    disconnectBot();
    setDiag(null);
  }

  const header = (
    <div className="flex items-center gap-2">
      <Send className="w-4 h-4 text-secondary-fg" />
      <h2 className="font-semibold text-base-fg">{t("Telegram")}</h2>
    </div>
  );

  if (!config) {
    return (
      <div className="card p-5 space-y-5">
        {header}
        <p className="text-sm text-secondary-fg">
          {t("Message your own Telegram bot and the text becomes a task here. Create a bot with")}{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary font-medium hover:underline">
            @BotFather
          </a>{" "}
          ({t("send")} <code className="bg-secondary px-1 rounded">/newbot</code>).
        </p>

        <form onSubmit={(e) => { e.preventDefault(); void run(() => connectServer(serverUrl), t("Server connected — now link your Telegram chat")); }} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-base-fg">{t("Always-on server")} <span className="text-xs font-normal text-success">{t("recommended")}</span></h3>
            <p className="text-xs text-secondary-fg mt-0.5">
              {t("The bot replies instantly, even when this app is closed. Paste the address of your deployed bot server.")}
            </p>
          </div>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            className="input-base font-mono text-xs"
            placeholder="https://taskflow-bot.your-name.workers.dev"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            dir="ltr"
            aria-label={t("Bot server address")}
            required
          />
          <button type="submit" disabled={busy || !serverUrl.trim()} className="btn-primary disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("Connect server")}
          </button>
        </form>

        <div className="flex items-center gap-3 text-xs text-muted-fg">
          <span className="flex-1 h-px bg-secondary" /> {t("or, without a server")} <span className="flex-1 h-px bg-secondary" />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await connectBot(token); setToken(""); }, t("Bot connected — now link your Telegram chat")); }} className="space-y-3">
          <p className="text-xs text-secondary-fg">
            {t("Browser only: this browser talks to Telegram with your bot token (kept encrypted here). Works while TaskFlow is open.")}
          </p>
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
            aria-label={t("Bot token")}
            required
          />
          <button type="submit" disabled={busy || !token.trim()} className="btn-secondary disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("Connect bot")}
          </button>
        </form>
      </div>
    );
  }

  const linked = isLinked(config);
  const expired = !linked && config.pairExpires !== null && now > config.pairExpires;
  const lastSync = status.lastSync ? fmtTime(new Date(status.lastSync)) : t("not yet");
  const serverMode = config.mode === "server";

  return (
    <div className="card p-5 space-y-4">
      {header}

      {linked ? (
        <>
          <p className="text-sm text-base-fg">
            <span className="inline-block w-2 h-2 rounded-full bg-success me-2" />
            {t("Connected to")} <strong dir="ltr">@{config.botUsername}</strong>
            <span className="text-xs text-muted-fg"> · {serverMode ? t("always-on server") : t("browser only")}</span>
          </p>
          <p className="text-sm text-secondary-fg">
            {t("Send the bot any message — one task per line, dates and")} <code className="bg-secondary px-1 rounded">#category !priority</code> {t("work too.")}{" "}
            {serverMode
              ? t("The bot saves and confirms instantly, even when this app is closed; tasks appear here when TaskFlow is open (checked every 30 seconds).")
              : t("Tasks arrive while TaskFlow is open (checked every 30 seconds); Telegram holds messages for 24 hours.")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`https://t.me/${config.botUsername}`} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">
              <ExternalLink className="w-4 h-4" /> {t("Open")} @{config.botUsername}
            </a>
            <button onClick={handleSyncNow} disabled={busy} className="btn-secondary text-sm">
              <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> {t("Sync now")}
            </button>
            <button onClick={handleDisconnect} className="btn-ghost text-sm text-danger">
              <Unplug className="w-4 h-4" /> {t("Disconnect")}
            </button>
          </div>
          <p className="text-xs text-muted-fg">{t("Last checked")}: {lastSync}</p>
        </>
      ) : (
        <>
          <p className="text-sm text-secondary-fg">
            {t("Bot")} <strong dir="ltr">@{config.botUsername}</strong> {t("is ready. Link your chat so only you can add tasks:")}
          </p>
          {expired ? (
            <p className="text-sm text-warning">{t("This code expired.")}</p>
          ) : (
            <div className="bg-secondary rounded-xl p-4 space-y-2">
              <p className="text-xs text-secondary-fg">{t("Open the bot and press Start — or send this message:")}</p>
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
                <ExternalLink className="w-4 h-4" /> {t("Open Telegram")}
              </a>
            )}
            <button onClick={() => void run(renewPairCode, t("New code ready"))} disabled={busy} className="btn-secondary text-sm">
              <RefreshCw className="w-4 h-4" /> {t("New code")}
            </button>
            <button onClick={handleDisconnect} className="btn-ghost text-sm text-danger">
              <Unplug className="w-4 h-4" /> {t("Cancel")}
            </button>
          </div>
          {!expired && (
            <p className="text-xs text-muted-fg flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> {t("Waiting for you to link… keep this tab open")}
            </p>
          )}
        </>
      )}

      <div className="space-y-2">
        <button onClick={handleDiagnose} disabled={checking} className="btn-ghost text-xs px-2 py-1">
          {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />} {t("Check connection")}
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
