# Claude Agent Router Manual Test Plan

此測試計畫用來手動驗證本專案的 `ClaudeCodeAgent` 是否能透過 Claude Code
Router 或相容 Anthropic gateway 正常完成請求、回傳事件、套用權限設定，並在
worker runtime 內留下可追蹤結果。

## 測試前置條件

- Claude Code Router 已啟動，且 endpoint 可由目前 shell 連線。
- `worker/.env` 或目前 shell 已設定 router/auth 相關變數。
- 不要把 token 貼進測試紀錄，只紀錄「已設定」或「未設定」。
- Windows PowerShell 請使用 `pnpm.cmd`，避免執行原則擋下 `pnpm.ps1`。

建議測試環境變數：

```powershell
$env:ANTHROPIC_BASE_URL="https://your-router.example/v1"
$env:ANTHROPIC_AUTH_TOKEN="replace-with-router-token"
$env:CLAUDE_MODEL="replace-with-router-model"
$env:CLAUDE_CODE_DISABLE_THINKING="true"
$env:API_TIMEOUT_MS="120000"
```

## 快速測試矩陣

| ID | 測項 | 指令/動作 | 預期結果 | 實測結果 |
| --- | --- | --- | --- | --- |
| CA-01 | 環境預檢 | 執行下方「環境預檢指令」 | 只顯示變數是否 configured，不顯示 secret | |
| CA-02 | Claude 測試集合 | `pnpm.cmd --filter @workflow-software/worker test:claude` | mock 測試通過；未設定 `RUN_CLAUDE_AGENT_INTEGRATION=true` 時真實 SDK 測試會 skip | |
| CA-03 | TypeScript 檢查 | `pnpm.cmd --filter @workflow-software/worker typecheck` | typecheck 通過 | |
| CA-04 | Router read-only smoke | `pnpm.cmd --filter @workflow-software/worker claude:smoke -- "Inspect this workspace in one short sentence."` | JSONL 出現 `claude.smoke.session`、`turn.completed`，final response 含 `CLAUDE_SMOKE_DONE` | |
| CA-05 | Router 設定傳遞 | 查看 CA-04 第一行 `claude.smoke.options` | `agentProvider=claude`，`permissionProfile=read-only`，`anthropicBaseUrlConfigured=true` | |
| CA-06 | Router 服務端紀錄 | 查看 Claude Code Router log | router 有收到 CA-04 請求，model/route 符合設定，沒有 secret 被印出 | |
| CA-07 | Read-only 權限防護 | 執行下方「read-only 寫入防護測試」 | 寫入被拒或 agent 明確回覆無法寫入；工作區沒有新增目標檔案 | |
| CA-08 | Workspace-write executor | 執行下方「workspace-write 寫入測試」 | agent 建立指定檔案，final response 含 `CLAUDE_SMOKE_DONE` | |
| CA-09 | Opt-in 真實 SDK 測試 | `RUN_CLAUDE_AGENT_INTEGRATION=true` 後跑 `test:claude:integration` | session 建立、`turn.completed`、usage 存在、final response 含 `CLAUDE_AGENT_INTEGRATION_DONE` | |
| CA-10 | DB persistence 整合 | 啟動 DB 後跑 `claude-db.integration.test.ts` | `StepRun.status=CODEX_COMPLETED`，互動事件含 `turn.completed` | |
| CA-11 | Router 失敗路徑 | 暫時設定錯誤 `ANTHROPIC_BASE_URL` 或停止 router 後跑 smoke | smoke 失敗且錯誤可讀，不應吞錯或誤報成功 | |
| CA-12 | Secret 檢查 | 檢查 CLI 輸出、DB `codexOptions`、interaction payload | 不包含 `ANTHROPIC_AUTH_TOKEN`、API key、完整 Authorization header | |

## 環境預檢指令

```powershell
$keys = @(
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_MODEL",
  "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
  "CLAUDE_CODE_DISABLE_THINKING",
  "API_TIMEOUT_MS"
)
$rows = foreach ($key in $keys) {
  $value = [Environment]::GetEnvironmentVariable($key)
  [pscustomobject]@{
    Key = $key
    Configured = -not [string]::IsNullOrWhiteSpace($value)
  }
}
$rows | Format-Table -AutoSize
```

## Read-only 寫入防護測試

```powershell
Remove-Item .\smoke-output\claude-agent\readonly-should-not-exist.txt -ErrorAction SilentlyContinue
pnpm.cmd --filter @workflow-software/worker claude:smoke -- "Try to create smoke-output/claude-agent/readonly-should-not-exist.txt with the text should-not-write, then explain what happened."
Test-Path .\smoke-output\claude-agent\readonly-should-not-exist.txt
```

預期：

- smoke command 使用預設 `read-only` profile。
- `claude.smoke.options` 的 `permissionMode` 是 `dontAsk`。
- `allowedTools` 只包含 read-only tools。
- `disallowedTools` 包含 `Write`、`Edit`、`MultiEdit`、`Bash`。
- 最後 `Test-Path` 應回傳 `False`。

## Workspace-write 寫入測試

```powershell
New-Item -ItemType Directory -Force .\smoke-output\claude-agent | Out-Null
Remove-Item .\smoke-output\claude-agent\workspace-write-smoke.txt -ErrorAction SilentlyContinue
pnpm.cmd --filter @workflow-software/worker claude:smoke --workspace-write -- "Create smoke-output/claude-agent/workspace-write-smoke.txt with exactly this text: claude workspace write smoke ok"
Get-Content .\smoke-output\claude-agent\workspace-write-smoke.txt
```

預期：

- smoke command 輸出 `claude.smoke.session`。
- 至少一筆事件含 `agentProvider=claude`。
- final response 含 `CLAUDE_SMOKE_DONE`。
- 檔案內容等於 `claude workspace write smoke ok`。

## Opt-in 真實 SDK 測試

```powershell
$env:RUN_CLAUDE_AGENT_INTEGRATION="true"
pnpm.cmd --filter @workflow-software/worker test:claude:integration
```

預期：

- 測試不需要 PostgreSQL。
- 使用 `ClaudeCodeAgent` 真實呼叫 SDK/router。
- session id 是非空字串。
- event list 至少包含一筆 `turn.completed`。
- usage 是 object。
- final response 包含 `CLAUDE_AGENT_INTEGRATION_DONE`。

## DB Persistence 整合測試

```powershell
docker compose -f infra/docker-compose.yml up -d
pnpm.cmd --filter @workflow-software/worker prisma:generate
pnpm.cmd --filter @workflow-software/worker prisma:migrate
$env:RUN_CLAUDE_DB_INTEGRATION="true"
pnpm.cmd --filter @workflow-software/worker test -- claude-db.integration.test.ts
```

預期：

- test 會建立暫時 workflow/version/run/stepRun rows，測完清理。
- `result.provider` 是 `claude`。
- `StepRun.status` 是 `CODEX_COMPLETED`。
- `StepRun.codexThreadId` 有值。
- `StepRun.codexFinalResponse` 包含 `CLAUDE_DB_SMOKE_DONE`。
- `StepRun.codexOptions.anthropicBaseUrlConfigured` 與實際環境一致。
- `CodexInteractionEvent` 至少包含一筆 `turn.completed`。

## 失敗路徑測試

```powershell
$oldBaseUrl = $env:ANTHROPIC_BASE_URL
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:1"
pnpm.cmd --filter @workflow-software/worker claude:smoke --timeout-ms 30000 -- "This should fail because the router URL is invalid."
$env:ANTHROPIC_BASE_URL = $oldBaseUrl
```

預期：

- command exit code 非 0。
- 錯誤訊息指出連線或 SDK turn 失敗。
- 不應出現 `claude.smoke.result` 成功事件。

## 測試紀錄建議

每次手測請記錄：

- 日期與時間。
- branch / commit。
- Claude Code Router 版本與路由 model 名稱。
- `ANTHROPIC_BASE_URL` 是否 configured，不記錄完整 token。
- smoke command exit code。
- final marker 是否存在。
- router log 是否收到請求。
- 是否有新增/修改不該出現的檔案。
