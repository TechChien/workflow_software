ALTER TABLE "WorkflowVersion" RENAME COLUMN "version" TO "revision";

ALTER INDEX "WorkflowVersion_workflowId_version_key"
RENAME TO "WorkflowVersion_workflowId_revision_key";
