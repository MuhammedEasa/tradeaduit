import { Nav } from "@/components/Nav";
import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <main className="min-h-screen px-6 pb-20">
      <Nav />
      <div className="mx-auto max-w-6xl space-y-4"><Skeleton h="h-28" /><Skeleton h="h-56" /></div>
    </main>
  );
}
