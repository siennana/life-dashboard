// One-shot migration: copy data from the local docker Postgres into Neon.
//
//   1. point DATABASE_URL at Neon and run `pnpm db:migrate` (creates the schema)
//   2. put the local URL back in DATABASE_URL, set NEON_DATABASE_URL, run this
//
// pg_dump/psql are not installed on either machine, so both run inside the
// `db` container from docker-compose (postgres:17 ships the matching client).
// Env comes from `node --env-file=.env` (see the db:copy-to-neon script) - the
// root has no dotenv of its own.
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const TABLES = ["events", "metrics", "sync_runs", "calendar_days"];
const force = process.argv.includes("--force");
const manualOnly = process.argv.includes("--manual-only");

const source = process.env.DATABASE_URL;
const target = process.env.NEON_DATABASE_URL;

if (!source) fail("DATABASE_URL is not set (expected the local docker Postgres).");
if (!target) fail("NEON_DATABASE_URL is not set (expected the Neon connection string).");
if (target.includes("localhost") || target.includes("127.0.0.1"))
  fail("NEON_DATABASE_URL points at localhost - that is the source, not the target.");

// docker compose exec, with the container's stdio wired to whatever we pass.
function dockerExec(args, { stdout, stdin, env } = {}) {
  const envArgs = Object.entries(env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "exec", "-T", ...envArgs, "db", ...args], {
      cwd: root,
      stdio: [stdin ? "pipe" : "ignore", stdout ? "pipe" : "inherit", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    if (stdin) stdin.pipe(child.stdin);
    // pipeline() both flushes and closes the destination, so waiting on it is
    // what guarantees the dump file is fully written once we resolve.
    const piped = stdout ? pipeline(child.stdout, stdout) : Promise.resolve();
    child.on("error", reject);
    child.on("close", async (code) => {
      try {
        await piped;
      } catch (err) {
        return reject(err);
      }
      if (code === 0) return resolve();
      reject(new Error(`${args[0]} exited ${code}\n${stderr.trim()}`));
    });
  });
}

// Run SQL against a URL and return stdout as text (psql -At = bare values).
async function query(url, sql) {
  const chunks = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  await dockerExec(["sh", "-c", 'psql "$PGURL" -At -v ON_ERROR_STOP=1 -c "$PGSQL"'], {
    stdout: sink,
    env: { PGURL: url, PGSQL: sql },
  });
  return Buffer.concat(chunks).toString().trim();
}

const countsSql = TABLES.map((t) => `select '${t}', count(*) from ${t}`).join(" union all ");

function parseCounts(raw) {
  return Object.fromEntries(raw.split("\n").filter(Boolean).map((l) => l.split("|")));
}

function report(label, counts) {
  console.log(`\n${label}`);
  for (const t of TABLES) console.log(`  ${t.padEnd(14)} ${counts[t] ?? "?"}`);
}

function fail(msg) {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

const dumpDir = join(root, ".tmp");
const dumpFile = join(dumpDir, "life-data.sql");
const sqlFile = join(dumpDir, "life-manual.sql");

console.log("Reading source (local docker Postgres)...");
const sourceCounts = parseCounts(await query(source, countsSql));
report("Source rows:", sourceCounts);

console.log("\nChecking target (Neon)...");
const present = await query(
  target,
  `select table_name from information_schema.tables where table_schema='public' and table_name in (${TABLES.map((t) => `'${t}'`).join(",")})`,
);
const missing = TABLES.filter((t) => !present.split("\n").includes(t));
if (missing.length)
  fail(
    `Neon is missing tables: ${missing.join(", ")}\n` +
      `Run the migrations against Neon first:\n` +
      `  DATABASE_URL="$NEON_DATABASE_URL" pnpm db:migrate`,
  );

const targetCounts = parseCounts(await query(target, countsSql));
report("Target rows (before):", targetCounts);

// --manual-only copies just the source='manual' events (books, exercises). That
// is the only data a connector cannot rebuild, so it is the safe mode to run
// against a Neon that already has synced rows in it: manual externalIds are
// randomUUIDs, so they cannot collide with todoist/calendar rows. Whole-table
// mode instead needs an empty target, because pg_dump replays every row as-is.
if (manualOnly) {
  const cols = "source, external_id, type, title, start_ts, end_ts, payload, created_at, updated_at";
  console.log("\nCopying source='manual' events only...");
  await mkdir(dumpDir, { recursive: true });
  const tsv = createWriteStream(dumpFile);
  // `id` is deliberately excluded so the target sequence assigns fresh ones and
  // we never collide with primary keys already on Neon.
  await dockerExec(
    ["sh", "-c", `psql "$PGURL" -v ON_ERROR_STOP=1 -c "\\copy (select ${cols} from events where source='manual') to stdout"`],
    { stdout: tsv, env: { PGURL: source } },
  );
  console.log(`  staged ${(await stat(dumpFile)).size} bytes`);

  // Land the rows in a temp table first, then insert with ON CONFLICT DO NOTHING
  // so re-running this is a no-op instead of a unique-violation on
  // events_source_external_id. `copy ... from stdin` reads the inline data that
  // follows it, terminated by \. - same shape pg_dump emits.
  const data = await readFile(dumpFile, "utf8");
  await writeFile(
    sqlFile,
    `create temp table _manual (like events including defaults);\n` +
      `copy _manual (${cols}) from stdin;\n` +
      (data.endsWith("\n") ? data : data + "\n") +
      `\\.\n` +
      `insert into events (${cols}) select ${cols} from _manual\n` +
      `  on conflict (source, external_id) do nothing;\n`,
  );

  await dockerExec(["sh", "-c", 'psql "$PGURL" -v ON_ERROR_STOP=1 --quiet -o /dev/null -f -'], {
    stdin: createReadStream(sqlFile),
    env: { PGURL: target },
  });

  report("Target rows (after):", parseCounts(await query(target, countsSql)));
  await rm(dumpFile, { force: true });
  await rm(sqlFile, { force: true });
  console.log("\nDone. Connector data (todoist/calendar/holdings) re-syncs on its own.");
  process.exit(0);
}

const occupied = TABLES.filter((t) => Number(targetCounts[t]) > 0);
// Usually this means an API sync loop already ran against Neon. --force does not
// help much here - the COPY would just collide on events_source_external_id - so
// point at the real fix instead.
if (occupied.length && !force)
  fail(
    `Neon already has data in: ${occupied.join(", ")}\n` +
      `Something already wrote to Neon (most likely an API sync loop).\n` +
      `Easiest fix - copy only the data connectors cannot rebuild:\n` +
      `  pnpm db:copy-to-neon --manual-only\n` +
      `Or wipe the target and copy everything (stop any dev server on Neon first):\n` +
      `  psql "$NEON_DATABASE_URL" -c 'truncate ${TABLES.join(", ")} restart identity'`,
  );

console.log("\nDumping source data...");
await mkdir(dumpDir, { recursive: true });
const out = createWriteStream(dumpFile);
await dockerExec(
  [
    "pg_dump",
    source,
    "--data-only",
    "--no-owner",
    "--no-privileges",
    ...TABLES.flatMap((t) => ["-t", t]),
  ],
  { stdout: out },
);
console.log(`  wrote ${(await stat(dumpFile)).size} bytes to .tmp/life-data.sql`);

console.log("\nLoading into Neon...");
// -o /dev/null drops the per-statement COPY/setval chatter; errors still surface.
await dockerExec(["sh", "-c", 'psql "$PGURL" -v ON_ERROR_STOP=1 --quiet -o /dev/null'], {
  stdin: createReadStream(dumpFile),
  env: { PGURL: target },
});

report("Target rows (after):", parseCounts(await query(target, countsSql)));
await rm(dumpFile, { force: true });

console.log("\nDone. Point DATABASE_URL at Neon on both machines.");
