import fs from "node:fs";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { Field, Schema } from "apache-arrow";
import { config } from "../config.js";
import { sqlQuote } from "../util.js";

const TABLE = "knowledge_chunks";
fs.mkdirSync(path.join(config.dataDir, "lancedb"), { recursive: true });
const connectionPromise = lancedb.connect(path.join(config.dataDir, "lancedb"));
let tableCache = null;

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

export async function tableExists() { return (await (await connection()).tableNames()).includes(TABLE); }
export async function getTable() {
  if (tableCache?.isOpen?.()) return tableCache;
  if (!(await tableExists())) return null;
  tableCache = await (await connection()).openTable(TABLE);
  await ensurePrimaryKeySchema(tableCache);
  return tableCache;
}

export async function upsertChunks(rows) {
  if (!rows.length) return;
  let table = await getTable();
  if (!table) {
    table = await (await connection()).createTable(TABLE, rows, { schema: schemaForRows(rows) });
    tableCache = table;
    try { await table.setUnenforcedPrimaryKey("id"); } catch {}
  } else {
    const docIds = [...new Set(rows.map((r) => r.document_id))];
    for (const id of docIds) await table.delete(`document_id = ${sqlQuote(id)}`);
    await table.add(rows);
  }
}

export async function deleteDocumentChunks(documentId) {
  const table = await getTable();
  if (table) await table.delete(`document_id = ${sqlQuote(documentId)}`);
}

export async function getDocumentChunks(documentId) {
  const table = await getTable();
  if (!table) return [];
  return table.query().where(`document_id = ${sqlQuote(documentId)}`).toArray();
}

export async function getDocumentChunkText(documentId) {
  const table = await getTable();
  if (!table) return [];
  return table.query()
    .where(`document_id = ${sqlQuote(documentId)}`)
    .select(["id", "document_id", "chunk_index", "text"])
    .toArray();
}

export async function retrieveVector(vector, {
  candidateK = 20,
  filter = "",
  nprobes = null,
  refineFactor = null,
  distanceType = "cosine"
} = {}) {
  const table = await getTable();
  if (!table) return [];
  let query = table.vectorSearch(vector).distanceType(distanceType).limit(Math.max(1, Math.min(Number(candidateK) || 20, 500)));
  if (filter) query = query.where(filter);
  if (Number(nprobes) > 0) query = query.nprobes(Number(nprobes));
  if (Number(refineFactor) > 0) query = query.refineFactor(Number(refineFactor));
  query = query.select(["id", "document_id", "chunk_index", "text", "title", "source_type", "source_uri", "metadata_json", "content_hash", "origin_node", "created_at"]);
  return query.toArray();
}

export async function maybeCreateVectorIndex() {
  const table = await getTable();
  if (!table) return { created: false, reason: "table_missing" };
  const count = await table.countRows();
  if (count < 3000) return { created: false, reason: "not_enough_rows", count };
  const indices = await table.listIndices();
  if (indices.some((x) => x.name === "vector_idx")) return { created: false, reason: "exists", count };
  await table.createIndex("vector", { config: lancedb.Index.ivfPq({ distanceType: "cosine" }) });
  return { created: true, count };
}

export async function lanceStats() {
  const table = await getTable();
  if (!table) return { rows: 0, indices: [] };
  return { rows: await table.countRows(), indices: await table.listIndices() };
}
