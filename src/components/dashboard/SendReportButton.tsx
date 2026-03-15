"use client";

import { Send } from "lucide-react";
import toast from "react-hot-toast";

export function SendReportButton() {
  function handleSendReport() {
    toast("Email reports are not available in this deployment.", { icon: "ℹ️" });
  }

  return (
    <button
      onClick={handleSendReport}
      className="btn-secondary"
      title="Send daily productivity digest"
    >
      <Send className="w-4 h-4" />
      <span className="hidden sm:block">Send Report</span>
    </button>
  );
}
