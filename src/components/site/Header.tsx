import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { LayoutDashboard, LogOut, Menu, Moon, Sun, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { AuthDialog } from "@/components/site/AuthDialog";
import { useAuth } from "@/components/site/AuthProvider";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export function Header() {
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("lazy-pdf-theme");
    const enabled = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", enabled);
    setDark(enabled);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("lazy-pdf-theme", next ? "dark" : "light");
    setDark(next);
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      toast.success("Signed out.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out.");
    }
  };

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="group flex items-center gap-2.5" aria-label="Lazy PDF home">
            <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-signal/25 bg-signal-soft p-0.5 shadow-[0_4px_12px_-6px_var(--signal)] transition-transform group-hover:-rotate-2 dark:border-white/20 dark:bg-white dark:shadow-[0_4px_14px_-8px_black]">
              <img src="/lazy-pdf-favicon.svg" alt="" className="h-full w-full object-cover" />
            </span>
            <span className="font-display text-xl font-semibold tracking-tight text-foreground">
              Lazy <span className="text-signal">PDF</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm md:flex" aria-label="Primary navigation">
            <Link to="/tools" className="text-muted-foreground transition hover:text-foreground">All tools</Link>
            <a href="/#features" className="text-muted-foreground transition hover:text-foreground">Features</a>
            <a href="/#pricing" className="text-muted-foreground transition hover:text-foreground">Pricing</a>
            <a href="/#faq" className="text-muted-foreground transition hover:text-foreground">FAQ</a>
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={dark ? "Use light theme" : "Use dark theme"}>{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
            {user ? (
              <>
                <Button asChild variant="outline"><Link to="/dashboard"><LayoutDashboard className="mr-2 h-4 w-4" />Dashboard</Link></Button>
                <Button variant="ghost" size="icon" onClick={() => void signOut()} aria-label="Sign out"><LogOut className="h-4 w-4" /></Button>
              </>
            ) : <Button variant="action" onClick={() => setAuthOpen(true)}><UserRound className="mr-2 h-4 w-4" />Sign in</Button>}
          </div>
          <Button className="md:hidden" variant="ghost" size="icon" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X /> : <Menu />}</Button>
        </div>
        {menuOpen && (
          <div className="border-t border-border bg-background px-4 py-4 md:hidden">
            <nav className="grid gap-2 text-sm">
              <Link to="/tools" onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2 hover:bg-secondary">All tools</Link>
              <a href="/#features" onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2 hover:bg-secondary">Features</a>
              <a href="/#pricing" onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2 hover:bg-secondary">Pricing</a>
              {user ? <Link to="/dashboard" onClick={() => setMenuOpen(false)} className="rounded-xl px-3 py-2 hover:bg-secondary">Dashboard</Link> : <button onClick={() => { setMenuOpen(false); setAuthOpen(true); }} className="rounded-xl px-3 py-2 text-left hover:bg-secondary">Sign in</button>}
              <button onClick={toggleTheme} className="rounded-xl px-3 py-2 text-left hover:bg-secondary">{dark ? "Light theme" : "Dark theme"}</button>
            </nav>
          </div>
        )}
      </header>
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}
