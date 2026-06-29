import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactDefinition,
  ContextPath,
  StepArtifactInput,
  StepDefinition
} from "@workflow-software/shared";
import { normalizeArtifactKey } from "@workflow-software/shared";
import type { Prisma } from "../generated/prisma/client.js";
import {
  readArtifactVersionContent,
  writeArtifactVersion
} from "../artifacts/artifact-store.js";
import { resolveContextPath, type ResolvedContextPath } from "../context/context-path-resolver.js";

type ArtifactVersionRow = {
  id: string;
  artifactKey: string;
  version: number;
  status: string;
  contentUri: string;
  contentHash: string;
};

export type ArtifactRuntimeClient = {
  artifactVersion: {
    findFirst(args: Prisma.ArtifactVersionFindFirstArgs): PromiseLike<ArtifactVersionRow | null>;
    create(args: Prisma.ArtifactVersionCreateArgs): PromiseLike<ArtifactVersionRow>;
    updateMany(args: Prisma.ArtifactVersionUpdateManyArgs): PromiseLike<{ count: number }>;
  };
  stepRunArtifactInput: {
    create(args: Prisma.StepRunArtifactInputCreateArgs): PromiseLike<unknown>;
  };
  contextPathEvent: {
    create(args: Prisma.ContextPathEventCreateArgs): PromiseLike<unknown>;
  };
};

export type PreparedContextPath = {
  path: string;
  type: "file" | "directory";
  absolutePath: string;
  promptPath: string;
};

export type PreparedInputArtifact = {
  artifact: string;
  artifactVersionId: string;
  version: number;
  contentUri: string;
  absolutePath: string;
  promptPath: string;
};

export type PreparedOutputArtifact = {
  artifact: string;
  filename: string;
  absolutePath: string;
  promptPath: string;
};

export type CodexRuntimePromptContext = {
  contextPaths: PreparedContextPath[];
  inputArtifacts: PreparedInputArtifact[];
  outputArtifacts: PreparedOutputArtifact[];
};

export class ArtifactRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ArtifactRuntimeError";
  }
}

export function stepNeedsArtifactRuntime(step: StepDefinition) {
  return (
    step.context_paths.length > 0 ||
    step.input_artifacts.length > 0 ||
    step.output_artifacts.length > 0
  );
}

function safeSegment(value: string) {
  const normalized = normalizeArtifactKey(value);
  return normalized || "artifact";
}

function toPromptPath(workingDirectory: string, absolutePath: string) {
  return path.relative(workingDirectory, absolutePath).replace(/\\/g, "/");
}

function defaultOutputFilename(definition: ArtifactDefinition) {
  const extension = definition.format === "plain_text" ? ".txt" : ".md";
  return `${safeSegment(definition.artifact)}${extension}`;
}

function assertRelativeFilename(filename: string, artifactKey: string) {
  const normalized = filename.replace(/\\/g, "/").trim();
  const parts = normalized.split("/").filter(Boolean);

  if (
    !normalized ||
    normalized === "." ||
    path.isAbsolute(normalized) ||
    parts.length === 0 ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new ArtifactRuntimeError(
      "artifact_filename_invalid",
      `Output artifact ${artifactKey} has an invalid relative filename: ${filename}`
    );
  }

  return parts.join("/");
}

function runtimeRootFor(workingDirectory: string, stepRunId: string) {
  return path.join(workingDirectory, ".workflow-runtime", "artifacts", stepRunId);
}

async function recordContextPath(
  client: ArtifactRuntimeClient,
  stepRunId: string,
  result: ResolvedContextPath
) {
  await client.contextPathEvent.create({
    data: {
      stepRunId,
      path: result.path,
      type: result.type,
      status: result.status,
      reason: result.status === "skipped" ? result.reason : undefined
    }
  });
}

async function prepareContextPaths(input: {
  client: ArtifactRuntimeClient;
  stepRunId: string;
  workingDirectory: string;
  contextPaths: ContextPath[];
  inputPayload?: Record<string, unknown>;
}) {
  const prepared: PreparedContextPath[] = [];

  for (const contextPath of input.contextPaths) {
    const result = await resolveContextPath(input.workingDirectory, contextPath, {
      inputPayload: input.inputPayload
    });
    await recordContextPath(input.client, input.stepRunId, result);

    if (result.status === "skipped") {
      throw new ArtifactRuntimeError(
        "context_path_required_unavailable",
        `Required context path ${contextPath.path} is unavailable: ${result.reason}`
      );
    }

    prepared.push({
      path: result.path,
      type: result.type,
      absolutePath: result.absolutePath,
      promptPath: toPromptPath(input.workingDirectory, result.absolutePath)
    });
  }

  return prepared;
}

async function findLatestAcceptedArtifact(input: {
  client: ArtifactRuntimeClient;
  workflowRunId: string;
  artifactKey: string;
}) {
  return input.client.artifactVersion.findFirst({
    where: {
      workflowRunId: input.workflowRunId,
      artifactKey: input.artifactKey,
      status: "ACCEPTED"
    },
    orderBy: {
      version: "desc"
    }
  });
}

async function prepareInputArtifacts(input: {
  client: ArtifactRuntimeClient;
  workflowId: string;
  workflowRunId: string;
  stepRunId: string;
  workingDirectory: string;
  artifactStoreRoot: string;
  runtimeRoot: string;
  inputArtifacts: StepArtifactInput[];
}) {
  const prepared: PreparedInputArtifact[] = [];

  for (const artifactInput of input.inputArtifacts) {
    const artifactVersion = await findLatestAcceptedArtifact({
      client: input.client,
      workflowRunId: input.workflowRunId,
      artifactKey: artifactInput.artifact
    });

    if (!artifactVersion) {
      if (artifactInput.required) {
        throw new ArtifactRuntimeError(
          "artifact_input_missing",
          `Required input artifact ${artifactInput.artifact} has no accepted version`
        );
      }
      continue;
    }

    await input.client.stepRunArtifactInput.create({
      data: {
        stepRunId: input.stepRunId,
        artifactKey: artifactInput.artifact,
        artifactVersionId: artifactVersion.id
      }
    });

    const stored = await readArtifactVersionContent({
      root: input.artifactStoreRoot,
      workflowId: input.workflowId,
      runId: input.workflowRunId,
      artifactKey: artifactInput.artifact,
      version: artifactVersion.version
    });
    const inputDirectory = path.join(
      input.runtimeRoot,
      "inputs",
      safeSegment(artifactInput.artifact)
    );
    const inputPath = path.join(
      inputDirectory,
      `${safeSegment(artifactInput.artifact)}${stored.extension}`
    );

    await mkdir(inputDirectory, { recursive: true });
    await writeFile(inputPath, stored.content, "utf8");

    prepared.push({
      artifact: artifactInput.artifact,
      artifactVersionId: artifactVersion.id,
      version: artifactVersion.version,
      contentUri: artifactVersion.contentUri,
      absolutePath: inputPath,
      promptPath: toPromptPath(input.workingDirectory, inputPath)
    });
  }

  return prepared;
}

function prepareOutputArtifacts(input: {
  workingDirectory: string;
  runtimeRoot: string;
  outputArtifacts: ArtifactDefinition[];
}) {
  const prepared: PreparedOutputArtifact[] = [];
  const seenArtifacts = new Set<string>();
  const seenFilenames = new Set<string>();
  const outputRoot = path.join(input.runtimeRoot, "outputs");

  for (const outputArtifact of input.outputArtifacts) {
    if (seenArtifacts.has(outputArtifact.artifact)) {
      throw new ArtifactRuntimeError(
        "artifact_output_duplicate_key",
        `Step declares output artifact ${outputArtifact.artifact} more than once`
      );
    }
    seenArtifacts.add(outputArtifact.artifact);

    const filename = assertRelativeFilename(
      outputArtifact.filename ?? defaultOutputFilename(outputArtifact),
      outputArtifact.artifact
    );

    if (seenFilenames.has(filename)) {
      throw new ArtifactRuntimeError(
        "artifact_output_duplicate_filename",
        `Step declares output filename ${filename} more than once`
      );
    }
    seenFilenames.add(filename);

    const absolutePath = path.join(outputRoot, filename);
    prepared.push({
      artifact: outputArtifact.artifact,
      filename,
      absolutePath,
      promptPath: toPromptPath(input.workingDirectory, absolutePath)
    });
  }

  return prepared;
}

export async function prepareCodexRuntimeContext(input: {
  client: ArtifactRuntimeClient;
  workflowId: string;
  workflowRunId: string;
  stepRunId: string;
  step: StepDefinition;
  workingDirectory: string;
  artifactStoreRoot: string;
  inputPayload?: Record<string, unknown>;
}): Promise<CodexRuntimePromptContext> {
  const runtimeRoot = runtimeRootFor(input.workingDirectory, input.stepRunId);
  const outputs = prepareOutputArtifacts({
    workingDirectory: input.workingDirectory,
    runtimeRoot,
    outputArtifacts: input.step.output_artifacts
  });

  await mkdir(runtimeRoot, { recursive: true });
  await Promise.all(
    outputs.map((output) => mkdir(path.dirname(output.absolutePath), { recursive: true }))
  );

  return {
    contextPaths: await prepareContextPaths({
      client: input.client,
      stepRunId: input.stepRunId,
      workingDirectory: input.workingDirectory,
      contextPaths: input.step.context_paths,
      inputPayload: input.inputPayload
    }),
    inputArtifacts: await prepareInputArtifacts({
      client: input.client,
      workflowId: input.workflowId,
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      workingDirectory: input.workingDirectory,
      artifactStoreRoot: input.artifactStoreRoot,
      runtimeRoot,
      inputArtifacts: input.step.input_artifacts
    }),
    outputArtifacts: outputs
  };
}

async function nextArtifactVersion(input: {
  client: ArtifactRuntimeClient;
  workflowRunId: string;
  artifactKey: string;
}) {
  const latest = await input.client.artifactVersion.findFirst({
    where: {
      workflowRunId: input.workflowRunId,
      artifactKey: input.artifactKey
    },
    orderBy: {
      version: "desc"
    }
  });

  return (latest?.version ?? 0) + 1;
}

export async function persistDeclaredOutputArtifacts(input: {
  client: ArtifactRuntimeClient;
  workflowId: string;
  workflowRunId: string;
  stepRunId: string;
  artifactStoreRoot: string;
  outputArtifacts: PreparedOutputArtifact[];
}) {
  for (const outputArtifact of input.outputArtifacts) {
    let content: string;
    try {
      content = await readFile(outputArtifact.absolutePath, "utf8");
    } catch (error) {
      throw new ArtifactRuntimeError(
        "artifact_output_missing",
        `Declared output artifact ${outputArtifact.artifact} was not written to ${outputArtifact.promptPath}`,
        { cause: error }
      );
    }

    const [version, parentVersion] = await Promise.all([
      nextArtifactVersion({
        client: input.client,
        workflowRunId: input.workflowRunId,
        artifactKey: outputArtifact.artifact
      }),
      findLatestAcceptedArtifact({
        client: input.client,
        workflowRunId: input.workflowRunId,
        artifactKey: outputArtifact.artifact
      })
    ]);
    const stored = await writeArtifactVersion({
      root: input.artifactStoreRoot,
      workflowId: input.workflowId,
      runId: input.workflowRunId,
      artifactKey: outputArtifact.artifact,
      version,
      filename: outputArtifact.filename,
      content
    });

    await input.client.artifactVersion.create({
      data: {
        workflowRunId: input.workflowRunId,
        artifactKey: outputArtifact.artifact,
        version,
        producerStepRunId: input.stepRunId,
        parentVersionId: parentVersion?.id,
        status: "CANDIDATE",
        contentUri: stored.contentUri,
        contentHash: stored.contentHash
      }
    });
  }
}

export async function acceptProducedArtifacts(input: {
  client: ArtifactRuntimeClient;
  stepRunId: string;
  now: Date;
}) {
  await input.client.artifactVersion.updateMany({
    where: {
      producerStepRunId: input.stepRunId,
      status: "CANDIDATE"
    },
    data: {
      status: "ACCEPTED",
      acceptedAt: input.now
    }
  });
}

export async function rejectProducedArtifacts(input: {
  client: ArtifactRuntimeClient;
  stepRunId: string;
}) {
  await input.client.artifactVersion.updateMany({
    where: {
      producerStepRunId: input.stepRunId,
      status: "CANDIDATE"
    },
    data: {
      status: "REJECTED"
    }
  });
}
