---
name: workflow-yaml-creator
description: Create workflow.yaml files for agent workflows from user task decompositions, requirements, step lists, or orchestration plans. Use when Codex needs to draft or edit with workflow metadata, step-local artifacts, agent/code_agent steps, depends_on dependencies, prompts, context paths, tool capabilities, and acceptance criteria.
---

# Workflow YAML Creator

## Overview

Turn a user's task decomposition into a `workflow.yaml` file. Keep the workflow as simple as the decomposition allows, and ask only when missing information would change the graph, artifacts, or verification criteria.

Read [references/workflow-yaml-format.md](references/workflow-yaml-format.md) before drafting or validating a workflow file.

## Creation Workflow

1. Confirm the source decomposition and target.
   - If the user already decomposed the task, use that as the source of truth.
   - If the user asks for a workflow but has not decomposed the task, help them decompose first.
   - If the output path is unspecified, default to `workflow.yaml` in the relevant workspace or requested folder.

2. Load the workflow YAML format reference.
   - Follow its key order, step shape, dependency rules, artifact rules, and validation checklist.
   - Treat the project example as the formatting source of truth when local patterns differ.

3. Convert each decomposition item into one step.
   - Use `agent` for reasoning, writing, review, synthesis, or planning work.
   - Use `code_agent` for repository inspection, code edits, test creation, test execution, or file-producing implementation work.
   - Prefer a linear sequence. Add branching only when the user's decomposition clearly has independent tracks.

4. Draft the workflow.
   - Keep prompts action-oriented and scoped to accepted input artifacts and context paths.
   - Give every step concrete acceptance criteria.
   - Keep artifacts narrow; only preserve outputs needed by dependent steps or the user.

5. Validate before returning or writing.
   - Parse the YAML.
   - Check references between steps and artifacts.
   - Fix structural issues before presenting the file.

When updating an existing workflow, keep edits surgical and preserve established local naming and formatting.
