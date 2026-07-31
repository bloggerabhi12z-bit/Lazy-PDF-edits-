import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

const AuthContext = createContext<{ user: User | null; loading: boolean }>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setUser(data.session?.user ?? null);
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") setRecoveryOpen(true);
      if (event === "SIGNED_IN") toast.success("Signed in successfully.");
      if (event === "SIGNED_OUT") toast.success("Signed out.");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ user, loading }), [user, loading]);

  const resetPassword = async () => {
    if (newPassword.length < 8) return toast.error("Use at least 8 characters.");
    setResetting(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setUser(data.user);
      setRecoveryOpen(false);
      setNewPassword("");
      toast.success("Password updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Password could not be updated.");
    } finally {
      setResetting(false);
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a new password</DialogTitle>
            <DialogDescription>Your recovery link is verified. Set a new password to finish.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Label htmlFor="recovery-password">New password</Label>
            <Input
              id="recovery-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <Button disabled={resetting} onClick={() => void resetPassword()}>
              {resetting ? "Updating…" : "Update password"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}