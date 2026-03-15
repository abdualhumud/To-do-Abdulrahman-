"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { localUser } from "@/lib/local-store";
import { CheckCircle, User, Mail, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (localUser.get()) router.replace("/dashboard");
  }, [router]);

  function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);

    localUser.set({
      id: crypto.randomUUID(),
      name: name.trim(),
      email: email.trim(),
    });

    toast.success("Welcome to TaskFlow!");
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center">
            <CheckCircle className="w-6 h-6 text-white" />
          </div>
          <span className="font-bold text-xl text-base-fg">TaskFlow</span>
        </div>

        <div className="card p-8">
          <h1 className="text-2xl font-bold text-base-fg mb-1">Create your profile</h1>
          <p className="text-secondary-fg text-sm mb-7">Start your productivity journey — no account needed</p>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-base-fg mb-1.5">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-fg" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-base pl-9"
                  placeholder="John Doe"
                  required
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-base-fg mb-1.5">
                Email <span className="text-muted-fg font-normal">(optional)</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-fg" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-base pl-9"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <button type="submit" disabled={loading || !name.trim()} className="btn-primary w-full justify-center py-3 mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? "Setting up..." : "Get Started"}
            </button>
          </form>

          <p className="text-center text-sm text-secondary-fg mt-6">
            Already have a profile?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </p>

          <p className="text-center text-xs text-muted-fg mt-4">
            Your data is stored locally in your browser — no server required.
          </p>
        </div>
      </div>
    </div>
  );
}
