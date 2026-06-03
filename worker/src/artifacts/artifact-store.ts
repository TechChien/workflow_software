import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildArtifactUri } from "./artifact-uri.js";

type WriteArtifactInput = {
  root: string;
  workflowId: string;
  runId: string;
  artifactKey: string;
  version: number;
  filename?: string;
  content: string;
};

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function writeArtifactVersion(input: WriteArtifactInput) {
  const extension = input.filename ? path.extname(input.filename) || ".md" : ".md";
  const directory = path.join(
    input.root,
    "workflows",
    safeSegment(input.workflowId),
    "runs",
    safeSegment(input.runId),
    safeSegment(input.artifactKey)
  );
  const filePath = path.join(directory, `v${input.version}${extension}`);

  await mkdir(directory, { recursive: true });
  await writeFile(filePath, input.content, "utf8");

  return {
    contentUri: buildArtifactUri(input.workflowId, input.runId, input.artifactKey, input.version),
    contentPath: filePath,
    contentHash: createHash("sha256").update(input.content).digest("hex")
  };
}
