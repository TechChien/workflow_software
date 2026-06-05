CREATE TYPE "StepRunEvaluator" AS ENUM ('mixed', 'human_review', 'evaluator_review');

ALTER TABLE "StepRun"
ADD COLUMN "evaluator" "StepRunEvaluator" NOT NULL DEFAULT 'mixed';
