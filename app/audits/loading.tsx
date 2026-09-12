import { Nav } from "@/components/Nav";
import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main className="min-h-screen px-6 pb-20">
      <Nav />
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <Skeleton h="h-72" />
      </div>
    </main>
  );
}
