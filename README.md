# Workflow Software

UI-first, YAML-backed workflow builder for designing and running agent-powered workflows.

Users compose workflows in a visual UI. The UI produces canonical YAML, publishes immutable workflow versions, and runs published versions through a separate worker service.

## Project Structure

```text
workflow_software/
  ui/       Next.js frontend. Calls worker REST APIs only.
  worker/   Backend API, runtime worker, Prisma, agent executors, artifacts, worktrees.
  shared/   Zod schemas, shared types, constants, and YAML helpers.
  infra/    Local infrastructure and environment examples.
  docs/     Architecture notes and example workflow YAML.
  data/     Gitignored runtime artifacts, worktrees, and exports.
```

## Core Decisions

- Package manager: pnpm workspace.
- UI: Next.js + React Flow / xyflow.
- Worker: TypeScript service with REST API and Postgres polling.
- Runtime agent: strategy-selected `ClaudeCodeAgent` or `CodexAgent`; defaults to Claude Code via `@anthropic-ai/claude-agent-sdk`.
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
pnpm --filter @workflow-software/worker cli -- docs/examples/workflow.yaml --input-payload '{"key":"value"}'
```

`--input` is kept as a backward-compatible alias.

Workflow context paths can use run input payload values as entrypoints:

```yaml
context_paths:
  - path: "${inputPayload.requirementsPath}"
    type: directory
```

The CLI can then provide the requirements path:

```bash
pnpm --filter @workflow-software/worker cli -- docs/examples/workflow.yaml --input-payload '{"requirementsPath":"docs/requirements"}'
```

Absolute paths are used as-is. Relative paths are resolved from the generated
step worktree root.

The CLI canonicalizes the YAML, upserts the workflow draft, publishes an immutable workflow version, creates a workflow run, and prints JSON with the workflow, version, revision, and run IDs.

The CLI does not execute queued steps by itself. Start the worker API and poller to pull `READY` step runs and execute them:

```bash
pnpm dev:worker
```

Polling is controlled by `WORKER_POLLING_ENABLED` and `WORKER_POLL_INTERVAL_MS` in `worker/.env`.

Agent execution is selected at the worker level:

```bash
AGENT_EXECUTOR=claude
AGENT_EVALUATOR=claude
# Optional gateway/proxy for Anthropic-compatible providers:
ANTHROPIC_BASE_URL=https://your-anthropic-compatible-gateway.example/v1
```

Set either value to `codex` to use the Codex adapter. Claude Code auth and
gateway variables are passed through from `worker/.env`; do not include secrets
inside persisted workflow data.

Run a direct Claude Agent smoke turn through the configured Claude Code auth or
Claude Code Router gateway:

```powershell
$env:ANTHROPIC_BASE_URL="https://your-anthropic-compatible-gateway.example/v1"
$env:ANTHROPIC_AUTH_TOKEN="replace-with-router-token"
pnpm.cmd --filter @workflow-software/worker claude:smoke -- "Inspect this workspace in one short sentence."
```

The smoke command runs a real `ClaudeCodeAgent` turn, prints JSONL lifecycle
events, and requires the final response to contain `CLAUDE_SMOKE_DONE`. It uses a
read-only permission profile by default; pass `--workspace-write` only when the
prompt should test executor write access.

Run the UI:

```bash
pnpm dev:ui
```

Run the worker API and poller:

```bash
pnpm dev:worker
```

Run the opt-in workspace integration test with a real DB client and executor:

```powershell
$env:RUN_WORKSPACE_INTEGRATION="true"
$env:CODE_WORKSPACE_REPO_PATH="C:\path\to\actual\repo"
pnpm --filter @workflow-software/worker test -- workspace.integration.test.ts
```

The test rolls back database rows, leaves the created git worktree on disk, and prints a manual cleanup command:

```powershell
git -C "C:\path\to\actual\repo" worktree remove --force "<printed-worktree-path>"
```

Run the opt-in Claude Agent integration test without DB persistence:

```powershell
$env:RUN_CLAUDE_AGENT_INTEGRATION="true"
$env:ANTHROPIC_BASE_URL="https://your-anthropic-compatible-gateway.example/v1"
$env:ANTHROPIC_AUTH_TOKEN="replace-with-router-token"
pnpm.cmd --filter @workflow-software/worker test:claude:integration
```

The test performs a real read-only Claude turn through the same SDK adapter and
asserts that a session starts, `turn.completed` is recorded, usage is returned,
and the final response includes `CLAUDE_AGENT_INTEGRATION_DONE`.

Manual Claude Code Router test items are tracked in
`docs/testing/claude-agent-router-manual-test-plan.md`.

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
- Context paths are required before the agent turn starts.
- Context paths may be static paths or `${inputPayload.key}` placeholders.
- Absolute context paths are used as-is; relative context paths are resolved from the generated step worktree root.
- The runtime agent does not write the artifact store directly; the worker persists formal artifacts.

## Useful Files

- `docs/architecture/folder-structure.md`
- `docs/examples/workflow.yaml`
- `worker/prisma/schema.prisma`
- `plan.md`
