import type { Prisma } from "../generated/prisma/client.js";

export type StepWorkingDirectoryInput = {
  stepRunId: string;
  workflowRunId: string;
  codeWorkspaceId: string | null;
};

export type WorkspaceResolverClient = {
  codeWorkspace: {
    findFirst(args: Prisma.CodeWorkspaceFindFirstArgs): PromiseLike<{
      worktreePath: string;
    } | null>;
  };
};

export type WorkspaceResolver = {
  resolve(input: StepWorkingDirectoryInput): Promise<string>;
};

export class PrismaWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly client: WorkspaceResolverClient) {}

  async resolve(input: StepWorkingDirectoryInput) {
    const workspace = await this.client.codeWorkspace.findFirst({
      where: input.codeWorkspaceId
        ? {
            id: input.codeWorkspaceId,
            workflowRunId: input.workflowRunId
          }
        : {
            workflowRunId: input.workflowRunId
          },
      orderBy: {
        createdAt: "asc"
      },
      select: {
        worktreePath: true
      }
    });

    if (!workspace) {
      throw new Error(`StepRun ${input.stepRunId} does not have a CodeWorkspace`);
    }

    console.log("[runtime.step-runner] workspace.resolved", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      codeWorkspaceId: input.codeWorkspaceId,
      workingDirectory: workspace.worktreePath
    });

    return workspace.worktreePath;
  }
}

export class FunctionWorkspaceResolver implements WorkspaceResolver {
  constructor(
    private readonly resolveWorkingDirectory: (
      input: StepWorkingDirectoryInput
    ) => string | Promise<string>
  ) {}

  async resolve(input: StepWorkingDirectoryInput) {
    return this.resolveWorkingDirectory(input);
  }
}
