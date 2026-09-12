"use client";

import { useState } from "react";

// Renders the given element to a paginated A4 PDF and downloads it.
// Libraries load only when the button is pressed, so they never touch the first paint.
export function DownloadPdf({ targetId, fileName }: { targetId: string; fileName: string }) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const el = document.getElementById(targetId);
      if (!el) return;
      // html2canvas-pro (not html2canvas): Tailwind v4 emits oklch() colors the original cannot parse.
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });

      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const imgW = pageW - margin * 2;
      const imgH = (canvas.height / canvas.width) * imgW;

      // Slice the tall capture into page-sized strips.
      const pxPerMm = canvas.width / imgW;
      const sliceHpx = (pageH - margin * 2) * pxPerMm;
      let y = 0;
      let page = 0;
      while (y < canvas.height) {
        const h = Math.min(sliceHpx, canvas.height - y);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = h;
        slice.getContext("2d")?.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (page > 0) pdf.addPage();
        pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, imgW, h / pxPerMm);
        y += h;
        page++;
      }
      pdf.save(fileName);
    } finally {
      setBusy(false);
    }
  }

  return <button className="btn" onClick={download} disabled={busy}>{busy ? "Building PDF…" : "Download PDF"}</button>;
}
