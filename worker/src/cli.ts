import { cliUsage, parseCliArgs } from "./cli-options.js";
import { runWorkflowFile } from "./runtime/workflow-cli-service.js";

try {
  const options = parseCliArgs(process.argv.slice(2));

  if (options.help) {
    console.log(cliUsage);
  } else {
    const result = await runWorkflowFile({
      workflowPath: options.workflowPath,
      inputPayload: options.inputPayload
    });

    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
