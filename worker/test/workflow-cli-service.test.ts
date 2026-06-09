import { describe, expect, it, vi } from "vitest";
import {
  runWorkflowFile,
  type WorkflowCliClient
} from "../src/runtime/workflow-cli-service.js";

type WorkflowRecord = {
  id: string;
  name: string;
  draftYaml: string;
};

type WorkflowVersionRecord = {
  id: string;
  workflowId: string;
  revision: number;
  yamlSnapshot: string;
  contentHash: string;
  publishedAt: Date;
};

function workflowYaml(input: { id?: string; name: string }) {
  return [
    `id: ${input.id ?? "cli-workflow"}`,
    `name: ${input.name}`,
    "version: 0.1.0",
    "inputs: {}",
    "artifacts: {}",
    "steps:",
    "  - id: step_1",
    "    type: agent",
    "    input_artifacts: []",
    "    output_artifacts: []",
    "    context_paths: []",
    "    tool_capabilities: []",
    "    prompt: Run the CLI workflow.",
    "    acceptance:",
    "      criteria: []",
    "ui: {}"
  ].join("\n");
}

function createFakeClient() {
  const workflows = new Map<string, WorkflowRecord>();
  const versions: WorkflowVersionRecord[] = [];
  const upsert = vi.fn(async (args: {
    where: { id: string };
    update: { name: string; draftYaml: string };
    create: { id: string; name: string; draftYaml: string };
  }) => {
    const existing = workflows.get(args.where.id);
    const workflow = existing
      ? {
          ...existing,
          ...args.update
        }
      : args.create;

    workflows.set(args.where.id, workflow);
    return workflow;
  });
  const findUniqueOrThrow = vi.fn(async (args: { where: { id: string } }) => {
    const workflow = workflows.get(args.where.id);

    if (!workflow) {
      throw new Error(`Workflow ${args.where.id} not found`);
    }

    return workflow;
  });
  const findFirst = vi.fn(async (args: {
    where: { workflowId: string };
    orderBy: { revision: "desc" };
    select: { revision: true };
  }) => {
    const latestVersion = versions
      .filter((version) => version.workflowId === args.where.workflowId)
      .sort((left, right) => right.revision - left.revision)[0];

    return latestVersion ? { revision: latestVersion.revision } : null;
  });
  const createVersion = vi.fn(async (args: {
    data: {
      workflowId: string;
      revision: number;
      yamlSnapshot: string;
      contentHash: string;
    };
  }) => {
    const version = {
      id: `workflow-version-${versions.length + 1}`,
      ...args.data,
      publishedAt: new Date("2026-06-09T00:00:00.000Z")
    };

    versions.push(version);
    return version;
  });
  const client = {
    workflow: {
      upsert
    },
    workflowVersion: {
      findUniqueOrThrow: vi.fn(),
      findFirst,
      create: createVersion
    },
    workflowRun: {
      create: vi.fn()
    },
    $transaction: vi.fn(async (fn) =>
      fn({
        workflow: {
          findUniqueOrThrow
        },
        workflowVersion: {
          findFirst,
          create: createVersion
        }
      })
    )
  } as unknown as WorkflowCliClient;

  return {
    client,
    workflows,
    versions,
    upsert,
    findUniqueOrThrow,
    findFirst,
    createVersion
  };
}

describe("runWorkflowFile", () => {
  it("creates a workflow, publishes a version, and creates a run", async () => {
    const fake = createFakeClient();
    const readWorkflowFile = vi.fn(async () => workflowYaml({ name: "CLI Workflow" }));
    const createRun = vi.fn(async () => ({ id: "workflow-run-1" }));

    const result = await runWorkflowFile(
      {
        workflowPath: "docs/examples/workflow.yaml",
        inputPayload: {}
      },
      {
        client: fake.client,
        readWorkflowFile,
        createRun
      }
    );

    expect(fake.workflows.get("cli-workflow")).toMatchObject({
      id: "cli-workflow",
      name: "CLI Workflow"
    });
    expect(fake.versions).toHaveLength(1);
    expect(fake.versions[0]).toMatchObject({
      id: "workflow-version-1",
      workflowId: "cli-workflow",
      revision: 1
    });
    expect(createRun).toHaveBeenCalledWith("workflow-version-1", {}, { client: fake.client });
    expect(result).toEqual({
      workflowId: "cli-workflow",
      workflowVersionId: "workflow-version-1",
      revision: 1,
      workflowRunId: "workflow-run-1"
    });
  });

  it("updates the existing workflow draft for repeated YAML ids", async () => {
    const fake = createFakeClient();
    const readWorkflowFile = vi
      .fn()
      .mockResolvedValueOnce(workflowYaml({ name: "Original CLI Workflow" }))
      .mockResolvedValueOnce(workflowYaml({ name: "Updated CLI Workflow" }));
    const createRun = vi
      .fn()
      .mockResolvedValueOnce({ id: "workflow-run-1" })
      .mockResolvedValueOnce({ id: "workflow-run-2" });

    await runWorkflowFile(
      {
        workflowPath: "workflow.yaml",
        inputPayload: {}
      },
      {
        client: fake.client,
        readWorkflowFile,
        createRun
      }
    );
    const result = await runWorkflowFile(
      {
        workflowPath: "workflow.yaml",
        inputPayload: {}
      },
      {
        client: fake.client,
        readWorkflowFile,
        createRun
      }
    );

    expect(fake.workflows.size).toBe(1);
    expect(fake.workflows.get("cli-workflow")?.name).toBe("Updated CLI Workflow");
    expect(fake.versions.map((version) => version.revision)).toEqual([1, 2]);
    expect(result).toMatchObject({
      workflowId: "cli-workflow",
      workflowVersionId: "workflow-version-2",
      revision: 2,
      workflowRunId: "workflow-run-2"
    });
  });

  it("passes the input payload to run creation", async () => {
    const fake = createFakeClient();
    const inputPayload = {
      issue: "123"
    };
    const createRun = vi.fn(async () => ({ id: "workflow-run-1" }));

    await runWorkflowFile(
      {
        workflowPath: "workflow.yaml",
        inputPayload
      },
      {
        client: fake.client,
        readWorkflowFile: async () => workflowYaml({ name: "CLI Workflow" }),
        createRun
      }
    );

    expect(createRun).toHaveBeenCalledWith("workflow-version-1", inputPayload, {
      client: fake.client
    });
  });
});
