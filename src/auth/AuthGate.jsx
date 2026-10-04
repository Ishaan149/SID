import React, { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { createAuthService } from "./firebaseAuth.js";
import { loginErrorMessage } from "./session.js";

export default function AuthGate({ children }) {
  const [state, setState] = useState({ status: "loading" });
  const [service, setService] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const authService = createAuthService();
      setService(authService);
      return authService.subscribe(setState);
    } catch (error) {
      setState({ status: "configuration", message: error.message });
    }
  }, []);

  async function logout() {
    setBusy(true);
    setError("");
    try {
      await service.logout();
      setPassword("");
    } catch {
      setError("Sign-out failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "ready") {
    return children(state.session, logout, error);
  }

  async function login(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await service.login(email, password);
      setPassword("");
    } catch (error) {
      setError(loginErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const waiting = state.status === "loading" || state.status === "checking";
  return (
    <div className="min-h-screen bg-stone-900 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5">
        <div className="flex items-center gap-3">
          <span className="grid place-items-center w-10 h-10 rounded-md bg-amber-500 text-stone-900"><Flame size={22} /></span>
          <div><h1 className="font-bold text-xl">AETE</h1><p className="text-sm text-stone-400">Hot-Dip Galvanizing Tracker</p></div>
        </div>
        {waiting && <p role="status">{state.status === "checking" ? "Checking account permissions…" : "Loading sign-in…"}</p>}
        {state.status === "signed-out" && (
          <form onSubmit={login} className="space-y-4">
            <h2 className="font-semibold">Sign in to your account</h2>
            <label className="block text-sm">Email
              <input required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md bg-stone-800 border border-stone-600 px-3 py-2" />
            </label>
            <label className="block text-sm">Password
              <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md bg-stone-800 border border-stone-600 px-3 py-2" />
            </label>
            <button disabled={busy} className="w-full bg-amber-500 text-stone-900 font-semibold rounded-md py-2.5 disabled:opacity-50">
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <p className="text-xs text-stone-400">Your manager assigns access. Roster names do not create login accounts. Sign out when you finish using a shared device.</p>
          </form>
        )}
        {state.status === "unassigned" && <p role="alert">This account has no active tracker role. Ask the project administrator to assign your account access.</p>}
        {state.status === "error" && <p role="alert">Account permissions could not be verified. Check your connection and the Firestore rules, then retry.</p>}
        {state.status === "configuration" && <p role="alert">{state.message}</p>}
        {state.user && state.status !== "signed-out" && <p className="text-xs text-stone-400 break-all">{state.user.email}<br />Account UID: {state.user.uid}</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        {state.status !== "signed-out" && state.status !== "configuration" && (
          <div className="flex gap-3">
            <button onClick={() => window.location.reload()} className="border border-stone-600 rounded-md px-4 py-2">Retry</button>
            {state.user && <button disabled={busy} onClick={logout} className="border border-stone-600 rounded-md px-4 py-2 disabled:opacity-50">Sign out</button>}
          </div>
        )}
      </div>
    </div>
  );
}
