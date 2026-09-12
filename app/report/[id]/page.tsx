import { Dashboard } from "@/components/Dashboard";

// Print-styled report: same computed data, no feed/table; "Export PDF" uses the browser's print-to-PDF.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Dashboard id={id} print />;
}
