"use client";

import { useState } from "react";
import { Send, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

export function SendReportButton() {
  const [loading, setLoading] = useState(false);

  async function handleSendReport() {
    setLoading(true);
    try {
      const res = await fetch("/api/reports/send", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Daily digest sent to your email! 📧");
      } else {
        toast.error(data.error || "Failed to send report");
      }
    } catch {
      toast.error("Failed to send report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleSendReport}
      disabled={loading}
      className="btn-secondary"
      title="Send daily productivity digest"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
      <span className="hidden sm:block">Send Report</span>
    </button>
  );
}
