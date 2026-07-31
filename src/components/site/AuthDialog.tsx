import { useState } from "react";
import { Github, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export function AuthDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = async () => {
    if (!isSupabaseConfigured) {
      toast.error("Authentication is not configured yet.");
      return;
    }
    if (!email || password.length < 8) {
      toast.error("Enter a valid email and a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back.");
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("Check your inbox to verify your email.");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const oauthLogin = async (provider: "google" | "github") => {
    if (!isSupabaseConfigured) {
      toast.error("Authentication is not configured yet.");
      return;
    }
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider });
      if (error) throw error;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OAuth sign-in failed.");
    }
  };

  const recover = async () => {
    if (!isSupabaseConfigured) {
      toast.error("Authentication is not configured yet.");
      return;
    }
    if (!email) return toast.error("Enter your email first.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) throw error;
      toast.success("Password recovery email sent.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Recovery could not be started.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "login" ? "Sign in to Lazy PDF" : "Create your account"}</DialogTitle>
          <DialogDescription>Sync processing history and favorites. Your document contents still stay on your device.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => void oauthLogin("google")}><Mail className="mr-2 h-4 w-4" />Google</Button>
            <Button variant="outline" onClick={() => void oauthLogin("github")}><Github className="mr-2 h-4 w-4" />GitHub</Button>
          </div>
          <div className="relative my-1 text-center text-xs text-muted-foreground before:absolute before:inset-x-0 before:top-1/2 before:border-t before:border-border"><span className="relative bg-background px-2">or use email</span></div>
          <div className="grid gap-2"><Label htmlFor="auth-email">Email</Label><Input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="auth-password">Password</Label><Input id="auth-password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} /></div>
          <Button onClick={() => void submit()} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{mode === "login" ? "Sign in" : "Create account"}</Button>
          {mode === "login" && <Button variant="ghost" size="sm" onClick={() => void recover()} disabled={busy}>Forgot password?</Button>}
          <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}