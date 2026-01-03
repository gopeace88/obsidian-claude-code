import { ItemView } from "obsidian";

// View type constant for registration.
export const CHAT_VIEW_TYPE = "claude-code-chat-view";

// Plugin settings interface.
export interface ClaudeCodeSettings {
  // API Configuration.
  apiKey: string;
  model: string;

  // Permissions.
  autoApproveVaultReads: boolean;
  autoApproveVaultWrites: boolean;
  requireBashApproval: boolean;

  // Persistent permission approvals (tools that are always allowed).
  alwaysAllowedTools: string[];

  // UI Preferences.
  sidebarWidth: number;

  // Limits.
  maxBudgetPerSession: number;

  // Agent SDK settings.
  maxTurns: number;
}

// Default settings values.
export const DEFAULT_SETTINGS: ClaudeCodeSettings = {
  apiKey: "",
  model: "sonnet",
  autoApproveVaultReads: true,
  autoApproveVaultWrites: true,  // Default to auto-approve for better UX.
  requireBashApproval: true,
  alwaysAllowedTools: [],
  sidebarWidth: 400,
  maxBudgetPerSession: 10.0,
  maxTurns: 50,
};

// Message roles for conversation.
export type MessageRole = "user" | "assistant";

// Chat message structure.
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

// Tool call information for display.
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: "pending" | "running" | "success" | "error";
  error?: string;
  startTime: number;
  endTime?: number;
}

// Conversation metadata (SDK handles actual state).
export interface Conversation {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  metadata: {
    totalTokens: number;
    totalCostUsd: number;
  };
}

// Context that can be attached to a message.
export interface MessageContext {
  type: "file" | "selection" | "search";
  path?: string;
  content: string;
  label: string;
}

// Events emitted by the agent controller.
export interface AgentEvents {
  onMessage: (message: ChatMessage) => void;
  onToolCall: (toolCall: ToolCall) => void;
  onToolResult: (toolCallId: string, result: string, isError: boolean) => void;
  onStreamingStart: () => void;
  onStreamingEnd: () => void;
  onError: (error: Error) => void;
}

// Permission request for tool approval.
export interface PermissionRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  description: string;
  risk: "low" | "medium" | "high";
}

// Slash command definition.
export interface SlashCommand {
  name: string;
  description: string;
  path: string;
  template: string;
}

// File suggestion for autocomplete.
export interface FileSuggestion {
  path: string;
  name: string;
  isFolder: boolean;
}
