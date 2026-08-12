import fs from "node:fs";
import path from "node:path";
import { env } from "@huggingface/transformers";
import { config } from "../config.js";

fs.mkdirSync(config.models.cacheDir, { recursive: true });
env.cacheDir = config.models.cacheDir;
env.allowRemoteModels = config.models.allowRemote;
env.allowLocalModels = true;
if (config.models.localModelPath) {
  env.localModelPath = path.resolve(config.models.localModelPath);
}

export function modelRuntimeInfo() {
  return {
    cacheDir: config.models.cacheDir,
    localModelPath: config.models.localModelPath || null,
    allowRemoteModels: config.models.allowRemote,
    airGapped: !config.models.allowRemote
  };
}
