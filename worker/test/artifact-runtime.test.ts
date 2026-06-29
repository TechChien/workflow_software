import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StepDefinition } from "@workflow-software/shared";
import {
  acceptProducedArtifacts,
  prepareCodexRuntimeContext,
  persistDeclaredOutputArtifacts,
  type ArtifactRuntimeClient
} from "../src/runtime/artifact-runtime.js";

type ArtifactVersionRow = {
  id: string;
  artifactKey: string;
  version: number;
  status: string;
  contentUri: string;
  contentHash: string;
  producerStepRunId: string;
  parentVersionId: string | null;
  acceptedAt: Date | null;
  workflowRunId: string;
};

class FakeArtifactRuntimeDb {
  artifactVersions: ArtifactVersionRow[] = [];
  stepRunInputs: Array<{
    stepRunId: string;
    artifactKey: string;
    artifactVersionId: string;
  }> = [];
  contextPathEvents: Array<{
    stepRunId: string;
    path: string;
    type: string;
    status: string;
    reason?: string;
  }> = [];

  client(): ArtifactRuntimeClient {
    return {
      artifactVersion: {
        findFirst: async (args) => {
          const where = args.where ?? {};
          const matches = this.artifactVersions.filter(
            (artifact) =>
              (!where.workflowRunId || artifact.workflowRunId === where.workflowRunId) &&
              (!where.artifactKey || artifact.artifactKey === where.artifactKey) &&
              (!where.status || artifact.status === where.status)
          );

          if (args.orderBy && "version" in args.orderBy && args.orderBy.version === "desc") {
            matches.sort((left, right) => right.version - left.version);
          }

          return matches[0] ?? null;
        },
        create: async (args) => {
          const row: ArtifactVersionRow = {
            id: `artifact-version-${this.artifactVersions.length + 1}`,
            artifactKey: args.data.artifactKey,
            version: args.data.version,
            status: String(args.data.status),
            contentUri: args.data.contentUri,
            contentHash: args.data.contentHash,
            producerStepRunId: args.data.producerStepRunId!,
            parentVersionId: args.data.parentVersionId ?? null,
            acceptedAt: null,
            workflowRunId: args.data.workflowRunId!
          };
          this.artifactVersions.push(row);
          return row;
        },
        updateMany: async (args) => {
          const matches = this.artifactVersions.filter(
            (artifact) =>
              (!args.where?.producerStepRunId ||
                artifact.producerStepRunId === args.where.producerStepRunId) &&
              (!args.where?.status || artifact.status === args.where.status)
          );
          matches.forEach((artifact) => {
            if (args.data.status) {
              artifact.status = String(args.data.status);
            }
            if (args.data.acceptedAt instanceof Date) {
              artifact.acceptedAt = args.data.acceptedAt;
            }
          });
          return { count: matches.length };
        }
      },
      stepRunArtifactInput: {
        create: async (args) => {
          this.stepRunInputs.push({
            stepRunId: args.data.stepRunId!,
            artifactKey: args.data.artifactKey,
            artifactVersionId: args.data.artifactVersionId!
          });
          return args.data;
        }
      },
      contextPathEvent: {
        create: async (args) => {
          this.contextPathEvents.push({
            stepRunId: args.data.stepRunId!,
            path: args.data.path,
            type: args.data.type,
            status: args.data.status,
            reason: args.data.reason ?? undefined
          });
          return args.data;
        }
      }
    };
  }
}

function stepDefinition(step: Partial<StepDefinition>): StepDefinition {
  return {
    id: "step-1",
    type: "code_agent",
    depends_on: [],
    input_artifacts: [],
    output_artifacts: [],
    context_paths: [],
    tool_capabilities: [],
    evaluate: { evaluator: "mixed", rerun: false },
    prompt: "Run the step.",
    acceptance: { criteria: [] },
    ...step
  };
}

describe("artifact runtime", () => {
  let root: string;
  let workingDirectory: string;
  let artifactStoreRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "workflow-artifact-runtime-"));
    workingDirectory = path.join(root, "worktree");
    artifactStoreRoot = path.join(root, "artifact-store");
    await mkdir(workingDirectory, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("persists only declared outputs and materializes accepted inputs for downstream steps", async () => {
    const db = new FakeArtifactRuntimeDb();
    const client = db.client();
    const firstStep = stepDefinition({
      output_artifacts: [
        {
          artifact: "summary",
          filename: "declared-summary.md",
          format: "markdown"
        }
      ]
    });

    const firstContext = await prepareCodexRuntimeContext({
      client,
      workflowId: "workflow-1",
      workflowRunId: "workflow-run-1",
      stepRunId: "step-run-1",
      step: firstStep,
      workingDirectory,
      artifactStoreRoot
    });

    await expect(
      persistDeclaredOutputArtifacts({
        client,
        workflowId: "workflow-1",
        workflowRunId: "workflow-run-1",
        stepRunId: "step-run-1",
        artifactStoreRoot,
        outputArtifacts: firstContext.outputArtifacts
      })
    ).rejects.toMatchObject({ code: "artifact_output_missing" });

    await writeFile(
      firstContext.outputArtifacts[0]?.absolutePath ?? "",
      "SUMMARY_MARKER",
      "utf8"
    );
    await persistDeclaredOutputArtifacts({
      client,
      workflowId: "workflow-1",
      workflowRunId: "workflow-run-1",
      stepRunId: "step-run-1",
      artifactStoreRoot,
      outputArtifacts: firstContext.outputArtifacts
    });
    expect(db.artifactVersions[0]).toMatchObject({
      artifactKey: "summary",
      version: 1,
      status: "CANDIDATE"
    });

    await acceptProducedArtifacts({
      client,
      stepRunId: "step-run-1",
      now: new Date(Date.UTC(2026, 0, 1))
    });
    expect(db.artifactVersions[0]?.status).toBe("ACCEPTED");

    await mkdir(path.join(workingDirectory, "src"), { recursive: true });
    await writeFile(path.join(workingDirectory, "src", "notes.md"), "CONTEXT_MARKER", "utf8");

    const secondContext = await prepareCodexRuntimeContext({
      client,
      workflowId: "workflow-1",
      workflowRunId: "workflow-run-1",
      stepRunId: "step-run-2",
      step: stepDefinition({
        input_artifacts: [{ artifact: "summary", required: true }],
        context_paths: [{ path: "src/notes.md", type: "file" }],
        output_artifacts: [
          {
            artifact: "downstream",
            filename: "declared-downstream.md",
            format: "markdown"
          }
        ]
      }),
      workingDirectory,
      artifactStoreRoot
    });

    await expect(readFile(secondContext.inputArtifacts[0]?.absolutePath ?? "", "utf8")).resolves.toBe(
      "SUMMARY_MARKER"
    );
    expect(db.stepRunInputs).toEqual([
      {
        stepRunId: "step-run-2",
        artifactKey: "summary",
        artifactVersionId: "artifact-version-1"
      }
    ]);
    expect(db.contextPathEvents[0]).toMatchObject({
      stepRunId: "step-run-2",
      path: "src/notes.md",
      status: "resolved"
    });
  });

  it("fails when a declared context path is unavailable", async () => {
    const db = new FakeArtifactRuntimeDb();

    await expect(
      prepareCodexRuntimeContext({
        client: db.client(),
        workflowId: "workflow-1",
        workflowRunId: "workflow-run-1",
        stepRunId: "step-run-1",
        step: stepDefinition({
          context_paths: [{ path: "missing.md", type: "file" }]
        }),
        workingDirectory,
        artifactStoreRoot
      })
    ).rejects.toMatchObject({
      code: "context_path_required_unavailable",
      message: "Required context path missing.md is unavailable: path_missing_or_inaccessible"
    });
    expect(db.contextPathEvents[0]).toMatchObject({
      stepRunId: "step-run-1",
      path: "missing.md",
      status: "skipped",
      reason: "path_missing_or_inaccessible"
    });
  });

  it("uses input payload context paths as requirements entrypoints", async () => {
    const db = new FakeArtifactRuntimeDb();
    const requirementsDirectory = path.join(workingDirectory, "docs", "requirements");
    await mkdir(requirementsDirectory, { recursive: true });
    await writeFile(
      path.join(requirementsDirectory, "request.md"),
      "Original request",
      "utf8"
    );

    const runtimeContext = await prepareCodexRuntimeContext({
      client: db.client(),
      workflowId: "workflow-1",
      workflowRunId: "workflow-run-1",
      stepRunId: "step-run-1",
      step: stepDefinition({
        context_paths: [
          {
            path: "${inputPayload.requirementsPath}",
            type: "directory"
          }
        ]
      }),
      workingDirectory,
      artifactStoreRoot,
      inputPayload: {
        requirementsPath: "docs/requirements"
      }
    });

    expect(runtimeContext.contextPaths).toEqual([
      {
        path: "docs/requirements",
        type: "directory",
        absolutePath: requirementsDirectory,
        promptPath: "docs/requirements"
      }
    ]);
    expect(db.contextPathEvents[0]).toMatchObject({
      stepRunId: "step-run-1",
      path: "docs/requirements",
      status: "resolved"
    });
  });
});
