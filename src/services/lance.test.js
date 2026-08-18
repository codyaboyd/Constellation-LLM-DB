import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, after } from "bun:test";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "constellation-lance-"));
process.env.DATA_DIR = dataDir;

const { DEFAULT_TABLE_NAME, listTables, normalizeTableName, retrieveVector, upsertChunks } = await import("./lance.js");

after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

function row(id, text) {
  return {
    id,
    document_id: id.split(":")[0],
    chunk_index: 0,
    text,
    vector: [1, 0, 0],
    title: id,
    source_type: "manual",
    source_uri: "",
    metadata_json: "{}",
    content_hash: id,
    origin_node: "test",
    created_at: new Date().toISOString()
  };
}

test("uses the shared table by default and isolates named tables", async () => {
  await upsertChunks([row("shared:0", "shared")]);
  await upsertChunks([row("agent:0", "private")], "agent_memory");

  const shared = await retrieveVector([1, 0, 0]);
  const privateRows = await retrieveVector([1, 0, 0], { tableName: "agent_memory" });

  expect(shared.map((item) => item.text)).toEqual(["shared"]);
  expect(privateRows.map((item) => item.text)).toEqual(["private"]);
  expect(await listTables()).toEqual(["agent_memory", DEFAULT_TABLE_NAME]);
});

test("rejects unsafe table names", () => {
  expect(() => normalizeTableName("agent-memory")).toThrow();
  expect(normalizeTableName()).toBe(DEFAULT_TABLE_NAME);
});
