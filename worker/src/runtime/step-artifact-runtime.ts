import type { StepDefinition } from "@workflow-software/shared";
import {
  acceptProducedArtifacts,
  prepareCodexRuntimeContext,
  persistDeclaredOutputArtifacts,
  rejectProducedArtifacts,
  stepNeedsArtifactRuntime,
  type ArtifactRuntimeClient,
  type CodexRuntimePromptContext
} from "./artifact-runtime.js";

export type StepArtifactRuntimeSession = {
  enabled: boolean;
  runtimeContext?: CodexRuntimePromptContext;
};

export type StepArtifactRuntime = {
  prepare(input: {
    workflowId: string;
    workflowRunId: string;
    stepRunId: string;
    step: StepDefinition;
    workingDirectory: string;
    artifactStoreRoot: string;
  }): Promise<StepArtifactRuntimeSession>;
  persistDeclaredOutputs(input: {
    session: StepArtifactRuntimeSession;
    workflowId: string;
    workflowRunId: string;
    stepRunId: string;
    artifactStoreRoot: string;
  }): Promise<void>;
  acceptProduced(input: {
    session: StepArtifactRuntimeSession;
    workflowRunId: string;
    stepRunId: string;
    now: Date;
  }): Promise<void>;
  rejectProduced(input: {
    session: StepArtifactRuntimeSession;
    stepRunId: string;
  }): Promise<void>;
};

export type StepArtifactRuntimeClient = Partial<ArtifactRuntimeClient>;

function requireArtifactRuntimeClient(
  client: StepArtifactRuntimeClient
): ArtifactRuntimeClient {
  if (
    !client.artifactVersion ||
    !client.stepRunArtifactInput ||
    !client.contextPathEvent
  ) {
    throw new Error(
      "Artifact runtime requires artifactVersion, stepRunArtifactInput, and contextPathEvent clients"
    );
  }

  return client as ArtifactRuntimeClient;
}

export class DefaultStepArtifactRuntime implements StepArtifactRuntime {
  constructor(private readonly client: StepArtifactRuntimeClient) {}

  async prepare(input: {
    workflowId: string;
    workflowRunId: string;
    stepRunId: string;
    step: StepDefinition;
    workingDirectory: string;
    artifactStoreRoot: string;
  }): Promise<StepArtifactRuntimeSession> {
    const enabled = stepNeedsArtifactRuntime(input.step);
    console.log("[runtime.step-runner] artifact_runtime", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      enabled,
      contextPaths: input.step.context_paths.length,
      inputArtifacts: input.step.input_artifacts.length,
      outputArtifacts: input.step.output_artifacts.length
    });

    if (!enabled) {
      return { enabled: false };
    }

    const artifactClient = requireArtifactRuntimeClient(this.client);
    const runtimeContext = await prepareCodexRuntimeContext({
      client: artifactClient,
      workflowId: input.workflowId,
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      step: input.step,
      workingDirectory: input.workingDirectory,
      artifactStoreRoot: input.artifactStoreRoot
    });

    console.log("[runtime.step-runner] runtime_context.ready", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      contextPaths: runtimeContext.contextPaths.length,
      inputArtifacts: runtimeContext.inputArtifacts.length,
      outputArtifacts: runtimeContext.outputArtifacts.length
    });

    return {
      enabled: true,
      runtimeContext
    };
  }

  async persistDeclaredOutputs(input: {
    session: StepArtifactRuntimeSession;
    workflowId: string;
    workflowRunId: string;
    stepRunId: string;
    artifactStoreRoot: string;
  }) {
    if (!input.session.runtimeContext?.outputArtifacts.length) {
      return;
    }

    const artifactClient = requireArtifactRuntimeClient(this.client);
    console.log("[runtime.step-runner] output_artifacts.persist.start", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      count: input.session.runtimeContext.outputArtifacts.length
    });
    await persistDeclaredOutputArtifacts({
      client: artifactClient,
      workflowId: input.workflowId,
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      artifactStoreRoot: input.artifactStoreRoot,
      outputArtifacts: input.session.runtimeContext.outputArtifacts
    });
    console.log("[runtime.step-runner] output_artifacts.persist.complete", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      count: input.session.runtimeContext.outputArtifacts.length
    });
  }

  async acceptProduced(input: {
    session: StepArtifactRuntimeSession;
    workflowRunId: string;
    stepRunId: string;
    now: Date;
  }) {
    if (!input.session.enabled) {
      return;
    }

    const artifactClient = requireArtifactRuntimeClient(this.client);
    console.log("[runtime.step-runner] output_artifacts.accept.start", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId
    });
    await acceptProducedArtifacts({
      client: artifactClient,
      stepRunId: input.stepRunId,
      now: input.now
    });
    console.log("[runtime.step-runner] output_artifacts.accept.complete", {
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId
    });
  }

  async rejectProduced(input: {
    session: StepArtifactRuntimeSession;
    stepRunId: string;
  }) {
    if (!input.session.enabled) {
      return;
    }

    await rejectProducedArtifacts({
      client: requireArtifactRuntimeClient(this.client),
      stepRunId: input.stepRunId
    });
  }
}
