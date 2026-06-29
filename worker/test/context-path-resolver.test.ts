import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveContextPath } from "../src/context/context-path-resolver.js";

describe("resolveContextPath", () => {
  let root: string;
  let workingDirectory: string;
  let externalDirectory: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "workflow-context-path-"));
    workingDirectory = path.join(root, "worktree");
    externalDirectory = path.join(root, "external-context");

    await mkdir(workingDirectory, { recursive: true });
    await mkdir(externalDirectory, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves an absolute file path outside the working directory", async () => {
    const externalFile = path.join(externalDirectory, "notes.md");
    await writeFile(externalFile, "external context", "utf8");

    await expect(
      resolveContextPath(workingDirectory, {
        path: externalFile,
        type: "file"
      })
    ).resolves.toEqual({
      path: externalFile,
      type: "file",
      status: "resolved",
      absolutePath: externalFile
    });
  });

  it("resolves a relative directory path outside the working directory", async () => {
    await expect(
      resolveContextPath(workingDirectory, {
        path: "../external-context",
        type: "directory"
      })
    ).resolves.toEqual({
      path: "../external-context",
      type: "directory",
      status: "resolved",
      absolutePath: externalDirectory
    });
  });

  it("resolves an input payload path relative to the worktree root", async () => {
    const requirementsDirectory = path.join(workingDirectory, "docs", "requirements");
    await mkdir(requirementsDirectory, { recursive: true });

    await expect(
      resolveContextPath(
        workingDirectory,
        {
          path: "${inputPayload.requirementsPath}",
          type: "directory"
        },
        {
          inputPayload: {
            requirementsPath: "docs/requirements"
          }
        }
      )
    ).resolves.toEqual({
      path: "docs/requirements",
      type: "directory",
      status: "resolved",
      absolutePath: requirementsDirectory
    });
  });

  it("resolves an absolute input payload path", async () => {
    const externalFile = path.join(externalDirectory, "requirements.md");
    await writeFile(externalFile, "requirements", "utf8");

    await expect(
      resolveContextPath(
        workingDirectory,
        {
          path: "${inputPayload.requirementsPath}",
          type: "file"
        },
        {
          inputPayload: {
            requirementsPath: externalFile
          }
        }
      )
    ).resolves.toEqual({
      path: externalFile,
      type: "file",
      status: "resolved",
      absolutePath: externalFile
    });
  });

  it("reports missing input payload paths as skipped", async () => {
    await expect(
      resolveContextPath(
        workingDirectory,
        {
          path: "${inputPayload.requirementsPath}",
          type: "directory"
        },
        {
          inputPayload: {}
        }
      )
    ).resolves.toMatchObject({
      path: "${inputPayload.requirementsPath}",
      type: "directory",
      status: "skipped",
      reason: "input_payload_path_missing"
    });
  });

  it("reports paths with the wrong declared type as skipped", async () => {
    const externalFile = path.join(externalDirectory, "notes.md");
    await writeFile(externalFile, "external context", "utf8");

    await expect(
      resolveContextPath(workingDirectory, {
        path: externalFile,
        type: "directory"
      })
    ).resolves.toMatchObject({
      path: externalFile,
      type: "directory",
      status: "skipped",
      reason: "path_type_mismatch"
    });
  });
});
