import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AUTH_EVENTS, getUser, handleAuthCallback, onAuthChange, updateUser, type User } from "@netlify/identity";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const AuthContext = createContext<{ user: User | null; loading: boolean }>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let active = true;
    void handleAuthCallback().then((result) => {
      if (result?.user && active) {
        setUser(result.user);
        if (result.type === "recovery") setRecoveryOpen(true);
        else toast.success(result.type === "confirmation" ? "Email verified." : "Signed in successfully.");
      }
    }).catch((error) => toast.error(error instanceof Error ? error.message : "Sign-in callback failed."));
    void getUser().then((current) => { if (active) setUser(current); }).finally(() => { if (active) setLoading(false); });
    const unsubscribe = onAuthChange((event, current) => {
      if (event === AUTH_EVENTS.LOGIN || event === AUTH_EVENTS.LOGOUT || event === AUTH_EVENTS.USER_UPDATED) setUser(current);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const value = useMemo(() => ({ user, loading }), [user, loading]);
  const resetPassword = async () => {
    if (newPassword.length < 8) return toast.error("Use at least 8 characters.");
    setResetting(true);
    try {
      const updated = await updateUser({ password: newPassword });
      setUser(updated);
      setRecoveryOpen(false);
      setNewPassword("");
      toast.success("Password updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Password could not be updated.");
    } finally { setResetting(false); }
  };

  return <AuthContext.Provider value={value}>{children}<Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}><DialogContent><DialogHeader><DialogTitle>Choose a new password</DialogTitle><DialogDescription>Your recovery link is verified. Set a new password to finish.</DialogDescription></DialogHeader><div className="grid gap-3"><Label htmlFor="recovery-password">New password</Label><Input id="recovery-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><Button disabled={resetting} onClick={() => void resetPassword()}>{resetting ? "Updating…" : "Update password"}</Button></div></DialogContent></Dialog></AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
