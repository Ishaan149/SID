import React, { useState, useEffect, useRef } from "react";
import {
  Flame, Package, Play, CheckCircle2, Truck, AlertTriangle, Plus, X,
  Trash2, Download, Users, LayoutDashboard, ClipboardList, ShieldCheck, LogIn,
} from "lucide-react";
import { createConfiguredDataService } from "./data/service.js";

/* ------------------------------------------------------------------ */
/*  AETE — Hot-Dip Galvanizing Tracker                                 */
/*  Four gates: Received -> Processing -> Ready -> Dispatched          */
/*  Persistence is handled by the configured data service.            */
/* ------------------------------------------------------------------ */

const dataService = createConfiguredDataService();

const shiftLabel = (role) =>
  role === "shiftA" ? "Shift A"
    : role === "shiftB" ? "Shift B"
    : role === "plant" ? "Plant"
    : null;

// who may perform the next action, given the batch's current stage
function canActOn(role, status) {
  if (status === "Received" || status === "Processing")
    return role === "shiftA" || role === "shiftB"; // shift supervisors process
  if (status === "Ready") return role === "plant"; // plant supervisor dispatches
  return false;
}

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const nowISO = () => new Date().toISOString();

function fmt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
    ", " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}
const daysSince = (iso) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0;

/* ---- stage styling (color encodes where the batch is) ------------- */
const STAGE = {
  Received: {
    spine: "bg-amber-500",
    chip: "bg-amber-100 text-amber-800 border-amber-200",
    icon: Package,
  },
  Processing: {
    spine: "bg-sky-500",
    chip: "bg-sky-100 text-sky-800 border-sky-200",
    icon: Play,
  },
  Ready: {
    spine: "bg-emerald-500",
    chip: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: CheckCircle2,
  },
  Dispatched: {
    spine: "bg-slate-400",
    chip: "bg-slate-100 text-slate-600 border-slate-200",
    icon: Truck,
  },
};
const ORDER = ["Received", "Processing", "Ready", "Dispatched"];
const NEXT = {
  Received: { status: "Processing", label: "Take into process", btn: "bg-sky-600 hover:bg-sky-700" },
  Processing: { status: "Ready", label: "Mark ready", btn: "bg-emerald-600 hover:bg-emerald-700" },
  Ready: { status: "Dispatched", label: "Mark dispatched", btn: "bg-slate-700 hover:bg-slate-800" },
};

/* ---- discrepancy flags (the anti-scam checks) -------------------- */
function flagsFor(b) {
  const out = [];
  const done = b.status === "Ready" || b.status === "Dispatched";
  if (done && b.piecesIn > 0 && b.piecesOut != null && b.piecesIn - b.piecesOut !== 0) {
    const d = b.piecesIn - b.piecesOut;
    out.push(`${Math.abs(d)} piece${Math.abs(d) === 1 ? "" : "s"} ${d > 0 ? "missing" : "extra"}`);
  }
  if (b.status === "Ready" && daysSince(b.readyAt) > 3)
    out.push(`ready ${daysSince(b.readyAt)} days, not dispatched`);
  if (b.status === "Processing" && daysSince(b.processAt) > 3)
    out.push(`in process ${daysSince(b.processAt)} days`);
  return out;
}

/* ---- first-run seed so the screens aren't empty ------------------ */
function makeSeed() {
  const roster = [
    { id: uid(), name: "Yousef Nasser", role: "Plant Supervisor", shift: "Plant", active: true },
    { id: uid(), name: "Ali Hassan", role: "Shift A Supervisor", shift: "Shift A", active: true },
    { id: uid(), name: "Rashid Karim", role: "Shift B Supervisor", shift: "Shift B", active: true },
    { id: uid(), name: "Mohammed Farsi", role: "Operations Manager", shift: null, active: true },
  ];
  const t = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const batches = [
    { id: uid(), jobNo: "JC-1042", customer: "Al-Rashid Trading", parts: "Cable tray 300mm",
      piecesIn: 120, weightIn: 850, status: "Received",
      receivedBy: "Yousef Nasser", receivedShift: "Plant", receivedAt: t(2), notes: "" },
    { id: uid(), jobNo: "JC-1041", customer: "Zamil Structural", parts: "Handrail sections",
      piecesIn: 60, weightIn: 1200, status: "Processing",
      receivedBy: "Yousef Nasser", receivedShift: "Plant", receivedAt: t(8),
      processBy: "Ali Hassan", processShift: "Shift A", processAt: t(5), notes: "" },
    { id: uid(), jobNo: "JC-1038", customer: "Gulf Fabrication", parts: "M16 bolts (drum)",
      piecesIn: 1, weightIn: 300, status: "Ready",
      receivedBy: "Yousef Nasser", receivedShift: "Plant", receivedAt: t(144),
      processBy: "Ali Hassan", processShift: "Shift A", processAt: t(140),
      readyBy: "Ali Hassan", readyShift: "Shift A", readyAt: t(120), piecesOut: 1, weightOut: 315, notes: "" },
    { id: uid(), jobNo: "JC-1035", customer: "Al-Rashid Trading", parts: "Angle iron 50x50",
      piecesIn: 200, weightIn: 1600, status: "Dispatched",
      receivedBy: "Yousef Nasser", receivedShift: "Plant", receivedAt: t(60),
      processBy: "Rashid Karim", processShift: "Shift B", processAt: t(52),
      readyBy: "Rashid Karim", readyShift: "Shift B", readyAt: t(40), piecesOut: 196, weightOut: 1660,
      dispatchBy: "Yousef Nasser", dispatchShift: "Plant", dispatchAt: t(24), notes: "" },
  ];
  const activity = [
    { id: uid(), at: t(2), jobNo: "JC-1042", action: "Received", who: "Yousef Nasser", shift: "Plant" },
    { id: uid(), at: t(5), jobNo: "JC-1041", action: "Into process", who: "Ali Hassan", shift: "Shift A" },
    { id: uid(), at: t(24), jobNo: "JC-1035", action: "Dispatched", who: "Yousef Nasser", shift: "Plant" },
  ];
  return { roster, batches, activity, settings: { pin: "1234" } };
}

/* ================================================================== */

export default function App() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dataNotice, setDataNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState(null); // null | { role: 'shiftA' | 'shiftB' | 'manager' }
  const [tab, setTab] = useState("batches");

  const [batches, setBatches] = useState([]);
  const [roster, setRoster] = useState([]);
  const [activity, setActivity] = useState([]);
  const [settings, setSettings] = useState({ pin: "1234" });
  const initialLoad = useRef(null);
  const saveInProgress = useRef(false);

  const [filter, setFilter] = useState("All");
  const [action, setAction] = useState(null); // { batch }
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!initialLoad.current) {
      initialLoad.current = (async () => {
        const data = await dataService.load();
        if (data.roster.length) return data;
        const seed = makeSeed();
        await dataService.seed(seed);
        return seed;
      })();
    }
    initialLoad.current.then((data) => {
      if (!alive) return;
      setRoster(data.roster); setBatches(data.batches);
      setActivity(data.activity); setSettings(data.settings);
      if (dataService.status.fallbackUsed) {
        setDataNotice("Firebase emulator unavailable — using localStorage on this device.");
      }
      setLoading(false);
    }).catch((error) => {
      console.error("Tracker data load failed", error);
      if (alive) { setLoadError(true); setLoading(false); }
    });
    return () => { alive = false; };
  }, []);

  const activeStaff = roster.filter((s) => s.active);

  async function logActivity(jobNo, actionLabel, who, shift) {
    const entry = { id: uid(), at: nowISO(), jobNo, action: actionLabel, who, shift: shift || null };
    try {
      await dataService.addActivity(entry);
      setActivity((prev) => [entry, ...prev].slice(0, 120));
    } catch (error) {
      console.error("Activity save failed", error);
      setSaveError("The change was saved, but its activity entry was not. Please check the activity log.");
    }
  }

  async function saveChange(label, operation, commit, after) {
    if (saveInProgress.current) return false;
    saveInProgress.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await operation();
      commit();
      if (dataService.status.fallbackUsed) {
        setDataNotice("Firebase emulator unavailable — using localStorage on this device.");
      }
      if (after) await after();
      return true;
    } catch (error) {
      console.error(`${label} failed`, error);
      setSaveError(`${label} could not be saved. Please try again.`);
      return false;
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  }

  async function addBatch(form) {
    if (session?.role !== "plant") return;
    const shift = session ? shiftLabel(session.role) : null;
    const b = {
      id: uid(), jobNo: form.jobNo.trim() || "JC-?", customer: form.customer.trim(),
      parts: form.parts.trim(), piecesIn: Number(form.piecesIn) || 0,
      weightIn: Number(form.weightIn) || 0, status: "Received",
      receivedBy: form.receivedBy, receivedAt: nowISO(), receivedShift: shift, notes: "",
    };
    return saveChange("Batch", () => dataService.addBatch(b), () => {
      setBatches((prev) => [b, ...prev]);
      setShowAdd(false);
    }, () => logActivity(b.jobNo, "Received", b.receivedBy, shift));
  }

  async function applyAction(batch, who, extra) {
    const step = NEXT[batch.status];
    if (!step || !canActOn(session?.role, batch.status)) return;
    const shift = session ? shiftLabel(session.role) : null;
    const patch = { status: step.status };
    if (batch.status === "Received") { patch.processBy = who; patch.processAt = nowISO(); patch.processShift = shift; }
    if (batch.status === "Processing") {
      patch.readyBy = who; patch.readyAt = nowISO(); patch.readyShift = shift;
      patch.piecesOut = Number(extra.piecesOut) || 0;
      patch.weightOut = Number(extra.weightOut) || 0;
    }
    if (batch.status === "Ready") { patch.dispatchBy = who; patch.dispatchAt = nowISO(); patch.dispatchShift = shift; }
    return saveChange("Status update", () => dataService.updateBatch(batch.id, patch), () => {
      setBatches((prev) => prev.map((b) => b.id === batch.id ? { ...b, ...patch } : b));
      setAction(null);
    }, () => logActivity(batch.jobNo,
      batch.status === "Received" ? "Into process" : batch.status === "Processing" ? "Ready" : "Dispatched",
      who, shift));
  }

  async function removeBatch(id) {
    if (!window.confirm("Delete this batch? This cannot be undone.")) return;
    return saveChange("Batch deletion", () => dataService.deleteBatch(id), () => {
      setBatches((prev) => prev.filter((b) => b.id !== id));
    });
  }

  /* roster ops */
  function addStaff(name, r, shift) {
    if (!name.trim()) return;
    const staff = { id: uid(), name: name.trim(), role: r, shift: shift || null, active: true };
    return saveChange("Staff member", () => dataService.addStaff(staff), () => {
      setRoster((prev) => [...prev, staff]);
    });
  }
  function toggleStaff(id) {
    const staff = roster.find((s) => s.id === id);
    const patch = { active: !staff.active };
    return saveChange("Roster update", () => dataService.updateStaff(id, patch), () => {
      setRoster((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
    });
  }
  function removeStaff(id) {
    if (!window.confirm("Remove this staff member from the roster?")) return;
    return saveChange("Staff removal", () => dataService.deleteStaff(id), () => {
      setRoster((prev) => prev.filter((s) => s.id !== id));
    });
  }
  function changePin(p) {
    return saveChange("Manager PIN", () => dataService.updateSettings({ pin: p }), () => {
      setSettings((prev) => ({ ...prev, pin: p }));
    });
  }

  function exportCSV() {
    const cols = ["Job No","Customer","Parts","Status","Pieces In","Weight In","Pieces Out",
      "Weight Out","Piece Balance","Days in Plant","Received By","Received At","Into Process By",
      "Ready By","Dispatched By","Dispatched At"];
    const rows = batches.map((b) => [
      b.jobNo, b.customer, b.parts, b.status, b.piecesIn, b.weightIn,
      b.piecesOut ?? "", b.weightOut ?? "",
      b.piecesOut != null ? b.piecesIn - b.piecesOut : "",
      daysSince(b.dispatchAt || b.receivedAt), b.receivedBy || "", fmt(b.receivedAt),
      b.processBy || "", b.readyBy || "", b.dispatchBy || "", fmt(b.dispatchAt),
    ]);
    const csv = [cols, ...rows]
      .map((r) => r.map((c) => {
        const value = String(c);
        const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
        return `"${safe.replace(/"/g, '""')}"`;
      }).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aete-hdg-batches.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  }

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-100 text-stone-500">
        Loading tracker…
      </div>
    );

  if (loadError)
    return (
      <div className="min-h-screen flex flex-col gap-3 items-center justify-center bg-stone-100 text-stone-700">
        <p>Tracker data could not be loaded. Check browser storage and try again.</p>
        <button className="px-3 py-2 rounded-md bg-stone-900 text-white" onClick={() => window.location.reload()}>Retry</button>
      </div>
    );

  if (!session)
    return <RolePicker correctPin={settings.pin} storageKind={dataService.status.kind} onPick={setSession} />;

  const counts = ORDER.reduce((m, s) => ((m[s] = batches.filter((b) => b.status === s).length), m), {});
  const flagged = batches.filter((b) => flagsFor(b).length);
  const shown = filter === "All" ? batches : batches.filter((b) => b.status === filter);
  const orderRank = { Received: 0, Processing: 1, Ready: 2, Dispatched: 3 };
  const sortedShown = [...shown].sort(
    (a, b) => orderRank[a.status] - orderRank[b.status] ||
      new Date(b.receivedAt) - new Date(a.receivedAt)
  );

  const isMgr = session.role === "manager";
  const currentShift = shiftLabel(session.role);

  const TABS = [
    { id: "batches", label: "Batches", icon: ClipboardList, show: true },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
    { id: "data", label: "Data", icon: Download, show: isMgr },
    { id: "roster", label: "Roster", icon: Users, show: isMgr },
  ].filter((t) => t.show);

  return (
    <div
      className="min-h-screen bg-stone-100 text-stone-800"
      style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial" }}
    >
      {/* header */}
      <header className="bg-stone-900 text-white">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-9 h-9 rounded-md bg-amber-500 text-stone-900">
              <Flame size={20} strokeWidth={2.5} />
            </span>
            <div className="leading-tight">
              <div className="font-bold tracking-tight">AETE</div>
              <div className="text-[11px] text-stone-400 -mt-0.5">Hot-Dip Galvanizing Tracker</div>
            </div>
          </div>
          <button
            onClick={() => { setSession(null); setTab("batches"); }}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-stone-700 hover:bg-stone-800"
          >
            {isMgr ? <ShieldCheck size={15} className="text-amber-400" /> : <LogIn size={15} />}
            {isMgr ? "Manager" : currentShift}
            <span className="text-stone-500">· switch</span>
          </button>
        </div>
        <nav className="max-w-2xl mx-auto px-2 flex">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm border-b-2 ${
                  on ? "border-amber-500 text-white" : "border-transparent text-stone-400 hover:text-stone-200"
                }`}
              >
                <t.icon size={16} /> <span>{t.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 pb-28">
        {dataNotice && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {dataNotice}
          </div>
        )}
        {saveError && (
          <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {saveError}
          </div>
        )}
        {/* ---------------- BATCHES ---------------- */}
        {tab === "batches" && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1 mb-3">
              {["All", ...ORDER].map((f) => {
                const on = filter === f;
                const n = f === "All" ? batches.length : counts[f];
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-sm border ${
                      on ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-300 text-stone-600"
                    }`}
                  >
                    {f} <span className="tabular-nums opacity-70">{n}</span>
                  </button>
                );
              })}
            </div>

            {sortedShown.length === 0 ? (
              <Empty text="No batches here yet. Log the first one below." />
            ) : (
              <div className="space-y-2.5">
                {sortedShown.map((b) => (
                  <BatchRow key={b.id} b={b} role={session.role} saving={saving} onAct={() => setAction({ batch: b })}
                    canDelete={isMgr} onDelete={() => removeBatch(b.id)} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ---------------- DASHBOARD ---------------- */}
        {tab === "dashboard" && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {ORDER.map((s) => (
                <div key={s} className="bg-white rounded-lg border border-stone-200 p-3">
                  <div className={`w-6 h-1.5 rounded-full mb-2 ${STAGE[s].spine}`} />
                  <div className="text-2xl font-bold tabular-nums leading-none">{counts[s]}</div>
                  <div className="text-[11px] text-stone-500 mt-1">{s}</div>
                </div>
              ))}
            </div>

            <section className="bg-white rounded-lg border border-stone-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-100">
                <AlertTriangle size={16} className="text-red-600" />
                <h2 className="font-semibold text-sm">Needs attention</h2>
                <span className="ml-auto text-xs tabular-nums text-stone-500">{flagged.length}</span>
              </div>
              {flagged.length === 0 ? (
                <p className="px-4 py-6 text-sm text-stone-500 text-center">
                  All clear — pieces reconcile and nothing is stuck.
                </p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {flagged.map((b) => (
                    <li key={b.id} className="px-4 py-3 flex items-start gap-3">
                      <span className={`mt-1 inline-block w-1.5 h-1.5 rounded-full ${STAGE[b.status].spine}`} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {b.jobNo} · <span className="text-stone-500 font-normal">{b.customer}</span>
                        </div>
                        <div className="text-xs text-red-700">{flagsFor(b).join(" · ")}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-white rounded-lg border border-stone-200 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-stone-100">
                <h2 className="font-semibold text-sm">Recent activity</h2>
              </div>
              {activity.length === 0 ? (
                <p className="px-4 py-6 text-sm text-stone-500 text-center">Nothing logged yet.</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {activity.slice(0, 15).map((a) => (
                    <li key={a.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                      <span className="font-medium w-16 shrink-0 tabular-nums">{a.jobNo}</span>
                      <span className="text-stone-600">{a.action}</span>
                      <span className="text-stone-400">·</span>
                      <span className="text-stone-600">{a.who}{a.shift ? ` (${a.shift})` : ""}</span>
                      <span className="ml-auto text-xs text-stone-400 shrink-0">{fmt(a.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* ---------------- DATA ---------------- */}
        {isMgr && tab === "data" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-stone-500">{batches.length} batches</p>
              <button onClick={exportCSV}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-stone-900 text-white hover:bg-stone-800">
                <Download size={15} /> Export CSV
              </button>
            </div>
            <div className="bg-white rounded-lg border border-stone-200 overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-left text-stone-500 border-b border-stone-200">
                    {["Job No","Customer","Status","Pcs in","Pcs out","Bal","Days","Rec. by","Disp. by",""].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {batches.map((b) => {
                    const bal = b.piecesOut != null ? b.piecesIn - b.piecesOut : null;
                    return (
                      <tr key={b.id}>
                        <td className="px-3 py-2 font-medium tabular-nums">{b.jobNo}</td>
                        <td className="px-3 py-2">{b.customer}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs border ${STAGE[b.status].chip}`}>
                            {b.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{b.piecesIn}</td>
                        <td className="px-3 py-2 tabular-nums">{b.piecesOut ?? "—"}</td>
                        <td className={`px-3 py-2 tabular-nums font-medium ${bal ? "text-red-600" : "text-stone-400"}`}>
                          {bal == null ? "—" : bal}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{daysSince(b.dispatchAt || b.receivedAt)}</td>
                        <td className="px-3 py-2 text-stone-600">{b.receivedBy || "—"}</td>
                        <td className="px-3 py-2 text-stone-600">{b.dispatchBy || "—"}</td>
                        <td className="px-3 py-2">
                          <button disabled={saving} onClick={() => removeBatch(b.id)} className="text-stone-400 hover:text-red-600 disabled:opacity-50">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------------- ROSTER ---------------- */}
        {isMgr && tab === "roster" && (
          <RosterPanel roster={roster} storageKind={dataService.status.kind} saving={saving} onAdd={addStaff} onToggle={toggleStaff}
            onRemove={removeStaff} onPin={changePin} />
        )}
      </main>

      {/* floating "log batch" button on batches tab */}
      {tab === "batches" && session.role === "plant" && (
        <button
          onClick={() => setShowAdd(true)}
          disabled={saving}
          className="fixed bottom-5 right-5 flex items-center gap-2 px-4 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-stone-900 font-semibold shadow-lg shadow-amber-500/30"
        >
          <Plus size={20} strokeWidth={2.5} /> Receive batch
        </button>
      )}

      {action && (
        <ActionModal batch={action.batch} staff={activeStaff} shift={currentShift} saving={saving} error={saveError}
          onClose={() => { if (!saving) setAction(null); }} onConfirm={applyAction} />
      )}
      {showAdd && (
        <AddModal staff={activeStaff} shift={currentShift} saving={saving} error={saveError}
          onClose={() => { if (!saving) setShowAdd(false); }} onAdd={addBatch} />
      )}
    </div>
  );
}

/* ------------------------------- pieces --------------------------- */

function Empty({ text }) {
  return (
    <div className="bg-white rounded-lg border border-dashed border-stone-300 py-12 text-center text-sm text-stone-500">
      {text}
    </div>
  );
}

function BatchRow({ b, role, saving, onAct, canDelete, onDelete }) {
  const fl = flagsFor(b);
  const step = NEXT[b.status];
  const allowed = step && canActOn(role, b.status);
  const waitingHint =
    b.status === "Received" ? "Waiting for a shift to take it in"
      : b.status === "Processing" ? `In process${b.processShift ? ` · ${b.processShift}` : ""}`
      : b.status === "Ready" ? "Ready · waiting for plant to dispatch"
      : "Complete — left the plant";
  return (
    <div className="bg-white rounded-lg border border-stone-200 flex overflow-hidden">
      <div className={`w-1.5 shrink-0 ${STAGE[b.status].spine}`} />
      <div className="flex-1 min-w-0 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold tabular-nums">{b.jobNo}</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${STAGE[b.status].chip}`}>
            {b.status}
          </span>
          {fl.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 border border-red-200">
              <AlertTriangle size={12} /> {fl[0]}
            </span>
          )}
        </div>
        <div className="text-sm text-stone-600 mt-0.5">{b.customer} · {b.parts}</div>
        <div className="text-xs text-stone-400 mt-1 tabular-nums">
          {b.piecesIn} pcs · {b.weightIn} kg in
          {b.piecesOut != null && <> → {b.piecesOut} pcs · {b.weightOut} kg out</>}
        </div>
        <div className="text-xs text-stone-400 mt-0.5">
          {b.receivedBy && <>Received by {b.receivedBy}{b.receivedShift ? ` (${b.receivedShift})` : ""}, {fmt(b.receivedAt)}</>}
          {b.dispatchAt && <> · Dispatched by {b.dispatchBy}{b.dispatchShift ? ` (${b.dispatchShift})` : ""}, {fmt(b.dispatchAt)}</>}
        </div>

        <div className="flex items-center gap-2 mt-2.5">
          {allowed ? (
            <button disabled={saving} onClick={onAct}
              className={`text-sm font-medium text-white px-3 py-1.5 rounded-md ${step.btn}`}>
              {step.label}
            </button>
          ) : (
            <span className="text-xs text-stone-400">{waitingHint}</span>
          )}
          {canDelete && (
            <button disabled={saving} onClick={onDelete} className="ml-auto text-stone-300 hover:text-red-600 disabled:opacity-50">
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{title}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X size={22} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const field = "w-full border border-stone-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400";
const lbl = "block text-xs font-medium text-stone-500 mb-1";

function WhoSelect({ staff, value, onChange, shift }) {
  const filtered = shift ? staff.filter((s) => s.shift === shift) : staff;
  return (
    <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select name…</option>
      {filtered.map((s) => <option key={s.id} value={s.name}>{s.name} — {s.shift || s.role}</option>)}
    </select>
  );
}

function ActionModal({ batch, staff, shift, saving, error, onClose, onConfirm }) {
  const step = NEXT[batch.status];
  const [who, setWho] = useState("");
  const [piecesOut, setPiecesOut] = useState(batch.piecesIn ?? "");
  const [weightOut, setWeightOut] = useState("");
  const needQty = batch.status === "Processing";
  const ok = who && (!needQty || (
    piecesOut !== "" && Number.isInteger(Number(piecesOut)) && Number(piecesOut) >= 0 &&
    weightOut !== "" && Number.isFinite(Number(weightOut)) && Number(weightOut) >= 0
  ));
  return (
    <Sheet title={step.label} onClose={onClose}>
      <div className="mb-4 text-sm text-stone-600">
        {batch.jobNo} · {batch.customer} · {batch.parts}
        {shift && <span className="ml-1 text-stone-400">· acting as {shift}</span>}
      </div>
      <div className="space-y-3">
        {needQty && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Pieces out</label>
              <input type="number" min="0" step="1" className={field} value={piecesOut}
                onChange={(e) => setPiecesOut(e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Weight out (kg)</label>
              <input type="number" min="0" step="any" className={field} value={weightOut}
                onChange={(e) => setWeightOut(e.target.value)} />
            </div>
          </div>
        )}
        {needQty && Number(piecesOut) !== batch.piecesIn && piecesOut !== "" && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <AlertTriangle size={13} /> {batch.piecesIn} pieces came in — this won't match.
          </p>
        )}
        <div>
          <label className={lbl}>Who is doing this?</label>
          <WhoSelect staff={staff} value={who} onChange={setWho} shift={shift} />
        </div>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <button disabled={!ok || saving}
        onClick={() => onConfirm(batch, who, { piecesOut, weightOut })}
        className={`w-full mt-5 py-2.5 rounded-md font-semibold text-white ${ok ? step.btn : "bg-stone-300"}`}>
        {saving ? "Saving…" : step.label}
      </button>
    </Sheet>
  );
}

function AddModal({ staff, shift, saving, error, onClose, onAdd }) {
  const [f, setF] = useState({ jobNo: "", customer: "", parts: "", piecesIn: "", weightIn: "", receivedBy: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ok = f.jobNo.trim() && f.customer.trim() && f.parts.trim() && f.receivedBy &&
    f.piecesIn !== "" && Number.isInteger(Number(f.piecesIn)) && Number(f.piecesIn) >= 0 &&
    f.weightIn !== "" && Number.isFinite(Number(f.weightIn)) && Number(f.weightIn) >= 0;
  return (
    <Sheet title="Log a received batch" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Job card no</label>
            <input className={field} value={f.jobNo} onChange={set("jobNo")} placeholder="JC-1043" /></div>
          <div><label className={lbl}>Customer</label>
            <input className={field} value={f.customer} onChange={set("customer")} /></div>
        </div>
        <div><label className={lbl}>Parts description</label>
          <input className={field} value={f.parts} onChange={set("parts")} placeholder="Cable tray, bolts…" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Pieces in</label>
            <input type="number" min="0" step="1" className={field} value={f.piecesIn} onChange={set("piecesIn")} /></div>
          <div><label className={lbl}>Weight in (kg)</label>
            <input type="number" min="0" step="any" className={field} value={f.weightIn} onChange={set("weightIn")} /></div>
        </div>
        <div><label className={lbl}>Received by</label>
          <WhoSelect staff={staff} value={f.receivedBy} onChange={(v) => setF({ ...f, receivedBy: v })} shift={shift} /></div>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <button disabled={!ok || saving} onClick={() => onAdd(f)}
        className={`w-full mt-5 py-2.5 rounded-md font-semibold ${ok ? "bg-amber-500 hover:bg-amber-600 text-stone-900" : "bg-stone-300 text-white"}`}>
        {saving ? "Saving…" : "Log batch as received"}
      </button>
    </Sheet>
  );
}

function RolePicker({ correctPin, storageKind, onPick }) {
  const [askPin, setAskPin] = useState(false);
  if (askPin)
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <PinCard correct={correctPin} onBack={() => setAskPin(false)}
            onOk={() => onPick({ role: "manager" })} />
        </div>
      </div>
    );
  return (
    <div className="min-h-screen bg-stone-900 text-white flex flex-col items-center justify-center p-6">
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center w-10 h-10 rounded-md bg-amber-500 text-stone-900">
          <Flame size={22} strokeWidth={2.5} />
        </span>
        <div className="text-xl font-bold tracking-tight">AETE</div>
      </div>
      <p className="text-stone-400 text-sm mt-1 mb-8">Hot-Dip Galvanizing Tracker</p>
      <p className="text-stone-500 text-xs -mt-6 mb-6">
        {storageKind === "firebase" ? "Demo data is shared through the local Firestore emulator." : "Demo data is saved on this device."}
      </p>
      <div className="w-full max-w-sm space-y-3">
        <p className="text-xs text-stone-500">Who's using the tracker?</p>
        <PickBtn onClick={() => onPick({ role: "plant" })} icon={Package}
          color="bg-amber-500" title="Plant Supervisor" sub="Receive & dispatch material" />
        <PickBtn onClick={() => onPick({ role: "shiftA" })} icon={Play}
          color="bg-sky-500" title="Shift A Supervisor" sub="Take into process · mark ready" />
        <PickBtn onClick={() => onPick({ role: "shiftB" })} icon={Play}
          color="bg-emerald-500" title="Shift B Supervisor" sub="Take into process · mark ready" />
        <PickBtn onClick={() => setAskPin(true)} icon={ShieldCheck}
          color="bg-violet-500" title="Operations Manager" sub="Oversee everything · needs PIN" />
      </div>
    </div>
  );
}

function PickBtn({ onClick, icon: Icon, color, title, sub }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 p-4 rounded-lg bg-stone-800 hover:bg-stone-700 border border-stone-700 text-left">
      <span className={`grid place-items-center w-10 h-10 rounded-md ${color} text-stone-900`}>
        <Icon size={20} />
      </span>
      <span className="flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-stone-400">{sub}</span>
      </span>
    </button>
  );
}

function PinCard({ correct, onBack, onOk }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  return (
    <div className="bg-stone-800 rounded-xl p-6 text-white">
      <h3 className="font-bold text-lg mb-1">Manager PIN</h3>
      <p className="text-sm text-stone-400 mb-4">For data export and roster management.</p>
      <input type="password" inputMode="numeric" autoFocus value={pin}
        onChange={(e) => { setPin(e.target.value); setErr(false); }} placeholder="PIN"
        className="w-full bg-stone-900 border border-stone-700 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
      {err && <p className="text-xs text-red-400 mt-1">That PIN doesn't match.</p>}
      {correct === "1234" && <p className="text-xs text-stone-500 mt-2">Default is 1234 — change it in Roster.</p>}
      <div className="flex gap-2 mt-4">
        <button onClick={onBack}
          className="flex-1 py-2.5 rounded-md border border-stone-600 text-stone-300 hover:bg-stone-700">Back</button>
        <button onClick={() => (pin === correct ? onOk() : setErr(true))}
          className="flex-1 py-2.5 rounded-md font-semibold bg-amber-500 text-stone-900 hover:bg-amber-600">Unlock</button>
      </div>
    </div>
  );
}

function RosterPanel({ roster, storageKind, saving, onAdd, onToggle, onRemove, onPin }) {
  const [name, setName] = useState("");
  const [r, setR] = useState("Shift A Supervisor");
  const [shift, setShift] = useState("Shift A");
  const [newPin, setNewPin] = useState("");
  const roles = ["Shift A Supervisor", "Shift B Supervisor", "Plant Supervisor", "Operations Manager"];
  return (
    <div className="space-y-4">
      <section className="bg-white rounded-lg border border-stone-200 p-4">
        <h2 className="font-semibold text-sm mb-3">Add staff to the roster</h2>
        <p className="text-xs text-stone-500 mb-3">
          These names fill the dropdowns supervisors pick from — no one can type a name that isn't here.
        </p>
        <div className="space-y-2">
          <input className={field} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2">
            <select className={field} value={r} onChange={(e) => {
              const role = e.target.value;
              setR(role);
              setShift(role.startsWith("Shift A") ? "Shift A" : role.startsWith("Shift B") ? "Shift B" : role.startsWith("Plant") ? "Plant" : "");
            }}>
              {roles.map((x) => <option key={x}>{x}</option>)}
            </select>
            <select className={field} value={shift} onChange={(e) => setShift(e.target.value)}>
              <option value="">No shift</option>
              <option>Plant</option>
              <option>Shift A</option>
              <option>Shift B</option>
            </select>
            <button disabled={saving} onClick={async () => { if (await onAdd(name, r, shift)) setName(""); }}
              className="px-4 shrink-0 rounded-md bg-amber-500 hover:bg-amber-600 text-stone-900"><Plus size={18} /></button>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-lg border border-stone-200 divide-y divide-stone-100">
        {roster.map((s) => (
          <div key={s.id} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-stone-500">{s.role}{s.shift ? ` · ${s.shift}` : ""}</div>
            </div>
            <button disabled={saving} onClick={() => onToggle(s.id)}
              className={`text-xs px-2.5 py-1 rounded-full border ${s.active ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-stone-100 text-stone-500 border-stone-200"}`}>
              {s.active ? "Active" : "Off"}
            </button>
            <button disabled={saving} onClick={() => onRemove(s.id)} className="text-stone-300 hover:text-red-600 disabled:opacity-50"><Trash2 size={16} /></button>
          </div>
        ))}
      </section>

      <section className="bg-white rounded-lg border border-stone-200 p-4">
        <h2 className="font-semibold text-sm mb-2">Manager PIN</h2>
        <div className="flex gap-2">
          <input type="password" className={field} placeholder="New PIN" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
          <button disabled={saving} onClick={async () => { if (newPin.trim() && await onPin(newPin.trim())) setNewPin(""); }}
            className="px-4 rounded-md bg-stone-900 text-white text-sm hover:bg-stone-800">Update</button>
        </div>
        <p className="text-xs text-stone-400 mt-2">
          {storageKind === "firebase" ? "This demo PIN is stored in the local Firestore emulator." : "This PIN is stored only in this browser."}
        </p>
      </section>
    </div>
  );
}
