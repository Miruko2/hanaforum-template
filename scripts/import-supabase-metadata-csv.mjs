import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? path.join("supabase-backup", "full-metadata.json");

if (!inputPath) {
  console.error("Usage: node scripts/import-supabase-metadata-csv.mjs <input.csv> [output.json]");
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.length > 1 || entry[0] !== "");
}

const csv = await readFile(inputPath, "utf8");
const rows = parseCsv(csv);
const [headers, ...records] = rows;
const sectionIndex = headers.indexOf("section");
const dataIndex = headers.indexOf("data");

if (sectionIndex === -1 || dataIndex === -1) {
  console.error("CSV must contain section and data columns.");
  process.exit(1);
}

const output = records.map((record) => ({
  section: record[sectionIndex],
  data: JSON.parse(record[dataIndex]),
}));

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

console.log(`Imported ${output.length} metadata sections.`);
console.log(`Wrote ${outputPath}`);
