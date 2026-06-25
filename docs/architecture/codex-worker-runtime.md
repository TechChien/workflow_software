# Agent Worker Runtime

## Prompt ownership

`WorkflowVersion.yamlSnapshot` is the immutable design source for `steps[].prompt`.
Before an agent turn starts, the worker verifies the snapshot hash, resolves the
matching `stepId`, and rejects empty prompts.

When a step has no runtime context, the exact submitted prompt is copied to
`StepRun.promptSnapshot`. When a step declares `context_paths`, `input_artifacts`,
or `output_artifacts`, the worker wraps the submitted prompt with a runtime
contract and stores that effective prompt in `StepRun.promptSnapshot`.

`CodexInteractionEvent` is not a prompt source. It is an ordered, reduced event
ledger for a running agent turn. The table and `StepRun.codex*` fields keep their
legacy names for schema compatibility; provider metadata is stored in JSON
payloads such as `codexOptions` and interaction events.

## Artifact contract

`steps[].output_artifacts` is authoritative. Prompt-mentioned filenames are
instructions only when they match the declared outputs. If the prompt names a
different output file, asks for extra files, or omits the declared filenames, the
worker still instructs the runtime agent to write only the declared artifact files.

Before the Codex turn, the runner stages paths under:

```txt
.workflow-runtime/artifacts/<stepRunId>/
  inputs/<artifactKey>/
  outputs/<declared filename>
```

Accepted upstream artifacts are materialized into `inputs/` and passed to the agent
as input artifact paths. Resolved `context_paths` may point inside or outside the
working directory; they are passed as context paths and their directories are
added to the agent access list. Declared outputs are passed as exact
output paths. All declared `context_paths` are required; if any path is missing,
inaccessible, or has the wrong declared type, the step fails with
`context_path_required_unavailable` before the agent turn starts.

After the agent completes, the runner reads only the declared output paths. Extra
files are ignored as workspace side effects. If any declared output is missing,
the step fails with `artifact_output_missing` and downstream steps are not readied.
When all declared outputs exist, the runner writes `ArtifactVersion` rows as
`CANDIDATE`; after the evaluator approves, those versions become `ACCEPTED` and
can be consumed by downstream `input_artifacts`.

## Checkpointed reruns

Before each agent turn, the worker records the worktree `HEAD` in
`StepRun.beforeCommit` and creates a candidate `CodeChangeRecord`. If a step
sets `evaluate.rerun: true` and its artifacts are rejected, the worker resets the
dedicated worktree to `beforeCommit`, marks candidate artifacts as `SUPERSEDED`,
increments `StepRun.attempt`, and queues the same step as `READY`.

Human `request_revision` decisions always use the checkpointed rerun path.
Human `reject` decisions use it only when `evaluate.rerun` is true. Evaluator
reject/request-revision results use it only when `evaluate.rerun` is true, with a
single automatic retry guard to avoid uncontrolled loops.

When a step is finally accepted, source changes are committed in the dedicated
worktree and `StepRun.afterCommit` is recorded. Runtime files under
`.workflow-runtime` are excluded from approved source commits.

## Agent strategy and SDK usage

Step execution and evaluator turns run through an `IAgent` strategy. Worker env
selects the provider:

```txt
AGENT_EXECUTOR=claude|codex
AGENT_EVALUATOR=claude|codex
```

Both default to `claude`. `ClaudeCodeAgent` uses
`@anthropic-ai/claude-agent-sdk`; `CodexAgent` keeps the existing
`@openai/codex-sdk` path.

Claude Code gateway/proxy routing is configured with `ANTHROPIC_BASE_URL`.
When Claude subprocess env overrides are required, the worker passes
`{ ...process.env, ...overrides }` because the SDK `env` option replaces the
subprocess environment. Persisted `codexOptions` record only non-secret metadata
such as provider, model, effort, permission mode, tool lists, and whether an
Anthropic base URL was configured.

The Codex adapter pins `@openai/codex-sdk` to `0.136.0`. The SDK starts the
bundled Codex CLI and exposes its non-interactive JSONL event stream.

Every `agent` and `code_agent` turn uses:

```ts
{
  workingDirectory,
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
  networkAccessEnabled: false,
  webSearchMode: "disabled"
}
```

`workspace-write` is a `sandboxMode`, not an `approvalPolicy`. With
`approvalPolicy: "never"`, Codex can write inside the sandbox without pausing for
approval, but actions outside the sandbox are denied.

The SDK does not expose resumable permission or user-question requests. A product
that must pause and answer the same in-progress turn should use Codex App Server
instead of this TypeScript SDK execution path.

The worker uses `runStreamed(prompt, { signal })` and handles events as follows:

| SDK event | Runtime behavior |
| --- | --- |
| `thread.started` | Save `StepRun.codexThreadId`. |
| `item.completed` | Save a sanitized event. Command output and MCP arguments/results are omitted. |
| `turn.completed` | Save usage and the last completed agent message, then set `CODEX_COMPLETED`. |
| `turn.failed` / `error` | Save the error event and set `FAILED`. |
| `turn.started` / `item.started` / `item.updated` | Ignore. |

`CODEX_API_KEY` and `CODEX_BASE_URL` are passed only to the SDK client. They are
never included in `StepRun.codexOptions` or interaction payloads. Do not pass the
SDK `env` option unless replacing the complete child-process environment is
intentional.

## Persistence lifecycle

The Codex process runs outside database transactions. State changes and important
events are committed independently.

### Successful turn

| Table | Example state |
| --- | --- |
| `StepRun` at claim | `status=RUNNING`, `promptSnapshot=<exact prompt>`, `codexOptions={sandboxMode: workspace-write, approvalPolicy: never, ...}` |
| `StepRun` after `thread.started` | `codexThreadId=<thread id>` |
| `CodexInteractionEvent` | Ordered completed items followed by `turn.completed` and its usage |
| `StepRun` at finish | `status=CODEX_COMPLETED`, `codexFinalResponse=<last agent message>`, `codexUsage=<usage>`, `codexCompletedAt=<time>` |

### Failed or timed-out turn

| Table | Example state |
| --- | --- |
| `CodexInteractionEvent` | Existing completed items, then `turn.failed`, SDK `error`, or a synthetic timeout/stream error |
| `StepRun` | `status=FAILED`, `codexError={code, message}`, `codexCompletedAt=<time>`, `completedAt=<time>` |

`CodexInteractionEvent.sequence` is unique per StepRun. `externalItemId` is also
unique per StepRun when present, preventing duplicate completed SDK items.

## Testing and smoke run

Unit tests inject a fake `CodexGateway` and in-memory `CodexRunRecorder`; they do
not initialize Prisma or connect to PostgreSQL.

The opt-in smoke command calls the real SDK, uses workspace-write/no-network, and
does not persist data:

```bash
pnpm --filter @workflow-software/worker codex:smoke -- "Reply with a short workspace summary."
```

It requires either a valid Codex CLI cached login or `CODEX_API_KEY`, and it may
incur API cost.

Official references:

- https://code.claude.com/docs/en/env-vars
- https://code.claude.com/docs/en/agent-sdk/structured-outputs
- https://code.claude.com/docs/en/agent-sdk/permissions
- https://developers.openai.com/codex/sdk
- https://developers.openai.com/codex/auth
- https://developers.openai.com/codex/app-server
