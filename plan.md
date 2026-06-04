# Workflow Builder MVP 架構計畫（修正版）

## Summary

- 修正語意：`one input / one output` 指 **node connection cardinality**，不是 artifact 數量。
- MVP workflow 是 linear chain：
  - 每個 node 最多一個 upstream node。
  - 每個 node 最多一個 downstream node。
  - 每個 step 可讀取多個 artifact inputs。
  - 每個 step 可產生多個 named artifacts。
- User-defined paths 是 optional external context，不是 artifact input；沒權限或不存在就略過並記錄事件。
- Runtime 使用 TypeScript worker + `@openai/codex-sdk`，並支援 Codex permission/user-question pause。
- Source code 修改在 dedicated git worktree 中執行，code changes 是 side effect，summary/diff 可作為 artifacts 記錄。

## Key Architecture

- Tech stack:
  - Next.js + TypeScript。
  - React Flow / xyflow。
  - PostgreSQL + Prisma。
  - Zod for YAML/runtime schema validation。
  - Local filesystem for artifact content。
  - Postgres polling for worker dispatch。
  - Codex SDK: `@openai/codex-sdk`, server-side worker, Node.js 18+。[Codex SDK](https://developers.openai.com/codex/sdk)
- Graph rules:
  - `incoming_node_id` 最多一個。
  - `outgoing_node_id` 最多一個。
  - Artifact input/output 不受 one edge 限制。
- Artifact rules:
  - Artifact immutable，不覆蓋。
  - Rerun step 一律產生新 artifact versions。
  - 只有 accepted artifact versions 可餵給下游。
  - Step run 必須記錄實際使用的每個 artifact version id。
  - 上游 accepted 新版本後，若下游曾使用舊版 artifact，標記 stale。
  - Context path changes 不自動觸發 stale in MVP。

## Step Definition

```yaml
steps:
  - id: g2_gap_analysis
    type: code_agent
    upstream: g1_intent_freeze
    downstream: g3_decision_split

    input_artifacts:
      - artifact: g1_requirements
      - artifact: original_request_snapshot

    context_paths:
      - path: src
        type: directory
        optional: true
      - path: docs/domain-rules.md
        type: file
        optional: true

    output_artifacts:
      - artifact: g2_gap_summary
        filename: g2-gap-summary.md
      - artifact: g2_evidence_index
        filename: g2-evidence-index.md

    tool_capabilities:
      - "*"

    prompt: |
      Use the accepted artifact inputs and optional context paths.
      Produce the requested output artifacts.

    acceptance:
      criteria:
        - Every codebase claim must cite file and line evidence.
        - Each identified gap explains its impact.
```

- `upstream/downstream` express node connection only。
- `input_artifacts` is an array。
- `output_artifacts` is an array。
- `context_paths` are optional worktree-relative references。
- Context paths are not versioned artifacts in MVP。

## Runtime Model

- Step types:
  - `agent`: Codex produces one or more text artifacts。
  - `code_agent`: Codex may modify source code in dedicated worktree and produces artifacts。
  - `human_review`: explicit pause gate; produces decision event。
- Codex pause states:
  - `waiting_for_codex_permission`
  - `waiting_for_codex_question`
  - `waiting_for_human_review`
  - `waiting_for_evaluator_feedback`
- Context path behavior:
  - Paths are worktree-relative only。
  - Files and directories are supported。
  - If worker cannot resolve/stat a path, skip and log。
  - If Codex requests permission for optional context access, auto-skip and resume same Codex thread。
- Artifact persistence:
  - Codex does not write artifact store directly。
  - Worker stores Codex final output under managed artifact root。
  - User configures artifact key/display filename, not arbitrary absolute artifact folder。

## Data Model Changes

- Replace single input/output artifact fields with join-style records:
  - `step_run_artifact_inputs`: `step_run_id`, `artifact_key`, `artifact_version_id`。
  - `artifact_versions`: one row per produced artifact version。
- Core tables:
  - `workflows`
  - `workflow_versions`
  - `workflow_runs`
  - `steps`
  - `step_runs`
  - `step_run_artifact_inputs`
  - `artifact_versions`
  - `decision_events`
  - `context_path_events`
  - `codex_threads`
  - `codex_interaction_events`
  - `code_workspaces`
  - `code_change_records`
  - `tool_invocations`
  - `run_events`
- `step_runs` stores:
  - `upstream_step_run_id`
  - `downstream_step_run_id`
  - `codex_thread_id`
  - `status`
  - `attempt`
  - `stale_reason`

## Test Plan

- YAML with one upstream/downstream per node passes validation。
- YAML with multiple incoming node edges fails validation。
- Step with multiple `input_artifacts` passes validation。
- Step with multiple `output_artifacts` creates multiple artifact versions。
- Step run records every consumed artifact version id。
- Missing/inaccessible context path is skipped and logged。
- Codex permission request for optional context path is auto-skipped and resumed。
- Rerun creates new artifact versions without overwriting old ones。
- Downstream step becomes stale only when it consumed an older accepted artifact version。
- Code step runs in dedicated git worktree and records diff/commit metadata。
- Human reject/comment resets code step to `before_commit` and reruns with feedback。

## Assumptions

- MVP is single workspace, no login/RBAC。
- Workflow graph is linear by node connection。
- Artifact inputs/outputs can be multiple per step。
- User-defined paths are optional external context, not formal artifacts。
- Context paths are worktree-relative files/directories only。
- Formal artifact content is text-first。
- Code-modifying steps require human review before commit。
