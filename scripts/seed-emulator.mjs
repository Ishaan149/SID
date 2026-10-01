const base = `http://127.0.0.1:${process.env.FIRESTORE_PORT || 8080}/v1/projects/${process.env.VITE_FIREBASE_PROJECT_ID || "aete-hdg-local"}/databases/(default)/documents`;

const samples = {
  roster: [
    { id: "demo-plant", name: "Yousef Nasser", role: "Plant Supervisor", shift: "Plant", active: true },
    { id: "demo-shift-a", name: "Ali Hassan", role: "Shift A Supervisor", shift: "Shift A", active: true },
    { id: "demo-shift-b", name: "Rashid Karim", role: "Shift B Supervisor", shift: "Shift B", active: true },
    { id: "demo-manager", name: "Mohammed Farsi", role: "Operations Manager", shift: null, active: true },
  ],
  batches: [
    { id: "demo-batch-1", jobNo: "JC-1042", customer: "Al-Rashid Trading", parts: "Cable tray 300mm", piecesIn: 120, weightIn: 850, status: "Received", receivedBy: "Yousef Nasser", receivedShift: "Plant", receivedAt: new Date().toISOString(), notes: "" },
  ],
  activity: [],
};

async function write(collection, id, fields) {
  const typed = (value) => value === null ? { nullValue: null }
    : typeof value === "boolean" ? { booleanValue: value }
      : typeof value === "number" ? { integerValue: String(value) }
        : { stringValue: String(value) };
  const response = await fetch(`${base}/${collection}/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "id").map(([key, value]) => [key, typed(value)])) }),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
}

for (const [collection, values] of Object.entries(samples)) {
  for (const item of values) await write(collection, item.id, item);
}
await write("settings", "app", { pin: "1234" });
console.log("Seeded AETE demo data into the Firestore emulator.");
