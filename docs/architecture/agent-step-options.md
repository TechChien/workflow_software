# Agent Step Options

This document captures the current per-step agent configuration surface and the
open product decisions for options that may or may not be user-editable.

## Current Step YAML Shape

```yaml
steps:
  - id: inspect_ui
    type: code_agent
    agent:
      repository_id: default
      base_ref: HEAD
      options:
        provider: codex
        model: codex-test-model
        reasoning_effort: high
        timeout_ms: 1800000
```

`agent.repository_id` and `agent.base_ref` are saved as step defaults. When a
workflow run is created, the UI sends them as `stepWorkspaces[stepId]` so the
worker can resolve the server-side repository path from its repository config.
The worker creates a CodeWorkspace worktree from the resolved repo path and
base ref, then uses that generated worktree path as the agent starting
directory.

## User-Editable Options In This Version

| Option | Providers | Purpose |
| --- | --- | --- |
| `agent.repository_id` | claude, codex | Worker-side repository config key for this step workspace. |
| `agent.base_ref` | claude, codex | Git ref used when creating this step workspace. |
| `agent.options.provider` | claude, codex | Override the default executor provider for one step. |
| `agent.options.model` | claude, codex | Override the model for one step. |
| `agent.options.reasoning_effort` | codex | Override Codex reasoning effort. |
| `agent.options.effort` | claude | Override Claude effort. |
| `agent.options.timeout_ms` | claude, codex | Override the agent turn timeout for one step. |

## Run Workspace Resolution

`CreateRunRequest.stepWorkspaces` is a map keyed by step id:

```json
{
  "inputPayload": {},
  "stepWorkspaces": {
    "inspect_ui": {
      "repositoryId": "default",
      "baseRef": "HEAD"
    }
  }
}
```

The worker resolves `repositoryId` through `worker/src/config/repositories.ts`.
If a step omits repository settings, it inherits the previous step's resolved
repository path and base ref. If there is no previous step selection, the worker
uses the default repository config. Empty `stepWorkspaces` therefore still
creates a valid default code workspace.

The generated worktree directory is the `workingDirectory` passed into agent
execution, evaluator execution, checkpointing, and artifact preparation. Step
YAML no longer accepts a `working_directory` field.

## Candidate Options Requiring Product Decision

| Option | Provider | Current behavior | Decision needed |
| --- | --- | --- | --- |
| `permission_profile` | claude, codex | Step execution is fixed to `workspace-write`; evaluators use `read-only`. | Should normal users choose this, or should it stay runtime-controlled? |
| `approval_policy` | codex | Fixed to `never`. | Should this remain fixed for unattended workflow execution? |
| `sandbox_mode` | codex | Fixed by execution/evaluation purpose. | Should users ever be able to loosen or tighten sandboxing? |
| `network_access_enabled` | codex | Fixed to `false`. | Should network access be admin-only, workflow-level, or step-level? |
| `web_search_mode` | codex | Fixed to `disabled`. | Should web search be allowed for selected steps? |
| `permissionMode` | claude | Comes from worker env for executors; read-only evaluators use `dontAsk`. | Should users choose it, or should only admins configure it? |
| `allowedTools` | claude | Comes from worker env for executors; evaluators are read-only. | Should tool allowlists be advanced user controls? |
| `disallowedTools` | claude | Comes from worker env and read-only evaluator policy. | Should tool denylists be advanced user controls? |
| `additionalDirectories` | claude, codex | Derived from context paths. | Should users set extra directories directly, or only through context paths? |

## Open Questions

1. Should normal workflow authors be able to select `provider`, or should that
   remain an admin/runtime default?
2. For detached HEAD worktrees, should the worktree folder use the literal git
   branch value `HEAD`, a fixed label such as `detached`, or a short commit SHA?
3. Should network, web search, sandbox, and tool-list settings stay admin-only?
