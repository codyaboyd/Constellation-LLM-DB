import fs from "node:fs";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { Field, Schema } from "apache-arrow";
import { config } from "../config.js";
import { sqlQuote } from "../util.js";

export const DEFAULT_TABLE_NAME = "knowledge_chunks";
const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
fs.mkdirSync(path.join(config.dataDir, "lancedb"), { recursive: true });
const connectionPromise = lancedb.connect(path.join(config.dataDir, "lancedb"));
const tableCache = new Map();

export function normalizeTableName(value) {
  const name = String(value ?? "").trim() || DEFAULT_TABLE_NAME;
  if (name.length > 128 || !TABLE_NAME_PATTERN.test(name)) {
    const error = new Error("table name must start with a letter or underscore and contain only letters, numbers, and underscores.");
    error.status = 400;
    throw error;
  }
  return name;
}

async function connection() { return connectionPromise; }

function schemaForRows(rows) {
  const inferred = lancedb.makeArrowTable(rows).schema;
  const fields = inferred.fields.map((field) => field.name === "id"
    ? new Field(field.name, field.type, false, field.metadata)
    : field);
  return new Schema(fields, inferred.metadata);
}

function isNullablePrimaryKeyError(error) {
  return /primary key column and all its ancestors must not be nullable/i.test(String(error?.message || error));
}

async function ensurePrimaryKeySchema(table) {
  const idField = (await table.schema()).fields.find((field) => field.name === "id");
  if (!idField) throw new Error("Lance knowledge table is missing its id column.");
  if (!idField.nullable) return;

  try {
    await table.alterColumns([{ path: "id", nullable: false }]);
  } catch (error) {
    // Older versions of this app created a nullable id and then registered it
    // as a primary key. Lance refuses to alter that invalid schema directly.
    if (!isNullablePrimaryKeyError(error)) throw error;
    const currentVersion = await table.version();
    const versions = await table.listVersions();
    const previous = versions.filter((version) => version.version < currentVersion).at(-1);
    if (!previous) throw new Error("Lance knowledge table has an invalid primary-key schema and cannot be repaired automatically.");
    await table.checkout(previous.version);
    await table.restore();
    await table.alterColumns([{ path: "id", nullable: false }]);
  }
  try { await table.setUnenforcedPrimaryKey("id"); } catch {}
}

export async function listTables() { return (await (await connection()).tableNames()).sort(); }
export async function tableExists(tableName = DEFAULT_TABLE_NAME) {
  const name = normalizeTableName(tableName);
  return (await listTables()).includes(name);
}
export async function getTable(tableName = DEFAULT_TABLE_NAME) {
  const name = normalizeTableName(tableName);
  const cached = tableCache.get(name);
  if (cached?.isOpen?.()) return cached;
  if (!(await tableExists(name))) return null;
  const table = await (await connection()).openTable(name);
  await ensurePrimaryKeySchema(table);
  tableCache.set(name, table);
  return table;
}

export async function upsertChunks(rows, tableName = DEFAULT_TABLE_NAME) {
  if (!rows.length) return;
  const name = normalizeTableName(tableName);
  let table = await getTable(name);
  if (!table) {
    table = await (await connection()).createTable(name, rows, { schema: schemaForRows(rows) });
    tableCache.set(name, table);
    try { await table.setUnenforcedPrimaryKey("id"); } catch {}
  } else {
    const docIds = [...new Set(rows.map((r) => r.document_id))];
    for (const id of docIds) await table.delete(`document_id = ${sqlQuote(id)}`);
    await table.add(rows);
  }
}

export async function deleteDocumentChunks(documentId, tableName = DEFAULT_TABLE_NAME) {
  const table = await getTable(tableName);
  if (table) await table.delete(`document_id = ${sqlQuote(documentId)}`);
}

export async function getDocumentChunks(documentId, tableName = DEFAULT_TABLE_NAME) {
  const table = await getTable(tableName);
  if (!table) return [];
  return table.query().where(`document_id = ${sqlQuote(documentId)}`).toArray();
}

export async function getDocumentChunkText(documentId, tableName = DEFAULT_TABLE_NAME) {
  const table = await getTable(tableName);
  if (!table) return [];
  return table.query()
    .where(`document_id = ${sqlQuote(documentId)}`)
    .select(["id", "document_id", "chunk_index", "text"])
    .toArray();
}

export async function retrieveVector(vector, {
  tableName = DEFAULT_TABLE_NAME,
  candidateK = 20,
  filter = "",
  nprobes = null,
  refineFactor = null,
  distanceType = "cosine"
} = {}) {
  const table = await getTable(tableName);
  if (!table) return [];
  let query = table.vectorSearch(vector).distanceType(distanceType).limit(Math.max(1, Math.min(Number(candidateK) || 20, 500)));
  if (filter) query = query.where(filter);
  if (Number(nprobes) > 0) query = query.nprobes(Number(nprobes));
  if (Number(refineFactor) > 0) query = query.refineFactor(Number(refineFactor));
  query = query.select(["id", "document_id", "chunk_index", "text", "title", "source_type", "source_uri", "metadata_json", "content_hash", "origin_node", "created_at"]);
  return query.toArray();
}

export async function maybeCreateVectorIndex(tableName = DEFAULT_TABLE_NAME) {
  const table = await getTable(tableName);
  if (!table) return { created: false, reason: "table_missing" };
  const count = await table.countRows();
  if (count < 3000) return { created: false, reason: "not_enough_rows", count };
  const indices = await table.listIndices();
  if (indices.some((x) => x.name === "vector_idx")) return { created: false, reason: "exists", count };
  await table.createIndex("vector", { config: lancedb.Index.ivfPq({ distanceType: "cosine" }) });
  return { created: true, count, table: normalizeTableName(tableName) };
}

export async function lanceStats() {
  const table = await getTable(DEFAULT_TABLE_NAME);
  const tables = [];
  for (const name of await listTables()) {
    const current = await getTable(name);
    tables.push({ name, rows: await current.countRows(), indices: await current.listIndices() });
  }
  if (!table) return { rows: 0, indices: [], tables };
  return { rows: await table.countRows(), indices: await table.listIndices(), tables };
}
