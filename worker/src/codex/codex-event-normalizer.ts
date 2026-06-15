import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";
import type { RecordedCodexEvent } from "./codex-run-recorder.js";

type UnsequencedCodexEvent = Omit<RecordedCodexEvent, "attempt" | "sequence">;

function completedItemStatus(item: ThreadItem): "completed" | "failed" {
  switch (item.type) {
    case "command_execution":
    case "file_change":
    case "mcp_tool_call":
      return item.status === "failed" ? "failed" : "completed";
    case "error":
      return "failed";
    default:
      return "completed";
  }
}

function sanitizeCompletedItem(item: ThreadItem): Record<string, unknown> {
  switch (item.type) {
    case "agent_message":
      return { itemType: item.type, text: item.text };
    case "reasoning":
      return { itemType: item.type, text: item.text };
    case "command_execution":
      return {
        itemType: item.type,
        command: item.command,
        status: item.status,
        ...(item.exit_code === undefined ? {} : { exitCode: item.exit_code })
      };
    case "file_change":
      return {
        itemType: item.type,
        changes: item.changes,
        status: item.status
      };
    case "mcp_tool_call":
      return {
        itemType: item.type,
        server: item.server,
        tool: item.tool,
        status: item.status,
        ...(item.error ? { errorMessage: item.error.message } : {})
      };
    case "web_search":
      return { itemType: item.type, query: item.query };
    case "todo_list":
      return { itemType: item.type, items: item.items };
    case "error":
      return { itemType: item.type, message: item.message };
  }
}

export function normalizeCodexEvent(event: ThreadEvent): UnsequencedCodexEvent | undefined {
  switch (event.type) {
    case "item.completed":
      return {
        externalItemId: event.item.id,
        kind: "item.completed",
        status: completedItemStatus(event.item),
        payload: sanitizeCompletedItem(event.item)
      };
    case "turn.completed":
      return {
        kind: "turn.completed",
        status: "completed",
        payload: { usage: event.usage }
      };
    case "turn.failed":
      return {
        kind: "turn.failed",
        status: "failed",
        payload: { message: event.error.message }
      };
    case "error":
      return {
        kind: "error",
        status: "failed",
        payload: { message: event.message }
      };
    default:
      return undefined;
  }
}
