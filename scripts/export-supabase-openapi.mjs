import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL");
  process.exit(1);
}

if (!serviceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const outputDir = path.join(process.cwd(), "supabase-backup");
const normalizedUrl = supabaseUrl.replace(/\/$/, "");

const response = await fetch(`${normalizedUrl}/rest/v1/`, {
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: "application/openapi+json",
  },
});

const body = await response.text();

if (!response.ok) {
  console.error(`OpenAPI export failed: ${response.status}`);
  console.error(body.slice(0, 1000));
  process.exit(1);
}

const openapi = JSON.parse(body);
const schemas = openapi.definitions ?? openapi.components?.schemas ?? {};
const paths = openapi.paths ?? {};
const tableEntries = Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b));
const rpcEntries = Object.keys(paths)
  .filter((entry) => entry.startsWith("/rpc/"))
  .sort();

await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(outputDir, "openapi-public-schema.json"),
  JSON.stringify(openapi, null, 2),
  "utf8",
);

const generatedAt = new Date().toISOString();
const lines = [
  "# Supabase Public Schema Snapshot",
  "",
  `Generated at: ${generatedAt}`,
  `Supabase URL: ${normalizedUrl}`,
  "",
  "This snapshot is exported from Supabase PostgREST OpenAPI metadata. It includes exposed public tables, columns, and RPC endpoints, but it does not include RLS policies, indexes, triggers, grants, or function bodies.",
  "",
  "For the complete metadata export, run `supabase-backup/export-full-metadata.sql` in the Supabase SQL Editor.",
  "",
  "## Tables",
  "",
];

for (const [tableName, schema] of tableEntries) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  lines.push(`### ${tableName}`, "");

  const propertyEntries = Object.entries(properties).sort(([a], [b]) => a.localeCompare(b));
  if (propertyEntries.length === 0) {
    lines.push("_No columns reported by OpenAPI._", "");
    continue;
  }

  lines.push("| Column | Type | Required | Format | Description |");
  lines.push("| --- | --- | --- | --- | --- |");

  for (const [columnName, column] of propertyEntries) {
    const type = Array.isArray(column.type) ? column.type.join(" / ") : column.type ?? "";
    const format = column.format ?? "";
    const description = String(column.description ?? "")
      .replace(/\r?\n/g, " ")
      .replace(/\|/g, "\\|");
    lines.push(
      `| ${columnName} | ${type} | ${required.has(columnName) ? "yes" : "no"} | ${format} | ${description} |`,
    );
  }

  lines.push("");
}

lines.push("## RPC Endpoints", "");

if (rpcEntries.length === 0) {
  lines.push("_No RPC endpoints reported by OpenAPI._", "");
} else {
  for (const endpoint of rpcEntries) {
    lines.push(`- ${endpoint.replace("/rpc/", "")}`);
  }
  lines.push("");
}

await writeFile(path.join(outputDir, "public-schema-summary.md"), lines.join("\n"), "utf8");

console.log(`Exported ${tableEntries.length} table schema entries and ${rpcEntries.length} RPC endpoints.`);
console.log(`Wrote ${path.join(outputDir, "openapi-public-schema.json")}`);
console.log(`Wrote ${path.join(outputDir, "public-schema-summary.md")}`);
