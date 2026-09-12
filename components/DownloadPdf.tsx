"use client";

import { useState } from "react";
import type { PdfInput } from "@/lib/pdf";

// jsPDF loads only when the button is pressed, so it never touches the first paint.
export function DownloadPdf({ input }: { input: PdfInput }) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const [{ jsPDF }, { buildAuditPdf, pdfFileName }] = await Promise.all([import("jspdf"), import("@/lib/pdf")]);
      const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      buildAuditPdf(doc, input);
      doc.save(pdfFileName(input.fileName, input.createdAt));
    } finally {
      setBusy(false);
    }
  }

  return <button className="btn" onClick={download} disabled={busy}>{busy ? "Building PDF…" : "Download PDF"}</button>;
}
