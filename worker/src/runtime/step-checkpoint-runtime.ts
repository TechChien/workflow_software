import {
  commitApprovedStep,
  recordBeforeCommit,
  resetToCommit
} from "../code-workspace/git-checkpoints.js";
import type { Prisma } from "../generated/prisma/client.js";

export type StepCheckpointRuntimeClient = {
  stepRun: {
    update(args: Prisma.StepRunUpdateArgs): PromiseLike<unknown>;
  };
  codeChangeRecord: {
    create(args: Prisma.CodeChangeRecordCreateArgs): PromiseLike<unknown>;
    updateMany(
      args: Prisma.CodeChangeRecordUpdateManyArgs
    ): PromiseLike<{ count: number }>;
  };
};

export type StepCheckpointRuntime = {
  recordBefore(input: {
    stepRunId: string;
    codeWorkspaceId: string | null;
    workingDirectory: string;
  }): Promise<string | undefined>;
  commitApproved(input: {
    stepRunId: string;
    codeWorkspaceId: string | null;
    workingDirectory: string;
    beforeCommit?: string;
    message: string;
  }): Promise<string | undefined>;
  resetBeforeRerun(input: {
    stepRunId: string;
    codeWorkspaceId: string | null;
    workingDirectory: string;
    beforeCommit?: string | null;
  }): Promise<boolean>;
  markRejected(input: {
    stepRunId: string;
    codeWorkspaceId: string | null;
    beforeCommit?: string;
  }): Promise<void>;
};

function checkpointUnavailable(message: string) {
  return new Error(`Step checkpoint unavailable: ${message}`);
}

export class DefaultStepCheckpointRuntime implements StepCheckpointRuntime {
  constructor(private readonly client: StepCheckpointRuntimeClient) {}

  async recordBefore(input: {
    stepRunId: string;
    codeWorkspaceId: string | null;
    workingDirectory: string;
  }) {
    if (!input.codeWorkspaceId) {
      return undefined;
    }

    const beforeCommit = await recordBeforeCommit(input.workingDirectory);

    await this.client.stepRun.update({
      where: { id: input.stepRunId },
      data: {
        beforeCommit,
        afterCommit: null
      }
    });
    await this.client.codeChangeRecord.create({
      data: {
        stepRunId: input.stepRunId,
        codeWorkspaceId: input.codeWorkspaceId,
        beforeCommit,
        status: "candidate"
      }
    });

    return beforeCommit;
  }

  async commitApproved(input: {
    stepRunId: string;
    codeWorkspaceId: string | null;
    workingDirectory: string;
    beforeCommit?: string;
    message: string;
  }) {
    if (!input.codeWorkspaceId) {
      return undefined;
    }

    const beforeCommit =
      input.beforeCommit ?? (await recordBeforeCommit(input.workingDirectory));
    const afterCommit = await commitApprovedStep(
      input.workingDirectory,
      input.message
    );

    await this.client.stepRun.update({
      where: { id: input.stepRunId },
      data: {
        beforeCommit,
        afterCommit
      }
    });
    await this.client.codeChangeRecord.updateMany({
      where: {
        stepRunId: input.stepRunId,
        codeWorkspaceId: input.codeWorkspaceId,
        beforeCommit,
        status: "candidate"
      },
      data: {
        afterCommit,
        status: "accepted"
      }
    });

    return afterCommit;
  }

  async resetBeforeRerun(input: {
    stepRunId: string;
    codeWorkspaceId: string | null;
    workingDirectory: string;
    beforeCommit?: string | null;
  }) {
    if (!input.codeWorkspaceId) {
      throw checkpointUnavailable("StepRun does not have a code workspace");
    }

    if (!input.beforeCommit) {
      throw checkpointUnavailable("StepRun does not have a beforeCommit");
    }

    await resetToCommit(input.workingDirectory, input.beforeCommit);
    await this.client.codeChangeRecord.updateMany({
      where: {
        stepRunId: input.stepRunId,
        codeWorkspaceId: input.codeWorkspaceId,
        beforeCommit: input.beforeCommit,
        status: "candidate"
      },
      data: {
        status: "reverted"
      }
    });

    return true;
  }

  async markRejected(input: {
    stepRunId: string;
    codeWorkspaceId: string | null;
    beforeCommit?: string;
  }) {
    if (!input.codeWorkspaceId || !input.beforeCommit) {
      return;
    }

    await this.client.codeChangeRecord.updateMany({
      where: {
        stepRunId: input.stepRunId,
        codeWorkspaceId: input.codeWorkspaceId,
        beforeCommit: input.beforeCommit,
        status: "candidate"
      },
      data: {
        status: "rejected"
      }
    });
  }
}
