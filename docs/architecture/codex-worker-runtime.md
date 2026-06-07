# Codex Worker Runtime

## Prompt ownership

`WorkflowVersion.yamlSnapshot` is the immutable design source for `steps[].prompt`.
Before a Codex turn starts, the worker verifies the snapshot hash, resolves the
matching `stepId`, and rejects empty prompts.

When a step has no runtime context, the exact submitted prompt is copied to
`StepRun.promptSnapshot`. When a step declares `context_paths`, `input_artifacts`,
or `output_artifacts`, the worker wraps the submitted prompt with a runtime
contract and stores that effective prompt in `StepRun.promptSnapshot`.

`CodexInteractionEvent` is not a prompt source. It is an ordered, reduced event
ledger for a running Codex turn.

## Artifact contract

`steps[].output_artifacts` is authoritative. Prompt-mentioned filenames are
instructions only when they match the declared outputs. If the prompt names a
different output file, asks for extra files, or omits the declared filenames, the
worker still instructs Codex to write only the declared artifact files.

Before the Codex turn, the runner stages paths under:

```txt
.workflow-runtime/artifacts/<stepRunId>/
  inputs/<artifactKey>/
  outputs/<declared filename>
```

Accepted upstream artifacts are materialized into `inputs/` and passed to Codex
as input artifact paths. Resolved `context_paths` are passed as context paths.
Declared outputs are passed as exact output paths.

After Codex completes, the runner reads only the declared output paths. Extra
files are ignored as workspace side effects. If any declared output is missing,
the step fails with `artifact_output_missing` and downstream steps are not readied.
When all declared outputs exist, the runner writes `ArtifactVersion` rows as
`CANDIDATE`; after the evaluator approves, those versions become `ACCEPTED` and
can be consumed by downstream `input_artifacts`.

## SDK usage

The worker pins `@openai/codex-sdk` to `0.136.0`. The SDK starts the bundled Codex
CLI and exposes its non-interactive JSONL event stream.

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

- https://developers.openai.com/codex/sdk
- https://developers.openai.com/codex/auth
- https://developers.openai.com/codex/app-server
