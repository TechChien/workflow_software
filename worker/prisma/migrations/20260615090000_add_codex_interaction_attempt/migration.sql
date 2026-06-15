-- AlterTable
ALTER TABLE "CodexInteractionEvent"
ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;

-- DropIndex
DROP INDEX "CodexInteractionEvent_stepRunId_sequence_key";

-- DropIndex
DROP INDEX "CodexInteractionEvent_stepRunId_externalItemId_key";

-- CreateIndex
CREATE UNIQUE INDEX "CodexInteractionEvent_stepRunId_attempt_sequence_key"
ON "CodexInteractionEvent"("stepRunId", "attempt", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CodexInteractionEvent_stepRunId_attempt_externalItemId_key"
ON "CodexInteractionEvent"("stepRunId", "attempt", "externalItemId");
