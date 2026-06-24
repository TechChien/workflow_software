import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export type RepositoryConfig = {
  repositoryId: string;
  repoPath: string;
  defaultBaseRef: string;
};

export const DEFAULT_REPOSITORY_ID = "default";

function defaultRepoPath() {
  return env.CODE_WORKSPACE_REPO_PATH
    ? path.resolve(workerRoot, env.CODE_WORKSPACE_REPO_PATH)
    : path.resolve(workerRoot, "..");
}

export const repositories: Record<string, RepositoryConfig> = {
  [DEFAULT_REPOSITORY_ID]: {
    repositoryId: DEFAULT_REPOSITORY_ID,
    repoPath: defaultRepoPath(),
    defaultBaseRef: "HEAD"
  }
};

export function defaultRepository() {
  const repository = repositories[DEFAULT_REPOSITORY_ID];

  if (!repository) {
    throw new Error(`Repository ${DEFAULT_REPOSITORY_ID} is not configured`);
  }

  return repository;
}

export function resolveRepository(repositoryId?: string) {
  const requestedRepositoryId = repositoryId?.trim();

  return requestedRepositoryId
    ? repositories[requestedRepositoryId] ?? defaultRepository()
    : defaultRepository();
}

export function defaultWorktreeRoot() {
  return path.resolve(workerRoot, env.CODE_WORKTREE_ROOT);
}
