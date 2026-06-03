# Project Folder Structure

The workspace is organized as a pnpm monorepo with two independent main projects.

```text
ui/      Next.js frontend. Calls worker REST APIs only.
worker/  Backend API, runtime worker, Prisma, Codex SDK, artifacts, worktrees.
shared/  Zod schemas, shared types, constants, and YAML helpers.
infra/   Local infrastructure and environment examples.
data/    Gitignored runtime artifacts, worktrees, and exports.
```

The UI does not import Prisma or access PostgreSQL directly. The worker owns runtime
state, persistence, Codex execution, and artifact writing.
