// Turns one spreadsheet / Word file (stdin) into plain text (stdout). Run by src/lib/attachments.ts as its own small
// process with a capped memory size, so a file that explodes when unpacked can only kill this process — not the server.
// Usage: node --max-old-space-size=<MB> scripts/file-text.mjs sheet|doc  < file
import * as XLSX from "xlsx";
import mammoth from "mammoth";

const kind = process.argv[2];
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const body = Buffer.concat(chunks);
let out;
if (kind === "sheet") {
  // sheetRows: far more rows than the ~40k characters the agent is sent.
  const wb = XLSX.read(body, { type: "buffer", cellDates: true, dense: true, sheetRows: 5000 });
  out = wb.SheetNames.map((n) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false });
    return `### Sheet "${n}" (${csv.split("\n").length} rows)\n${csv}`;
  }).join("\n\n");
} else {
  out = (await mammoth.extractRawText({ buffer: body })).value;
}
process.stdout.write(out.slice(0, 500_000));
