import { Nav } from "@/components/Nav";
import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main className="min-h-screen px-6 pb-20">
      <Nav />
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <Skeleton h="h-40" />
        <Skeleton h="h-28" />
      </div>
    </main>
  );
}
