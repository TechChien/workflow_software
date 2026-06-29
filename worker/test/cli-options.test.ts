import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/cli-options.js";

describe("parseCliArgs", () => {
  it("fails when workflow path is missing", () => {
    expect(() => parseCliArgs([])).toThrow("Missing required workflow.yaml path");
  });

  it("fails on unknown options", () => {
    expect(() => parseCliArgs(["workflow.yaml", "--verbose"])).toThrow(
      "Unknown option: --verbose"
    );
  });

  it("fails on malformed input JSON", () => {
    expect(() => parseCliArgs(["workflow.yaml", "--input", "{"])).toThrow(
      "--input must be valid JSON"
    );
  });

  it("fails when repo path is missing", () => {
    expect(() => parseCliArgs(["workflow.yaml", "--repo-path"])).toThrow(
      "--repo-path requires a path argument"
    );
  });

  it("defaults input payload to an empty object", () => {
    expect(parseCliArgs(["workflow.yaml"])).toEqual({
      help: false,
      workflowPath: "workflow.yaml",
      inputPayload: {}
    });
  });

  it("parses input payload JSON objects", () => {
    expect(parseCliArgs(["workflow.yaml", "--input", "{\"issue\":\"123\"}"])).toEqual({
      help: false,
      workflowPath: "workflow.yaml",
      inputPayload: {
        issue: "123"
      }
    });
  });

  it.each(["--input-payload", "--inputPayload"])(
    "parses input payload JSON objects from %s",
    (option) => {
      expect(
        parseCliArgs([
          "workflow.yaml",
          option,
          "{\"requirementsPath\":\"docs/requirements\"}"
        ])
      ).toEqual({
        help: false,
        workflowPath: "workflow.yaml",
        inputPayload: {
          requirementsPath: "docs/requirements"
        }
      });
    }
  );

  it("parses repo path", () => {
    expect(parseCliArgs(["workflow.yaml", "--repo-path", "C:\\repo"])).toEqual({
      help: false,
      workflowPath: "workflow.yaml",
      inputPayload: {},
      repoPath: "C:\\repo"
    });
  });
});
