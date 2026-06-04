-- AddEnumValue
ALTER TYPE "StepRunStatus" ADD VALUE 'CODEX_COMPLETED' AFTER 'RUNNING';

-- AlterTable
ALTER TABLE "StepRun"
ADD COLUMN "promptSnapshot" TEXT,
ADD COLUMN "codexOptions" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "codexFinalResponse" TEXT,
ADD COLUMN "codexUsage" JSONB,
ADD COLUMN "codexError" JSONB,
ADD COLUMN "codexCompletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CodexInteractionEvent"
ADD COLUMN "sequence" INTEGER,
ADD COLUMN "externalItemId" TEXT;

UPDATE "CodexInteractionEvent"
SET "payload" = "payload" || jsonb_build_object('legacyPrompt', "prompt");

WITH ordered_events AS (
  SELECT
    "id",
    CAST(
      row_number() OVER (
        PARTITION BY "stepRunId"
        ORDER BY "createdAt", "id"
      ) AS INTEGER
    ) AS "sequence"
  FROM "CodexInteractionEvent"
)
UPDATE "CodexInteractionEvent" AS event
SET "sequence" = ordered_events."sequence"
FROM ordered_events
WHERE event."id" = ordered_events."id";

ALTER TABLE "CodexInteractionEvent"
ALTER COLUMN "sequence" SET NOT NULL,
DROP COLUMN "prompt";

-- CreateIndex
CREATE UNIQUE INDEX "StepRun_codexThreadId_key" ON "StepRun"("codexThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "CodexInteractionEvent_stepRunId_sequence_key"
ON "CodexInteractionEvent"("stepRunId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CodexInteractionEvent_stepRunId_externalItemId_key"
ON "CodexInteractionEvent"("stepRunId", "externalItemId");
