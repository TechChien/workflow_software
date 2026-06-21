# Workflow Software

UI-first, YAML-backed workflow builder for designing and running Codex-powered workflows.

Users compose workflows in a visual UI. The UI produces canonical YAML, publishes immutable workflow versions, and runs published versions through a separate worker service.

## Project Structure

```text
workflow_software/
  ui/       Next.js frontend. Calls worker REST APIs only.
  worker/   Backend API, runtime worker, Prisma, Codex SDK, artifacts, worktrees.
  shared/   Zod schemas, shared types, constants, and YAML helpers.
  infra/    Local infrastructure and environment examples.
  docs/     Architecture notes and example workflow YAML.
  data/     Gitignored runtime artifacts, worktrees, and exports.
```

## Core Decisions

- Package manager: pnpm workspace.
- UI: Next.js + React Flow / xyflow.
- Worker: TypeScript service with REST API and Postgres polling.
- Runtime agent: `@openai/codex-sdk`.
- Database: PostgreSQL with Prisma owned by `worker/`.
- Shared contracts: Zod schemas in `shared/`.
- Formal artifacts: written by the worker under `data/artifacts/`.
- Source code changes: made in dedicated git worktrees under `data/worktrees/`.

## Sources of Truth

- Workflow definitions come only from canonical YAML.
- `Workflow.draftYaml` is the editable definition; `Workflow.name` is a read projection derived from it.
- `WorkflowVersion.yamlSnapshot` is the immutable definition used by every run.
- `WorkflowVersion.revision` is a publish sequence; the workflow's semantic `version` remains inside YAML.
- PostgreSQL is authoritative for runtime state, execution history, decisions, and lineage.
- Artifact contents live in the artifact store, while source code contents live in Git worktrees.

## Setup

Install dependencies:

```bash
pnpm install
```

or

```bash
pnpm install --frozen-lockfile
```

Start local PostgreSQL:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Copy environment examples:

```bash
cp infra/env/worker.env.example worker/.env
cp infra/env/ui.env.example ui/.env.local
```

Generate Prisma client and run migrations when migrations are added:

```bash
pnpm --filter @workflow-software/worker prisma:generate
pnpm --filter @workflow-software/worker prisma:migrate
```

## Development

Run a workflow YAML from the CLI:

```bash
pnpm --filter @workflow-software/worker cli -- docs/examples/workflow.yaml
```

Pass an optional JSON input payload:

```bash
pnpm --filter @workflow-software/worker cli -- docs/examples/workflow.yaml --input '{"key":"value"}'
```

The CLI canonicalizes the YAML, upserts the workflow draft, publishes an immutable workflow version, creates a workflow run, and prints JSON with the workflow, version, revision, and run IDs.

The CLI does not execute queued steps by itself. Start the worker API and poller to pull `READY` step runs and execute them:

```bash
pnpm dev:worker
```

Polling is controlled by `WORKER_POLLING_ENABLED` and `WORKER_POLL_INTERVAL_MS` in `worker/.env`.

Run the UI:

```bash
pnpm dev:ui
```

Run the worker API and poller:

```bash
pnpm dev:worker
```

Run the opt-in workspace integration test with a real DB client and Codex executor:

```powershell
$env:RUN_WORKSPACE_INTEGRATION="true"
$env:CODE_WORKSPACE_REPO_PATH="C:\path\to\actual\repo"
pnpm --filter @workflow-software/worker test -- workspace.integration.test.ts
```

The test rolls back database rows, leaves the created git worktree on disk, and prints a manual cleanup command:

```powershell
git -C "C:\path\to\actual\repo" worktree remove --force "<printed-worktree-path>"
```

Build all packages:

```bash
pnpm build
```

Typecheck all packages:

```bash
pnpm typecheck
```

## Runtime Rules

- Draft workflows are editable.
- Published workflow versions are immutable.
- Run button executes published versions only.
- Workers verify and parse the published YAML snapshot instead of reconstructing definitions from runtime rows.
- Each node has at most one upstream node and one downstream node.
- Each step can consume multiple artifact inputs and produce multiple artifacts.
- Each step can define multiple acceptance criteria.
- `step.evaluate.rerun` opts a step into checkpointed reruns after rejected artifacts.
- Artifacts are immutable; reruns create new versions.
- Downstream step runs record the exact artifact versions they consumed.
- Optional context paths are worktree-relative and skipped when missing or inaccessible.
- Codex does not write the artifact store directly; the worker persists formal artifacts.

## Useful Files

- `docs/architecture/folder-structure.md`
- `docs/examples/workflow.yaml`
- `worker/prisma/schema.prisma`
- `plan.md`
