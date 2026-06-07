import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

export async function readArtifactVersionContent(input: {
  root: string;
  workflowId: string;
  runId: string;
  artifactKey: string;
  version: number;
}) {
  const directory = path.join(
    input.root,
    "workflows",
    safeSegment(input.workflowId),
    "runs",
    safeSegment(input.runId),
    safeSegment(input.artifactKey)
  );
  const prefix = `v${input.version}`;
  const matches = (await readdir(directory)).filter((entry) => {
    const parsed = path.parse(entry);
    return parsed.name === prefix && parsed.base.startsWith(prefix);
  });

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one stored artifact file for ${input.artifactKey} v${input.version}, found ${matches.length}`
    );
  }

  const contentPath = path.join(directory, matches[0] as string);

  return {
    content: await readFile(contentPath, "utf8"),
    contentPath,
    extension: path.extname(contentPath) || ".md"
  };
}
