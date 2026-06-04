-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepRunStatus" AS ENUM ('PENDING', 'READY', 'RUNNING', 'WAITING_FOR_CODEX_PERMISSION', 'WAITING_FOR_CODEX_QUESTION', 'WAITING_FOR_HUMAN_REVIEW', 'WAITING_FOR_EVALUATOR_FEEDBACK', 'ACCEPTED', 'REJECTED', 'FAILED', 'STALE');

-- CreateEnum
CREATE TYPE "ArtifactStatus" AS ENUM ('CANDIDATE', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'STALE');

-- CreateEnum
CREATE TYPE "DecisionSource" AS ENUM ('EVALUATOR', 'HUMAN');

-- CreateEnum
CREATE TYPE "DecisionVerdict" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_REVISION');

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "draftYaml" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "yamlSnapshot" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowVersionId" TEXT NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'PENDING',
    "triggerType" TEXT NOT NULL DEFAULT 'run_button',
    "inputPayload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepRun" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "StepRunStatus" NOT NULL DEFAULT 'PENDING',
    "upstreamStepRunId" TEXT,
    "downstreamStepRunId" TEXT,
    "codexThreadId" TEXT,
    "codeWorkspaceId" TEXT,
    "beforeCommit" TEXT,
    "afterCommit" TEXT,
    "requiresCodeReview" BOOLEAN NOT NULL DEFAULT false,
    "staleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepRunArtifactInput" (
    "id" TEXT NOT NULL,
    "stepRunId" TEXT NOT NULL,
    "artifactKey" TEXT NOT NULL,
    "artifactVersionId" TEXT NOT NULL,

    CONSTRAINT "StepRunArtifactInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactVersion" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "artifactKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "producerStepRunId" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "status" "ArtifactStatus" NOT NULL DEFAULT 'CANDIDATE',
    "contentUri" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "ArtifactVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionEvent" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "stepRunId" TEXT NOT NULL,
    "source" "DecisionSource" NOT NULL,
    "verdict" "DecisionVerdict" NOT NULL,
    "comment" TEXT,
    "targetStepId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodexInteractionEvent" (
    "id" TEXT NOT NULL,
    "stepRunId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodexInteractionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextPathEvent" (
    "id" TEXT NOT NULL,
    "stepRunId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextPathEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolInvocation" (
    "id" TEXT NOT NULL,
    "stepRunId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "argumentsRedacted" JSONB NOT NULL DEFAULT '{}',
    "resultRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeWorkspace" (
    "id" TEXT NOT NULL,
    "workflowRunId" TEXT NOT NULL,
    "repoPath" TEXT NOT NULL,
    "baseRef" TEXT NOT NULL,
    "worktreePath" TEXT NOT NULL,
    "baseCommit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeChangeRecord" (
    "id" TEXT NOT NULL,
    "stepRunId" TEXT NOT NULL,
    "codeWorkspaceId" TEXT NOT NULL,
    "beforeCommit" TEXT NOT NULL,
    "afterCommit" TEXT,
    "diffUri" TEXT,
    "diffHash" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeChangeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");

-- CreateIndex
CREATE INDEX "StepRun_workflowRunId_status_idx" ON "StepRun"("workflowRunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StepRunArtifactInput_stepRunId_artifactKey_key" ON "StepRunArtifactInput"("stepRunId", "artifactKey");

-- CreateIndex
CREATE INDEX "ArtifactVersion_workflowRunId_artifactKey_status_idx" ON "ArtifactVersion"("workflowRunId", "artifactKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactVersion_workflowRunId_artifactKey_version_key" ON "ArtifactVersion"("workflowRunId", "artifactKey", "version");

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRun" ADD CONSTRAINT "StepRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRunArtifactInput" ADD CONSTRAINT "StepRunArtifactInput_stepRunId_fkey" FOREIGN KEY ("stepRunId") REFERENCES "StepRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRunArtifactInput" ADD CONSTRAINT "StepRunArtifactInput_artifactVersionId_fkey" FOREIGN KEY ("artifactVersionId") REFERENCES "ArtifactVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactVersion" ADD CONSTRAINT "ArtifactVersion_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactVersion" ADD CONSTRAINT "ArtifactVersion_producerStepRunId_fkey" FOREIGN KEY ("producerStepRunId") REFERENCES "StepRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionEvent" ADD CONSTRAINT "DecisionEvent_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionEvent" ADD CONSTRAINT "DecisionEvent_stepRunId_fkey" FOREIGN KEY ("stepRunId") REFERENCES "StepRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodexInteractionEvent" ADD CONSTRAINT "CodexInteractionEvent_stepRunId_fkey" FOREIGN KEY ("stepRunId") REFERENCES "StepRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextPathEvent" ADD CONSTRAINT "ContextPathEvent_stepRunId_fkey" FOREIGN KEY ("stepRunId") REFERENCES "StepRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolInvocation" ADD CONSTRAINT "ToolInvocation_stepRunId_fkey" FOREIGN KEY ("stepRunId") REFERENCES "StepRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeWorkspace" ADD CONSTRAINT "CodeWorkspace_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeChangeRecord" ADD CONSTRAINT "CodeChangeRecord_stepRunId_fkey" FOREIGN KEY ("stepRunId") REFERENCES "StepRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeChangeRecord" ADD CONSTRAINT "CodeChangeRecord_codeWorkspaceId_fkey" FOREIGN KEY ("codeWorkspaceId") REFERENCES "CodeWorkspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
