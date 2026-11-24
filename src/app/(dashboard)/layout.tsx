"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { AppBootstrap } from "@/components/providers/AppBootstrap";
import { useLocalUser } from "@/lib/use-local-store";
import { stashCaptureRequest } from "@/lib/capture";

function Spinner() {
  return (
    <div className="flex h-dvh items-center justify-center bg-base">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { ready, user } = useLocalUser();

  useEffect(() => {
    if (ready && !user) {
      stashCaptureRequest();
      router.replace("/login");
    }
  }, [ready, user, router]);

  if (!ready || !user) return <Spinner />;

  return (
    <div className="flex h-dvh bg-base overflow-hidden">
      <AppBootstrap />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header user={user} />
        <main className="flex-1 overflow-y-auto overscroll-contain p-4 md:p-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-6 ps-[max(1rem,env(safe-area-inset-left))] pe-[max(1rem,env(safe-area-inset-right))] md:ps-6 md:pe-6">{children}</main>
      </div>
    </div>
  );
}
