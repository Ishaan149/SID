import React, { useState, useEffect, useRef } from "react";
import {
  Flame, Package, Play, CheckCircle2, Truck, AlertTriangle, Plus, X,
  Trash2, Archive, Download, Users, LayoutDashboard, ClipboardList, ShieldCheck, LogIn,
} from "lucide-react";
import { createConfiguredDataService } from "./data/service.js";
import AuthGate from "./auth/AuthGate.jsx";
import { dateOf, newId, STAFF_SHIFTS } from "./data/mutations.js";
import { inspectLegacyStorage, legacyBackup } from "./data/localStorageAdapter.js";
import { serializeCSV } from "./data/csv.js";

/* ------------------------------------------------------------------ */
/*  AETE — Hot-Dip Galvanizing Tracker                                 */
/*  Four gates: Received -> Processing -> Ready -> Dispatched          */
/*  Persistence is handled by the configured data service.            */
/* ------------------------------------------------------------------ */

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

function fmt(value) {
  const date = dateOf(value);
  return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " +
    date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";
}
const daysSince = (value) => {
  const date = dateOf(value);
  return date ? Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000)) : 0;
};
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
  if (done && b.piecesOut != null && b.piecesIn - b.piecesOut !== 0) {
    const d = b.piecesIn - b.piecesOut;
    out.push(`${Math.abs(d)} piece${Math.abs(d) === 1 ? "" : "s"} ${d > 0 ? "missing" : "extra"}`);
  }
  if (b.status === "Ready" && daysSince(b.readyAt) > 3)
    out.push(`ready ${daysSince(b.readyAt)} days, not dispatched`);
  if (b.status === "Processing" && daysSince(b.processAt) > 3)
    out.push(`in process ${daysSince(b.processAt)} days`);
  return out;
}

/* ================================================================== */

export default function App() {
  return (
    <AuthGate>
      {(session, logout, logoutError) => (
        <Tracker key={`${session.uid}:${session.role}`} session={session} onLogout={logout} logoutError={logoutError} />
      )}
    </AuthGate>
  );
}

function Tracker({ session, onLogout, logoutError }) {
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [dataService] = useState(() => createConfiguredDataService({ uid: session.uid, getSession: () => sessionRef.current }));
  const [dataReady, setDataReady] = useState(false);
  const [connection, setConnection] = useState({ connected: false, error: null, pendingRequest: null });
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("batches");
  const [allBatches, setAllBatches] = useState([]);
  const [roster, setRoster] = useState([]);
  const [activity, setActivity] = useState([]);
  const [refresh, setRefresh] = useState(0);
  const [showArchives, setShowArchives] = useState(false);
  const [archive, setArchive] = useState(null);
  const [history, setHistory] = useState(null);
  const alive = useRef(true);
  const saveInProgress = useRef(false);
  const saveTimer = useRef(null);
  const [legacy] = useState(() => {
    if (session.role !== "manager") return { available: true, present: false };
    try { return inspectLegacyStorage(window.localStorage); }
    catch { return { available: false, present: false }; }
  });
  const [filter, setFilter] = useState("All");
  const [action, setAction] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    alive.current = true;
    const stop = dataService.subscribe((data, status) => {
      if (!alive.current) return;
      setConnection(status);
      if (data) {
        setAllBatches(data.batches); setRoster(data.roster); setActivity(data.activity);
        setDataReady(true);
      }
    });
    return () => { alive.current = false; stop(); clearTimeout(saveTimer.current); };
  }, [dataService, refresh]);

  const batches = allBatches.filter((b) => !b.archived);
  const archivedBatches = allBatches.filter((b) => b.archived);
  const tableBatches = showArchives ? archivedBatches : batches;
  const activeStaff = roster.filter((s) => s.active);
  const writeBlocked = saving || !connection.connected || !session.permissionsVerified || !!connection.pendingRequest;

  async function saveChange(label, operation, after) {
    if (saveInProgress.current) return false;
    saveInProgress.current = true;
    setSaving(true); setSaveError(""); setSaveNotice("");
    saveTimer.current = setTimeout(() => {
      if (alive.current) setSaveNotice("Waiting for Firebase to confirm this save. It may still complete; do not submit another copy.");
    }, 15000);
    try {
      await operation();
      if (alive.current) { setSaveNotice(`${label} saved to the shared tracker.`); if (after) after(); }
      return true;
    } catch (error) {
      if (alive.current) { setSaveNotice(""); setSaveError(error.message || `${label} could not be confirmed.`); }
      return false;
    } finally {
      clearTimeout(saveTimer.current);
      saveInProgress.current = false;
      if (alive.current) setSaving(false);
    }
  }
  function retrySave() {
    return saveChange("Previous request", () => dataService.retryPending(), () => {
      setShowAdd(false); setAction(null); setArchive(null);
    });
  }
  function addBatch(form, request) {
    return saveChange("Batch", () => dataService.receiveBatch({ ...form, ...request }), () => setShowAdd(false));
  }
  function applyAction(batch, staffId, extra, mutationId) {
    return saveChange("Status update", () => dataService.transitionBatch({
      id: batch.id, expectedVersion: batch.version, expectedStatus: batch.status,
      staffId, ...extra, mutationId,
    }), () => setAction(null));
  }
  function archiveBatch(batch, reason, mutationId) {
    return saveChange("Archive", () => dataService.archiveBatch({ id: batch.id,
      expectedVersion: batch.version, expectedStatus: batch.status, reason, mutationId,
    }), () => setArchive(null));
  }
  function addStaff(name, role, id) {
    return saveChange("Staff member", () => dataService.addStaff({ id, name, role }));
  }
  function toggleStaff(id) {
    const expected = roster.find((s) => s.id === id);
    return saveChange("Roster update", () => dataService.setStaffActive({ id, expected, active: !expected.active }));
  }
  function removeStaff(id) {
    if (!window.confirm("Remove this roster entry? Past batch history will be retained.")) return;
    const expected = roster.find((s) => s.id === id);
    return saveChange("Staff removal", () => dataService.removeStaff({ id, expected }));
  }
  function backupBrowserRecords() {
    try {
      const current = inspectLegacyStorage(window.localStorage);
      download(legacyBackup(current), "aete-browser-records-backup.json", "application/json");
    } catch (error) { setSaveError(error.message); }
  }

  function exportCSV() {
    if (session.role !== "manager") return;
    const cols = ["Job No","Customer","Parts","Status","Pieces In","Weight In","Pieces Out",
      "Weight Out","Piece Balance","Days in Plant","Received By","Received At","Into Process By",
      "Ready By","Dispatched By","Dispatched At","Received Account UID","Process Account UID",
      "Ready Account UID","Dispatch Account UID","Archived","Archive Reason","Archived At","Archive Account UID"];
    const rows = tableBatches.map((b) => [
      b.jobNo, b.customer, b.parts, b.status, b.piecesIn, b.weightIn,
      b.piecesOut ?? "", b.weightOut ?? "",
      b.piecesOut != null ? b.piecesIn - b.piecesOut : "",
      daysSince(b.dispatchAt || b.receivedAt), b.receivedBy || "", fmt(b.receivedAt),
      b.processBy || "", b.readyBy || "", b.dispatchBy || "", fmt(b.dispatchAt),
      b.receivedUid || "", b.processUid || "", b.readyUid || "", b.dispatchUid || "",
      b.archived ? "Yes" : "No", b.archiveReason || "", fmt(b.archivedAt), b.archivedUid || "",
    ]);
    download(serializeCSV([cols, ...rows]), showArchives ? "aete-hdg-archived.csv" : "aete-hdg-batches.csv", "text/csv;charset=utf-8");
  }

  const counts = ORDER.reduce((m, s) => ((m[s] = batches.filter((b) => b.status === s).length), m), {});
  const flagged = batches.filter((b) => flagsFor(b).length);
  const shown = filter === "All" ? batches : batches.filter((b) => b.status === filter);
  const orderRank = { Received: 0, Processing: 1, Ready: 2, Dispatched: 3 };
  const sortedShown = [...shown].sort(
    (a, b) => orderRank[a.status] - orderRank[b.status] ||
      (dateOf(b.receivedAt)?.getTime() || 0) - (dateOf(a.receivedAt)?.getTime() || 0)
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
            onClick={onLogout}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-stone-700 hover:bg-stone-800"
          >
            {isMgr ? <ShieldCheck size={15} className="text-amber-400" /> : <LogIn size={15} />}
            {isMgr ? "Manager" : currentShift}
            <span className="text-stone-500">· sign out</span>
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
        <p className="mb-3 text-xs text-stone-500 break-all">Signed in as {session.email}</p>
        <div role="status" className={`mb-3 rounded-md border px-3 py-2 text-xs ${connection.connected && session.permissionsVerified
          ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {connection.connected && session.permissionsVerified ? "Shared Firebase data connected." :
            dataReady ? "Connection not confirmed. Showing the last received shared data; saving is unavailable." : "Connecting to shared tracker data…"}
        </div>
        {connection.error && <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{connection.error.message}</p>
          <button onClick={() => setRefresh((n) => n + 1)} className="mt-2 underline">Retry connection</button>
        </div>}
        {connection.pendingRequest && !saving && <div role="alert" className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>A previous save has not been confirmed. Its request is retained for this account; retry checks it before writing again.</p>
          <button disabled={saving || !connection.connected || !session.permissionsVerified}
            onClick={retrySave}
            className="mt-2 underline disabled:opacity-50">Retry previous save</button>
        </div>}
        {isMgr && legacy.present && <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>Earlier browser records are still on this device. They have not been uploaded to the shared tracker.</p>
          <button onClick={backupBrowserRecords} className="mt-2 underline">Download browser records backup</button>
        </div>}
        {isMgr && !legacy.available && <p role="alert" className="mb-3 text-xs text-amber-800">Earlier browser records could not be checked because browser storage is unavailable.</p>}
        {logoutError && <p role="alert" className="mb-3 text-sm text-red-700">{logoutError}</p>}
        {saveNotice && <p role="status" className="mb-3 text-sm text-stone-600">{saveNotice}</p>}
        {saving && <p className="mb-3 text-xs text-stone-500">Signing out does not cancel a pending Firebase save.</p>}
        {saveError && (
          <div role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {saveError}
          </div>
        )}
        {/* ---------------- BATCHES ---------------- */}
        {dataReady && tab === "batches" && (
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
                  <BatchRow key={b.id} b={b} role={session.role} saving={writeBlocked} onAct={() => setAction({ batch: b })}
                    canArchive={isMgr} onArchive={() => setArchive(b)} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ---------------- DASHBOARD ---------------- */}
        {dataReady && tab === "dashboard" && (
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
                      <span className="text-stone-600" title={`Submitted by account ${a.actorUid || "unknown"}`}>{a.who}{a.shift ? ` (${a.shift})` : ""}</span>
                      <span className="ml-auto text-xs text-stone-400 shrink-0">{fmt(a.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* ---------------- DATA ---------------- */}
        {dataReady && isMgr && tab === "data" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex gap-2 text-sm">
                <button onClick={() => setShowArchives(false)} className={!showArchives ? "font-bold" : "text-stone-500"}>Active ({batches.length})</button>
                <button onClick={() => setShowArchives(true)} className={showArchives ? "font-bold" : "text-stone-500"}>Archived ({archivedBatches.length})</button>
              </div>
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
                  {tableBatches.map((b) => {
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
                          <button onClick={() => setHistory(b)} className="mr-3 text-xs underline">History</button>
                          {!b.archived && <button disabled={writeBlocked} onClick={() => setArchive(b)} aria-label={`Archive ${b.jobNo}`}
                            className="text-stone-400 hover:text-amber-600 disabled:opacity-50"><Archive size={15} /></button>}
                          {b.archived && <p className="text-xs text-stone-500 max-w-48 whitespace-normal">{b.archiveReason}<br />{fmt(b.archivedAt)}</p>}
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
        {dataReady && isMgr && tab === "roster" && (
          <RosterPanel roster={roster} saving={writeBlocked} onAdd={addStaff} onToggle={toggleStaff}
            onRemove={removeStaff} />
        )}
      </main>

      {/* floating "log batch" button on batches tab */}
      {tab === "batches" && session.role === "plant" && (
        <button
          onClick={() => setShowAdd(true)}
          disabled={writeBlocked}
          className="fixed bottom-5 right-5 flex items-center gap-2 px-4 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-stone-900 font-semibold shadow-lg shadow-amber-500/30 disabled:opacity-50"
        >
          <Plus size={20} strokeWidth={2.5} /> Receive batch
        </button>
      )}

      {action && (
        <ActionModal batch={action.batch} staff={activeStaff} shift={currentShift} saving={saving} disabled={writeBlocked} stale={!batches.some((b) => b.id === action.batch.id && b.version === action.batch.version)} error={saveError} pending={!!connection.pendingRequest && !saving} onRetry={retrySave} canRetry={connection.connected && session.permissionsVerified && !saving}
          onClose={() => { if (!saving) setAction(null); }} onConfirm={applyAction} />
      )}
      {archive && <ArchiveModal batch={archive} saving={saving} disabled={writeBlocked}
        stale={!batches.some((b) => b.id === archive.id && b.version === archive.version)} error={saveError} pending={!!connection.pendingRequest && !saving} onRetry={retrySave} canRetry={connection.connected && session.permissionsVerified && !saving}
        onClose={() => { if (!saving) setArchive(null); }} onConfirm={archiveBatch} />}
      {history && <HistoryModal batch={history} service={dataService} onClose={() => setHistory(null)} />}
      {showAdd && (
        <AddModal staff={activeStaff} shift={currentShift} saving={saving} disabled={writeBlocked} error={saveError} pending={!!connection.pendingRequest && !saving} onRetry={retrySave} canRetry={connection.connected && session.permissionsVerified && !saving}
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

function BatchRow({ b, role, saving, onAct, canArchive, onArchive }) {
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
          {canArchive && (
            <button disabled={saving} onClick={onArchive} aria-label={`Archive ${b.jobNo}`} className="ml-auto text-stone-300 hover:text-amber-600 disabled:opacity-50">
              <Archive size={16} />
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
          <button onClick={onClose} aria-label="Close dialog" className="text-stone-400 hover:text-stone-700"><X size={22} /></button>
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
      {filtered.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.shift || s.role}</option>)}
    </select>
  );
}

function ActionModal({ batch, staff, shift, saving, disabled, stale, error, pending, onRetry, canRetry, onClose, onConfirm }) {
  const step = NEXT[batch.status];
  const [mutationId] = useState(newId);
  const [who, setWho] = useState("");
  const [piecesOut, setPiecesOut] = useState(batch.piecesIn ?? "");
  const [weightOut, setWeightOut] = useState("");
  const needQty = batch.status === "Processing";
  const ok = staff.some((s) => s.id === who && s.shift === shift) && (!needQty || (
    piecesOut !== "" && Number.isInteger(Number(piecesOut)) && Number(piecesOut) >= 0 && Number(piecesOut) <= 1e9 &&
    weightOut !== "" && Number.isFinite(Number(weightOut)) && Number(weightOut) >= 0 && Number(weightOut) <= 1e12
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
              <input type="number" min="0" max="1000000000" step="1" className={field} value={piecesOut}
                onChange={(e) => setPiecesOut(e.target.value)} />
            </div>
            <div>
              <label className={lbl}>Weight out (kg)</label>
              <input type="number" min="0" max="1000000000000" step="any" className={field} value={weightOut}
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
      <PendingRetry pending={pending} onRetry={onRetry} canRetry={canRetry} />
      {stale && <p role="alert" className="mt-3 text-sm text-amber-800">This batch changed. Close this form and review its current stage.</p>}
      <button disabled={!ok || disabled || stale || saving}
        onClick={() => onConfirm(batch, who, { piecesOut, weightOut }, mutationId)}
        className={`w-full mt-5 py-2.5 rounded-md font-semibold text-white ${ok ? step.btn : "bg-stone-300"}`}>
        {saving ? "Saving…" : step.label}
      </button>
    </Sheet>
  );
}

function AddModal({ staff, shift, saving, disabled, error, pending, onRetry, canRetry, onClose, onAdd }) {
  const [request] = useState(() => ({ id: newId(), mutationId: newId() }));
  const [f, setF] = useState({ jobNo: "", customer: "", parts: "", piecesIn: "", weightIn: "", staffId: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ok = f.jobNo.trim() && f.customer.trim() && f.parts.trim() && staff.some((s) => s.id === f.staffId && s.shift === shift) &&
    f.piecesIn !== "" && Number.isInteger(Number(f.piecesIn)) && Number(f.piecesIn) >= 0 && Number(f.piecesIn) <= 1e9 &&
    f.weightIn !== "" && Number.isFinite(Number(f.weightIn)) && Number(f.weightIn) >= 0 && Number(f.weightIn) <= 1e12;
  return (
    <Sheet title="Log a received batch" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Job card no</label>
            <input maxLength={80} className={field} value={f.jobNo} onChange={set("jobNo")} placeholder="JC-1043" /></div>
          <div><label className={lbl}>Customer</label>
            <input maxLength={200} className={field} value={f.customer} onChange={set("customer")} /></div>
        </div>
        <div><label className={lbl}>Parts description</label>
          <input maxLength={500} className={field} value={f.parts} onChange={set("parts")} placeholder="Cable tray, bolts…" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Pieces in</label>
            <input type="number" min="0" max="1000000000" step="1" className={field} value={f.piecesIn} onChange={set("piecesIn")} /></div>
          <div><label className={lbl}>Weight in (kg)</label>
            <input type="number" min="0" max="1000000000000" step="any" className={field} value={f.weightIn} onChange={set("weightIn")} /></div>
        </div>
        <div><label className={lbl}>Received by</label>
          <WhoSelect staff={staff} value={f.staffId} onChange={(v) => setF({ ...f, staffId: v })} shift={shift} /></div>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <PendingRetry pending={pending} onRetry={onRetry} canRetry={canRetry} />
      <button disabled={!ok || disabled || saving} onClick={() => onAdd(f, request)}
        className={`w-full mt-5 py-2.5 rounded-md font-semibold ${ok ? "bg-amber-500 hover:bg-amber-600 text-stone-900" : "bg-stone-300 text-white"}`}>
        {saving ? "Saving…" : "Log batch as received"}
      </button>
    </Sheet>
  );
}

function RosterPanel({ roster, saving, onAdd, onToggle, onRemove }) {
  const [name, setName] = useState("");
  const [r, setR] = useState("Shift A Supervisor");
  const [staffId, setStaffId] = useState(newId);
  const shift = STAFF_SHIFTS[r];
  const roles = ["Shift A Supervisor", "Shift B Supervisor", "Plant Supervisor", "Operations Manager"];
  return (
    <div className="space-y-4">
      <section className="bg-white rounded-lg border border-stone-200 p-4">
        <h2 className="font-semibold text-sm mb-3">Add staff to the roster</h2>
        <p className="text-xs text-stone-500 mb-3">
          Roster names fill the batch dropdowns. Adding a name here does not create a login or grant account permissions.
        </p>
        <div className="space-y-2">
          <input maxLength={120} className={field} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2">
            <select className={field} value={r} onChange={(e) => setR(e.target.value)}>
              {roles.map((x) => <option key={x}>{x}</option>)}
            </select>
            <span className="self-center text-xs text-stone-500 shrink-0">{shift || "No shift"}</span>
            <button disabled={saving || !name.trim()} aria-label="Add staff" onClick={async () => {
              if (await onAdd(name, r, staffId)) { setName(""); setStaffId(newId()); }
            }}
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

      <section className="bg-white rounded-lg border border-stone-200 p-4 text-sm text-stone-600">
        Login accounts and their permissions are managed separately in the Firebase console.
        Changing a roster role does not change anyone's login access.
      </section>
    </div>
  );
}

function PendingRetry({ pending, onRetry, canRetry }) {
  return pending ? <button disabled={!canRetry} onClick={onRetry}
    className="mt-3 text-sm underline text-amber-800 disabled:opacity-50">Retry previous save</button> : null;
}
function ArchiveModal({ batch, saving, disabled, stale, error, pending, onRetry, canRetry, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [mutationId] = useState(newId);
  return <Sheet title={`Archive ${batch.jobNo}`} onClose={onClose}>
    <p className="text-sm text-stone-600 mb-4">This removes the batch from the active tracker and retains its details and activity history. Archived batches cannot be edited or restored.</p>
    <label className={lbl} htmlFor="archive-reason">Reason</label>
    <textarea id="archive-reason" maxLength={500} className={field} value={reason} onChange={(e) => setReason(e.target.value)} />
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {stale && <p role="alert" className="mt-3 text-sm text-amber-800">This batch changed. Close this form and review its current state.</p>}
    <PendingRetry pending={pending} onRetry={onRetry} canRetry={canRetry} />
    <button disabled={disabled || saving || stale || !reason.trim()} onClick={() => onConfirm(batch, reason, mutationId)}
      className="w-full mt-4 rounded-md bg-stone-900 text-white py-2.5 disabled:opacity-50">{saving ? "Saving…" : "Archive batch"}</button>
  </Sheet>;
}
function HistoryModal({ batch, service, onClose }) {
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [cached, setCached] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => service.subscribeHistory(batch.id, (data, fromCache) => {
    setEntries(data); setCached(fromCache); setLoaded(true);
  }, (error) => setError(error.message)), [service, batch.id]);
  return <Sheet title={`${batch.jobNo} · history`} onClose={onClose}>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    {!loaded && <p>Loading history…</p>}
    {loaded && cached && <p className="mb-3 text-xs text-amber-800">Showing cached history; connection is not confirmed.</p>}
    {loaded && !entries.length && <p>No history entries available.</p>}
    <ol className="space-y-3">
      {entries.map((entry) => <li key={entry.id} className="rounded-md border border-stone-200 p-3 text-sm">
        <p className="font-semibold">{entry.action} · {fmt(entry.at)}</p>
        <p>{entry.who}{entry.shift ? ` · ${entry.shift}` : ""}</p>
        <p className="mt-1 text-xs text-stone-500 break-all">Submitted by account: {entry.actorUid}</p>
        <p className="mt-1 text-xs text-stone-600">{entry.snapshot.piecesIn} pcs · {entry.snapshot.weightIn} kg in
          {entry.snapshot.piecesOut != null && ` → ${entry.snapshot.piecesOut} pcs · ${entry.snapshot.weightOut} kg out`}</p>
        {entry.snapshot.archiveReason && <p className="mt-1 text-xs">Reason: {entry.snapshot.archiveReason}</p>}
      </li>)}
    </ol>
  </Sheet>;
}
