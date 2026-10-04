// Keep trusted numeric quantities numeric; protect user text from spreadsheet formulas.
export function serializeCSV(rows) {
  return "\uFEFF" + rows.map((row) => row.map((cell) => {
    const value = String(cell);
    const safe = typeof cell !== "number" && /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
}
