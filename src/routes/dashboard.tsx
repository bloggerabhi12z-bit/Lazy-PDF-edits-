import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock3, Download, FileCheck2, HardDrive, Heart, Loader2, Settings2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { useAuth } from "@/components/site/AuthProvider";
import { AuthDialog } from "@/components/site/AuthDialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/download";

interface Operation { id: string; tool: string; filename: string; mime: string; size: number; favorite: boolean; createdAt: string; }

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Lazy PDF" }, { name: "description", content: "Your private Lazy PDF activity and favorite tools." }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch("/.netlify/functions/history");
      if (!response.ok) throw new Error("Could not load history.");
      const body = await response.json() as { data: Operation[] };
      setOperations(body.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load history.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [user?.id]);
  const totalBytes = useMemo(() => operations.reduce((total, item) => total + item.size, 0), [operations]);
  const favorites = operations.filter((item) => item.favorite);

  const toggleFavorite = async (item: Operation) => {
    const next = !item.favorite;
    setOperations((items) => items.map((entry) => entry.id === item.id ? { ...entry, favorite: next } : entry));
    const response = await fetch("/.netlify/functions/history", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, favorite: next }) });
    if (!response.ok) { setOperations((items) => items.map((entry) => entry.id === item.id ? item : entry)); toast.error("Favorite could not be updated."); }
  };

  const clearHistory = async () => {
    const response = await fetch("/.netlify/functions/history", { method: "DELETE" });
    if (response.ok) { setOperations([]); toast.success("History cleared."); } else toast.error("History could not be cleared.");
  };

  if (authLoading) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-7 w-7 animate-spin text-signal" /></div>;

  return (
    <div className="min-h-screen"><Header />
      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        {!user ? (
          <section className="mx-auto mt-16 max-w-xl rounded-[2rem] border border-border bg-card p-8 text-center shadow-xl shadow-ink/5">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-signal-soft text-signal"><Sparkles /></div>
            <h1 className="mt-5 font-display text-4xl">Your workspace, when you want it.</h1>
            <p className="mt-3 text-muted-foreground">Sign in to sync lightweight processing history and favorites. PDF contents are never stored.</p>
            <Button className="mt-6" size="lg" onClick={() => setAuthOpen(true)}>Sign in to dashboard</Button>
          </section>
        ) : (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-signal">Workspace</div><h1 className="mt-2 font-display text-4xl sm:text-5xl">Good to see you{user.name ? `, ${user.name.split(" ")[0]}` : ""}.</h1><p className="mt-2 text-muted-foreground">A private activity record—never a copy of your files.</p></div><Button asChild><Link to="/tools">Process a new file</Link></Button></div>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[{ icon: FileCheck2, label: "Files processed", value: operations.length.toString() }, { icon: HardDrive, label: "Local work volume", value: formatBytes(totalBytes) }, { icon: Heart, label: "Favorites", value: favorites.length.toString() }, { icon: Download, label: "Plan", value: "Private Free" }].map((stat) => <div key={stat.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm"><stat.icon className="h-5 w-5 text-signal" /><div className="mt-5 text-2xl font-semibold">{stat.value}</div><div className="text-sm text-muted-foreground">{stat.label}</div></div>)}
            </section>
            <section className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_0.8fr]">
              <div className="rounded-[1.75rem] border border-border bg-card p-5 sm:p-6"><div className="flex items-center justify-between"><div><h2 className="font-display text-2xl">Processing history</h2><p className="text-sm text-muted-foreground">Latest successful exports</p></div>{operations.length > 0 && <Button variant="ghost" size="sm" onClick={() => void clearHistory()}><Trash2 className="mr-2 h-4 w-4" />Clear</Button>}</div>
                {loading ? <div className="grid h-56 place-items-center"><Loader2 className="animate-spin text-signal" /></div> : operations.length === 0 ? <div className="mt-6 grid min-h-56 place-items-center rounded-2xl border border-dashed border-border bg-secondary/30 text-center"><div><Clock3 className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-3 font-medium">No exports yet</p><p className="text-sm text-muted-foreground">Completed tools appear here automatically.</p></div></div> : <div className="mt-4 divide-y divide-border">{operations.map((item) => <div key={item.id} className="flex items-center gap-3 py-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-signal-soft text-signal"><FileCheck2 className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{item.filename}</div><div className="text-xs text-muted-foreground">{item.tool.replaceAll("-", " ")} · {formatBytes(item.size)} · {new Date(item.createdAt).toLocaleDateString()}</div></div><Button variant="ghost" size="icon" onClick={() => void toggleFavorite(item)} aria-label={item.favorite ? "Remove favorite" : "Add favorite"}><Heart className={`h-4 w-4 ${item.favorite ? "fill-signal text-signal" : ""}`} /></Button></div>)}</div>}
              </div>
              <div className="space-y-6"><div className="rounded-[1.75rem] border border-border bg-card p-6"><h2 className="font-display text-2xl">Storage usage</h2><p className="mt-1 text-sm text-muted-foreground">Only metadata counts toward cloud storage.</p><Progress value={Math.min(100, operations.length / 2)} className="mt-5" /><div className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{operations.length} of 200 history records</span><span>Files: 0 B</span></div></div><div className="rounded-[1.75rem] border border-border bg-card p-6"><Settings2 className="h-5 w-5 text-signal" /><h2 className="mt-4 font-display text-2xl">Account</h2><p className="mt-1 truncate text-sm text-muted-foreground">{user.email}</p><p className="mt-5 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">Downloads remain in your browser’s download folder. Lazy PDF never stores document bytes.</p></div></div>
            </section>
          </>
        )}
      </main><Footer /><AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  );
}
