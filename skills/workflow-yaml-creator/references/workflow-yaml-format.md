# Workflow YAML Format Reference

Use this reference when drafting, editing, or validating `workflow.yaml` files shaped like `docs/examples/workflow.yaml`.

## Top-Level Structure

Use this key order:

```yaml
id: requirement-analysis-flow
name: Requirement Analysis Flow
version: 0.1.0
inputs: {}
artifacts: {}
steps: []
```

- `id`: Short lowercase hyphenated workflow id.
- `name`: Human-readable workflow name.
- `version`: Use `0.1.0` for new workflows unless specified.
- `inputs`: Use `{}` when no workflow-level inputs are declared.
- `artifacts`: Use `{}` when no workflow-level artifact registry is declared.
- `steps`: Ordered list of workflow steps.

## Step Shape

Use this structure for each step unless the existing workflow establishes a different local pattern:

```yaml
- id: step_id
  type: agent
  evaluate:
    evaluator: mixed
    rerun: false
  depends_on:
    - previous_step_id
  input_artifacts:
    - artifact: previous_output
  output_artifacts:
    - artifact: step_output
      filename: step-output.md
  context_paths: []
  tool_capabilities:
    - "*"
  prompt: |
    Do the requested work using the accepted input artifacts.
  acceptance:
    criteria:
      - The output is traceable to the input artifacts.
      - The next step has enough context to proceed.
```

## Step Fields

- `id`: Unique lowercase snake_case step id.
- `type`: Use `agent` for reasoning, writing, review, synthesis, and planning. Use `code_agent` for repository inspection, code edits, tests, and implementation work.
- `evaluate.evaluator`: Use `mixed` by default. Use `human_review` when evidence, judgment, or approval is important.
- `evaluate.rerun`: Boolean. Use `true` only when rejected artifacts should trigger a checkpointed rerun of the same step.
- `depends_on`: List of prerequisite step ids. Use `[]` when there are no prerequisites.
- `input_artifacts`: List of artifact objects produced by prior steps. Use `[]` when there are no input artifacts.
- `output_artifacts`: List of preserved outputs with `artifact` and `filename`.
- `context_paths`: Use `[]` for context-free steps. For codebase-aware steps, add worktree-relative paths.
- `tool_capabilities`: Use `["*"]` unless the user requests restricted tooling.
- `prompt`: Use a YAML block scalar. Say what to do, what inputs to use, and what output to produce.
- `acceptance.criteria`: Concrete checks that decide whether the step is acceptable.

Do not write new workflows with `upstream` or `downstream`. Those fields may appear in older files and are normalized by the runtime, but new workflow YAML should use `depends_on` only.

## Context Path Shape

Use worktree-relative paths:

```yaml
context_paths:
  - path: src
    type: directory
    optional: true
```

- `path`: Worktree-relative file or directory path.
- `type`: Usually `file` or `directory`.
- `optional`: Use `true` when the workflow can still run if the path is absent.

## Artifact Rules

- Use lowercase snake_case artifact ids.
- Use clear filenames such as `requirements.md`, `gap-summary.md`, or `test-plan.md`.
- Do not create artifacts for transient reasoning unless a dependent step or the user needs the output.
- Every `input_artifacts` reference must match an `artifact` produced by an earlier step.

## Dependency Rules

- Prefer a linear sequence unless the decomposition clearly has independent tracks.
- Use `depends_on` for all graph edges.
- Ensure every `depends_on` value matches an existing step id.
- Avoid cycles.
- For branching, put every prerequisite step id in the dependent step's `depends_on` list.

## Example

```yaml
id: requirement-analysis-flow
name: Requirement Analysis Flow
version: 0.1.0
inputs: {}
artifacts: {}
steps:
  - id: g1_intent_freeze
    type: agent
    evaluate:
      evaluator: mixed
    depends_on: []
    input_artifacts: []
    output_artifacts:
      - artifact: g1_requirements
        filename: requirements.md
    context_paths: []
    tool_capabilities:
      - "*"
    prompt: |
      Convert the original request into intent-layer requirements.
    acceptance:
      criteria:
        - No implementation-layer details.
        - Every requirement is traceable to the original request.

  - id: g2_backend_gap
    type: code_agent
    evaluate:
      evaluator: human_review
      rerun: true
    depends_on:
      - g1_intent_freeze
    input_artifacts:
      - artifact: g1_requirements
    output_artifacts:
      - artifact: g2_backend_gap_summary
        filename: backend-gap-summary.md
    context_paths:
      - path: worker/src
        type: directory
        optional: true
    tool_capabilities:
      - "*"
    prompt: |
      Inspect backend workflow runtime gaps using the accepted requirements.
    acceptance:
      criteria:
        - Every codebase claim must cite file and line evidence.
        - Each backend gap explains its impact.

  - id: g3_ui_gap
    type: code_agent
    evaluate:
      evaluator: human_review
      rerun: true
    depends_on:
      - g1_intent_freeze
    input_artifacts:
      - artifact: g1_requirements
    output_artifacts:
      - artifact: g3_ui_gap_summary
        filename: ui-gap-summary.md
    context_paths:
      - path: ui/src
        type: directory
        optional: true
    tool_capabilities:
      - "*"
    prompt: |
      Inspect workflow builder UI gaps using the accepted requirements.
    acceptance:
      criteria:
        - Every UI claim must cite file and line evidence.
        - Each UI gap explains its impact.

  - id: g4_synthesis
    type: agent
    evaluate:
      evaluator: mixed
    depends_on:
      - g2_backend_gap
      - g3_ui_gap
    input_artifacts:
      - artifact: g2_backend_gap_summary
      - artifact: g3_ui_gap_summary
    output_artifacts:
      - artifact: g4_plan
        filename: implementation-plan.md
    context_paths: []
    tool_capabilities:
      - "*"
    prompt: |
      Turn the accepted backend and UI gap analyses into an implementation-ready plan.
    acceptance:
      criteria:
        - The plan covers both branches.
        - Risks and test scenarios are explicit.
```

## Validation Checklist

- Parse the file as YAML.
- Ensure top-level keys are present and ordered consistently.
- Ensure step ids and artifact ids are unique.
- Ensure every referenced dependency and input artifact exists.
- Ensure each output artifact has both `artifact` and `filename`.
- Ensure each step has a non-empty prompt and at least one acceptance criterion.
