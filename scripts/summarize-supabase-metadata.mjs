import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputPath = process.argv[2] ?? path.join("supabase-backup", "full-metadata.json");
const outputPath = process.argv[3] ?? path.join("supabase-backup", "full-metadata-summary.md");

function parseSnapshot(raw) {
  const parsed = JSON.parse(raw);

  if (Array.isArray(parsed) && parsed.every((entry) => entry?.section && "data" in entry)) {
    const sections = Object.fromEntries(
      parsed.map((entry) => {
        const data = typeof entry.data === "string" ? JSON.parse(entry.data) : entry.data;
        return [entry.section, data];
      }),
    );
    return {
      generated_at: new Date().toISOString(),
      schemas: {
        public: {
          tables: sections.tables ?? [],
          columns: sections.columns ?? [],
          constraints: sections.constraints ?? [],
          indexes: sections.indexes ?? [],
          policies: sections.policies ?? [],
          triggers: sections.triggers ?? [],
          functions: sections.functions ?? [],
          grants: sections.grants ?? [],
          sequences: sections.sequences ?? [],
        },
      },
      extensions: sections.extensions ?? [],
      realtime_publication_tables: sections.realtime_publication_tables ?? [],
      storage_buckets: sections.storage_buckets ?? [],
    };
  }

  if (Array.isArray(parsed) && parsed[0]?.supabase_metadata_snapshot) {
    const value = parsed[0].supabase_metadata_snapshot;
    return typeof value === "string" ? JSON.parse(value) : value;
  }

  if (parsed?.supabase_metadata_snapshot) {
    const value = parsed.supabase_metadata_snapshot;
    return typeof value === "string" ? JSON.parse(value) : value;
  }

  if (typeof parsed === "string") {
    return JSON.parse(parsed);
  }

  return parsed;
}

const snapshot = parseSnapshot(await readFile(inputPath, "utf8"));
const publicSchema = snapshot.schemas?.public ?? {};
const tables = publicSchema.tables ?? [];
const columns = publicSchema.columns ?? [];
const constraints = publicSchema.constraints ?? [];
const indexes = publicSchema.indexes ?? [];
const policies = publicSchema.policies ?? [];
const triggers = publicSchema.triggers ?? [];
const functions = publicSchema.functions ?? [];
const grants = publicSchema.grants ?? [];
const realtimeTables = snapshot.realtime_publication_tables ?? [];
const storageBuckets = snapshot.storage_buckets ?? [];

const grouped = new Map();
for (const table of tables) {
  grouped.set(table.name, { table, columns: [], constraints: [], indexes: [], policies: [], triggers: [], grants: [] });
}

for (const column of columns) {
  grouped.get(column.table_name)?.columns.push(column);
}

for (const constraint of constraints) {
  grouped.get(constraint.table_name)?.constraints.push(constraint);
}

for (const index of indexes) {
  grouped.get(index.table_name)?.indexes.push(index);
}

for (const policy of policies) {
  grouped.get(policy.table_name)?.policies.push(policy);
}

for (const trigger of triggers) {
  grouped.get(trigger.event_object_table)?.triggers.push(trigger);
}

for (const grant of grants) {
  grouped.get(grant.table_name)?.grants.push(grant);
}

const lines = [
  "# Supabase Full Metadata Summary",
  "",
  `Generated from snapshot: ${inputPath}`,
  `Snapshot generated at: ${snapshot.generated_at ?? "unknown"}`,
  "",
  "## Tables",
  "",
];

for (const [name, group] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const table = group.table;
  lines.push(`### ${name}`, "");
  lines.push(`- Kind: ${table.kind}`);
  lines.push(`- Owner: ${table.owner}`);
  lines.push(`- RLS enabled: ${table.rls_enabled}`);
  lines.push(`- RLS forced: ${table.rls_forced}`);
  if (table.comment) lines.push(`- Comment: ${table.comment}`);
  lines.push("");

  lines.push("| Column | Type | Nullable | Default |");
  lines.push("| --- | --- | --- | --- |");
  for (const column of group.columns.sort((a, b) => a.ordinal_position - b.ordinal_position)) {
    const nullable = column.is_nullable === "YES" ? "yes" : "no";
    const defaultValue = String(column.column_default ?? "").replace(/\|/g, "\\|");
    lines.push(`| ${column.column_name} | ${column.data_type} (${column.udt_name}) | ${nullable} | ${defaultValue} |`);
  }
  lines.push("");

if (group.constraints.length) {
    lines.push("Constraints:");
    for (const constraint of group.constraints.sort((a, b) => a.constraint_name.localeCompare(b.constraint_name))) {
      lines.push(`- ${constraint.constraint_name}: ${constraint.constraint_type}`);
      if (constraint.definition) lines.push(`  ${constraint.definition}`);
    }
    lines.push("");
  }

  if (group.indexes.length) {
    lines.push("Indexes:");
    for (const index of group.indexes.sort((a, b) => a.index_name.localeCompare(b.index_name))) {
      lines.push(`- ${index.index_name}: \`${index.definition.replace(/`/g, "\\`")}\``);
    }
    lines.push("");
  }

  if (group.policies.length) {
    lines.push("RLS policies:");
    for (const policy of group.policies.sort((a, b) => a.policy_name.localeCompare(b.policy_name))) {
      lines.push(`- ${policy.policy_name}`);
      lines.push(`  Command: ${policy.command}; roles: ${(policy.roles ?? []).join(", ")}; permissive: ${policy.permissive}`);
      if (policy.using_expression) lines.push(`  USING: ${policy.using_expression}`);
      if (policy.with_check_expression) lines.push(`  WITH CHECK: ${policy.with_check_expression}`);
    }
    lines.push("");
  }

  if (group.triggers.length) {
    lines.push("Triggers:");
    for (const trigger of group.triggers.sort((a, b) => a.trigger_name.localeCompare(b.trigger_name))) {
      lines.push(`- ${trigger.trigger_name}: ${trigger.action_timing} ${trigger.event_manipulation} ${trigger.action_statement}`);
    }
    lines.push("");
  }
}

lines.push("## Functions", "");
for (const fn of functions.sort((a, b) => `${a.name}(${a.arguments})`.localeCompare(`${b.name}(${b.arguments})`))) {
  lines.push(`- ${fn.name}(${fn.arguments}) -> ${fn.result}; security definer: ${fn.security_definer}`);
}
lines.push("");

lines.push("## Realtime Publication Tables", "");
if (realtimeTables.length) {
  for (const table of realtimeTables) lines.push(`- ${table.schema}.${table.table_name}`);
} else {
  lines.push("_None reported._");
}
lines.push("");

lines.push("## Storage Buckets", "");
if (storageBuckets.length) {
  for (const bucket of storageBuckets) {
    lines.push(`- ${bucket.name}: public=${bucket.public}; file_size_limit=${bucket.file_size_limit ?? ""}`);
  }
} else {
  lines.push("_None reported._");
}
lines.push("");

await writeFile(outputPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outputPath}`);
