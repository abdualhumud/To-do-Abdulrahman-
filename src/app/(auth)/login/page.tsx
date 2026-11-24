"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hydrateLocalStore, localUser } from "@/lib/local-store";
import { useLocalUser } from "@/lib/use-local-store";
import { CheckCircle, User, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/lib/i18n";

export default function LoginPage() {
  const t = useT();
  const router = useRouter();
  const { ready, user } = useLocalUser();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  // Already signed in → go straight to the app
  useEffect(() => {
    if (ready && user) router.replace("/dashboard");
  }, [ready, user, router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    await hydrateLocalStore();

    if (!localUser.get()) {
      localUser.set({ id: crypto.randomUUID(), name: name.trim(), email: "" });
      toast.success(t("Welcome back, {name}!", { name: name.trim() }));
    }
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
            <CheckCircle className="w-6 h-6 text-white" />
          </div>
          <span className="font-bold text-xl text-base-fg">TaskFlow</span>
        </div>

        <div className="card p-8">
          <h1 className="text-2xl font-bold text-base-fg mb-1">{t("Welcome back")}</h1>
          <p className="text-secondary-fg text-sm mb-7">{t("Enter your name to continue")}</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-base-fg mb-1.5">{t("Your Name")}</label>
              <div className="relative">
                <User className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-fg" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-base ps-9"
                  placeholder={t("John Doe")}
                  required
                  autoFocus
                />
              </div>
            </div>

            <button type="submit" disabled={loading || !ready || !name.trim()} className="btn-primary w-full justify-center py-3 mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? t("Loading...") : t("Get Started")}
            </button>
          </form>

          <p className="text-center text-sm text-secondary-fg mt-6">
            {t("New here?")}{" "}
            <Link href="/register" className="text-primary font-medium hover:underline">
              {t("Create a profile")}
            </Link>
          </p>

          <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-800 dark:text-amber-300 text-center leading-relaxed">
              <span className="font-semibold">{t("Single-device app:")}</span>{" "}
              {t("Your data is stored only in this browser. Clearing browser data or signing in on another device will not show your tasks — export a backup from Settings to keep your data safe.")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
