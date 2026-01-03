# Interactive AskUserQuestion Modal

## Overview
Add an Obsidian modal that displays when Claude uses the AskUserQuestion tool, allowing users to interactively select answers instead of just seeing JSON.

## Status: Planned

## Challenge
The Claude Agent SDK auto-executes tools. The `canUseTool` callback only handles permissions, not tool logic. We cannot intercept the built-in `AskUserQuestion` tool.

## Solution
Create a custom MCP tool `mcp__obsidian__ask_user` in ObsidianMcpServer that:
1. Shows an Obsidian modal with questions and options
2. Waits for user selection
3. Returns the answer to the SDK

Claude will use this tool instead of the built-in AskUserQuestion when in the Obsidian plugin context.

## Files to Modify

```
src/agent/ObsidianMcpServer.ts     # Add ask_user tool
src/views/AskUserQuestionModal.ts  # NEW - Modal component (draft in this folder)
styles.css                          # Add modal styling
```

## How It Works

1. Claude calls `mcp__obsidian__ask_user` tool with questions
2. MCP server receives the call and shows `AskUserQuestionModal`
3. User clicks on option buttons to select answers
4. Modal returns answers as JSON to MCP tool
5. Tool returns result to SDK, Claude continues

## Draft Implementation

See `AskUserQuestionModal-draft.ts` in this folder for the modal component draft.

### MCP Tool Addition (ObsidianMcpServer.ts)

```typescript
tool(
  "ask_user",
  "Show a modal dialog to ask the user questions with multiple choice options. Use this when you need user input or preferences.",
  {
    questions: z.array(z.object({
      question: z.string().describe("The question to ask"),
      header: z.string().describe("Short label for the question (max 12 chars)"),
      options: z.array(z.object({
        label: z.string().describe("Option label"),
        description: z.string().describe("Option description"),
      })).describe("2-4 options to choose from"),
      multiSelect: z.boolean().describe("Whether multiple options can be selected"),
    })).describe("1-4 questions to ask the user"),
  },
  async (args) => {
    const answers = await showAskUserQuestionModal(app, args.questions);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ answers }, null, 2),
      }],
    };
  }
)
```

### CSS Additions (styles.css)

```css
/* AskUserQuestion Modal */
.claude-code-ask-modal {
  max-width: 500px;
}

.claude-code-question {
  margin-bottom: 20px;
  padding: 12px;
  background: var(--background-secondary);
  border-radius: 8px;
}

.claude-code-question-header {
  display: inline-block;
  padding: 2px 8px;
  background: var(--interactive-accent);
  color: var(--text-on-accent);
  border-radius: 4px;
  font-size: 11px;
  margin-bottom: 8px;
}

.claude-code-question-text {
  margin: 8px 0;
  font-weight: 500;
}

.claude-code-question-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.claude-code-option-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 10px 12px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}

.claude-code-option-btn:hover {
  border-color: var(--interactive-accent);
}

.claude-code-option-btn.selected {
  border-color: var(--interactive-accent);
  background: var(--interactive-accent-hover);
}

.claude-code-option-desc {
  color: var(--text-muted);
  font-size: 12px;
  margin-top: 4px;
}

.claude-code-other-container {
  margin-top: 8px;
}

.claude-code-other-input {
  width: 100%;
  margin-top: 8px;
  padding: 8px;
}

.claude-code-ask-buttons {
  margin-top: 16px;
  text-align: right;
}
```

## Complexity

- AskUserQuestionModal.ts: ~150 lines
- ObsidianMcpServer.ts: ~30 lines addition
- CSS: ~60 lines

Total: ~240 lines
