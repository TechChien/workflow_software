import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseWorkflowYaml } from "@workflow-software/shared";
import type { WorkflowVersion } from "../generated/prisma/client.js";
import {
  publishWorkflowDraft,
  type PublishWorkflowDraftClient
} from "./publish-service.js";
import type { CreateWorkflowRunDependencies } from "./run-service.js";
import { canonicalizeWorkflowDefinition } from "./workflow-definition.js";

type WorkflowRecord = {
  id: string;
  name: string;
  draftYaml: string;
};

type CreatedWorkflowRun = {
  id: string;
};

export type WorkflowCliClient = PublishWorkflowDraftClient &
  NonNullable<CreateWorkflowRunDependencies["client"]> & {
    workflow: {
      upsert(args: {
        where: { id: string };
        update: {
          name: string;
          draftYaml: string;
        };
        create: {
          id: string;
          name: string;
          draftYaml: string;
        };
      }): PromiseLike<WorkflowRecord>;
    };
  };

export type RunWorkflowFileDependencies = {
  client?: WorkflowCliClient;
  readWorkflowFile?: (workflowPath: string) => Promise<string>;
  createRun?: (
    workflowVersionId: string,
    inputPayload: Record<string, unknown>,
    dependencies: CreateWorkflowRunDependencies
  ) => PromiseLike<CreatedWorkflowRun>;
};

export type RunWorkflowFileInput = {
  workflowPath: string;
  inputPayload: Record<string, unknown>;
  repoPath?: string;
};

export type RunWorkflowFileResult = {
  workflowId: string;
  workflowVersionId: string;
  revision: number;
  workflowRunId: string;
};

async function defaultClient() {
  const { prisma } = await import("../db/prisma.js");
  return prisma as unknown as WorkflowCliClient;
}

async function defaultReadWorkflowFile(workflowPath: string) {
  return readFile(workflowPath, "utf8");
}

async function defaultCreateRun(
  workflowVersionId: string,
  inputPayload: Record<string, unknown>,
  dependencies: CreateWorkflowRunDependencies
) {
  const { createWorkflowRun } = await import("./run-service.js");
  return (await createWorkflowRun(
    workflowVersionId,
    inputPayload,
    dependencies
  )) as CreatedWorkflowRun;
}

export async function runWorkflowFile(
  input: RunWorkflowFileInput,
  dependencies: RunWorkflowFileDependencies = {}
): Promise<RunWorkflowFileResult> {
  const workflowPath = path.resolve(input.workflowPath);
  const readWorkflowFile = dependencies.readWorkflowFile ?? defaultReadWorkflowFile;
  const client = dependencies.client ?? (await defaultClient());
  const createRun = dependencies.createRun ?? defaultCreateRun;
  const source = await readWorkflowFile(workflowPath);
  const snapshot = canonicalizeWorkflowDefinition(parseWorkflowYaml(source));
  const workflow = await client.workflow.upsert({
    where: { id: snapshot.definition.id },
    update: {
      name: snapshot.definition.name,
      draftYaml: snapshot.yaml
    },
    create: {
      id: snapshot.definition.id,
      name: snapshot.definition.name,
      draftYaml: snapshot.yaml
    }
  });
  const version = (await publishWorkflowDraft(workflow.id, {
    client
  })) as WorkflowVersion;
  const repoPath = input.repoPath
    ? path.resolve(input.repoPath)
    : undefined;
  const runDependencies: CreateWorkflowRunDependencies = {
    client,
    ...(repoPath ? { resolveRepoPath: () => repoPath } : {})
  };
  const run = await createRun(version.id, input.inputPayload, runDependencies);

  return {
    workflowId: workflow.id,
    workflowVersionId: version.id,
    revision: version.revision,
    workflowRunId: run.id
  };
}
