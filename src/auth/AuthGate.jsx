import React, { useEffect, useState } from "react";
import { ArrowLeft, Flame, Package, Play, ShieldCheck } from "lucide-react";
import { createAuthService } from "./firebaseAuth.js";
import { loginErrorMessage } from "./session.js";
import { quickEntryErrorMessage } from "./quickEntry.js";

const choices = [
  { id: "plant", title: "Plant Supervisor", description: "Receive & dispatch material", icon: Package,
    iconColor: "bg-amber-500", focusColor: "focus-visible:ring-amber-500" },
  { id: "shiftA", title: "Shift A Supervisor", description: "Take into process · mark ready", icon: Play,
    iconColor: "bg-sky-500", focusColor: "focus-visible:ring-sky-500" },
  { id: "shiftB", title: "Shift B Supervisor", description: "Take into process · mark ready", icon: Play,
    iconColor: "bg-emerald-500", focusColor: "focus-visible:ring-emerald-500" },
  { id: "manager", title: "Operations Manager", description: "Oversee everything · email sign-in", icon: ShieldCheck,
    iconColor: "bg-violet-500", focusColor: "focus-visible:ring-violet-500" },
];

const inputClass = "mt-2 w-full rounded-lg border border-stone-600 bg-stone-800 px-4 py-3 text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30";

export default function AuthGate({ children }) {
  const [state, setState] = useState({ status: "loading" });
  const [service, setService] = useState(null);
  const [selected, setSelected] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const authService = createAuthService();
      setService(authService);
      return authService.subscribe(setState);
    } catch (cause) {
      setState({ status: "configuration", message: cause.message });
    }
  }, []);

  async function logout() {
    setBusy(true);
    setError("");
    try {
      await service.logout();
      setSelected(null);
      setName("");
      setPassword("");
    } catch {
      setError("Sign-out failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "ready") return children(state.session, logout, error);

  const canEnter = state.status === "signed-out" ||
    (state.status === "unassigned" && state.profileMissing && state.user?.isAnonymous);
  const waiting = state.status === "loading" || state.status === "checking";
  const choice = choices.find((item) => item.id === selected);

  async function choose(next) {
    if (busy) return;
    setError("");
    if (next === "manager" && state.user?.isAnonymous) {
      setBusy(true);
      try {
        await service.logout();
        setSelected("manager");
      } catch {
        setError("Could not switch accounts. Please try again.");
      } finally {
        setBusy(false);
      }
      return;
    }
    setSelected(next);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !selected) return;
    setBusy(true);
    setError("");
    try {
      if (selected === "manager") await service.login(email, password);
      else await service.enterStaff(name, selected);
      setPassword("");
    } catch (cause) {
      setError(selected === "manager" ? loginErrorMessage(cause) : quickEntryErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1c1917] px-5 py-10 text-white">
      <div className="w-full max-w-[550px]">
        <div className="mb-12 text-center">
          <div className="flex items-center justify-center gap-4">
            <span className="grid h-14 w-14 place-items-center rounded-lg bg-amber-500 text-stone-950"><Flame size={30} strokeWidth={2.4} /></span>
            <h1 className="text-3xl font-bold tracking-tight">AETE</h1>
          </div>
          <p className="mt-2 text-lg text-stone-400">Hot-Dip Galvanizing Tracker</p>
        </div>

        {waiting && <p role="status" className="text-center text-stone-400">
          {state.status === "checking" ? "Checking access…" : "Loading sign-in…"}
        </p>}

        {canEnter && !selected && <div>
          <h2 className="mb-4 text-sm font-medium text-stone-400">Who's using the tracker?</h2>
          <div className="space-y-4">
            {choices.map((item) => {
              const Icon = item.icon;
              return <button key={item.id} type="button" disabled={busy || !service} onClick={() => choose(item.id)}
                className={`flex min-h-[106px] w-full items-center gap-5 rounded-xl border border-stone-700 bg-[#292524] px-6 py-4 text-left transition-colors hover:border-stone-500 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 ${item.focusColor} disabled:opacity-60`}>
                <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-lg text-stone-950 ${item.iconColor}`}>
                  <Icon size={27} strokeWidth={2.1} />
                </span>
                <span>
                  <span className="block text-xl font-semibold leading-tight">{item.title}</span>
                  <span className="mt-1 block text-sm text-stone-400">{item.description}</span>
                </span>
              </button>;
            })}
          </div>
        </div>}

        {canEnter && choice && <div>
          <button type="button" disabled={busy} onClick={() => { setSelected(null); setError(""); }}
            className="mb-5 inline-flex items-center gap-2 text-sm text-stone-400 hover:text-white disabled:opacity-50">
            <ArrowLeft size={17} /> Back to roles
          </button>
          <form onSubmit={submit} className="rounded-xl border border-stone-700 bg-[#292524] p-6 sm:p-8">
            <div className="mb-7 flex items-center gap-4">
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-lg text-stone-950 ${choice.iconColor}`}>
                <choice.icon size={25} strokeWidth={2.1} />
              </span>
              <div>
                <h2 className="text-xl font-semibold">{choice.title}</h2>
                <p className="text-sm text-stone-400">{selected === "manager" ? "Sign in to manage the tracker" : "Enter your name to continue"}</p>
              </div>
            </div>
            {selected === "manager" ? <div className="space-y-5">
              <label className="block text-sm font-medium text-stone-300">Email
                <input required type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
              </label>
              <label className="block text-sm font-medium text-stone-300">Password
                <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
              </label>
            </div> : <label className="block text-sm font-medium text-stone-300">Your name
              <input required maxLength={120} autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name" className={inputClass} />
            </label>}
            <button disabled={busy} className="mt-7 w-full rounded-lg bg-amber-500 py-3 font-semibold text-stone-950 hover:bg-amber-400 disabled:opacity-50">
              {busy ? "Please wait…" : selected === "manager" ? "Sign in" : "Enter tracker"}
            </button>
            {selected !== "manager" && <p className="mt-4 text-center text-xs text-stone-400">Your name will appear on the actions you record.</p>}
          </form>
        </div>}

        {state.status === "unassigned" && !canEnter && <p role="alert" className="text-center text-red-300">This account's access is unavailable. Please contact your manager.</p>}
        {state.status === "error" && <p role="alert" className="text-center text-red-300">Access could not be verified. Check your connection and the Firestore rules, then retry.</p>}
        {state.status === "configuration" && <p role="alert" className="text-center text-red-300">{state.message}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
        {state.status !== "signed-out" && state.status !== "configuration" && !waiting && (
          <div className="mt-5 flex justify-center gap-3">
            {!canEnter && <button onClick={() => window.location.reload()} className="rounded-lg border border-stone-600 px-4 py-2 text-sm">Retry</button>}
            {state.user && <button disabled={busy} onClick={logout} className="rounded-lg border border-stone-600 px-4 py-2 text-sm disabled:opacity-50">Leave / switch user</button>}
          </div>
        )}
      </div>
    </div>
  );
}
