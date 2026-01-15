import { Plugin, WorkspaceLeaf, Notice, ItemView } from "obsidian";
import { ClaudeCodeSettings, DEFAULT_SETTINGS, CHAT_VIEW_TYPE } from "./types";
import { ChatView } from "./views/ChatView";
import { ClaudeCodeSettingTab } from "./settings/SettingsTab";
import { logger } from "./utils/Logger";

export default class ClaudeCodePlugin extends Plugin {
  settings: ClaudeCodeSettings = DEFAULT_SETTINGS;
  private readonly MAX_CHAT_WINDOWS = 5;

  async onload() {
    await this.loadSettings();

    // Initialize logger with vault path.
    const vaultPath = this.getVaultPath();
    logger.setLogPath(vaultPath);
    logger.info("Plugin", "Claude Code plugin loading", { vaultPath });

    // Register the chat view.
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // Add ribbon icon to toggle chat.
    this.addRibbonIcon("message-square", "Claude Code", () => {
      this.activateChatView();
    });

    // Add command to toggle chat sidebar.
    this.addCommand({
      id: "toggle-chat-sidebar",
      name: "Toggle Chat Sidebar",
      callback: () => {
        this.toggleChatView();
      },
    });

    // Add command to open chat sidebar.
    this.addCommand({
      id: "open-chat-sidebar",
      name: "Open Chat Sidebar",
      callback: () => {
        this.activateChatView();
      },
    });

    // Add command to start new conversation.
    this.addCommand({
      id: "new-conversation",
      name: "New Conversation",
      callback: () => {
        this.startNewConversation();
      },
    });

    // Add command to open new chat window.
    this.addCommand({
      id: "new-chat-window",
      name: "New Chat Window",
      callback: () => {
        this.createNewChatView("tab");
      },
    });

    // Add command to pin current note to Claude context.
    this.addCommand({
      id: "pin-current-note",
      name: "Pin Current Note to Claude Context",
      hotkeys: [{ modifiers: ["Ctrl", "Shift"], key: "p" }],
      callback: () => {
        const leaf = this.getExistingChatLeaf();
        if (leaf && leaf.view instanceof ChatView) {
          leaf.view.addCurrentFileContext();
          new Notice("Note pinned to Claude context");
        } else {
          new Notice("Open Claude chat first");
        }
      },
    });

    // Register settings tab.
    this.addSettingTab(new ClaudeCodeSettingTab(this.app, this));

    // Ensure .claude/CLAUDE.md exists with Obsidian tool instructions.
    await this.ensureClaudeMd();

    // Ensure chat view exists on layout ready.
    this.app.workspace.onLayoutReady(() => {
      const existingLeaf = this.getExistingChatLeaf();
      if (existingLeaf) {
        logger.debug("Plugin", "Chat view restored from workspace layout");
      } else {
        // No existing view - create one in the right sidebar.
        logger.debug("Plugin", "Creating chat view (none existed)");
        this.activateChatView();
      }
    });

    logger.info("Plugin", "Claude Code plugin loaded successfully");
  }

  onunload() {
    // Clean up chat views.
    this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
    logger.info("Plugin", "Claude Code plugin unloaded");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Ensure .claude/CLAUDE.md exists with Obsidian-specific tool instructions.
  private async ensureClaudeMd() {
    const claudeDir = ".claude";
    const claudeMdPath = `${claudeDir}/CLAUDE.md`;

    try {
      // Create .claude directory if it doesn't exist.
      if (!(await this.app.vault.adapter.exists(claudeDir))) {
        await this.app.vault.adapter.mkdir(claudeDir);
        logger.info("Plugin", "Created .claude directory");
      }

      // Create CLAUDE.md if it doesn't exist.
      if (!(await this.app.vault.adapter.exists(claudeMdPath))) {
        const content = this.getDefaultClaudeMdContent();
        await this.app.vault.adapter.write(claudeMdPath, content);
        logger.info("Plugin", "Created default .claude/CLAUDE.md");
      }
    } catch (error) {
      logger.warn("Plugin", "Failed to ensure CLAUDE.md", { error: String(error) });
    }
  }

  // Default content for CLAUDE.md with Obsidian-specific tool guidance.
  private getDefaultClaudeMdContent(): string {
    return `# Obsidian Vault Assistant

## Obsidian-Specific Tools

You have access to Obsidian-specific MCP tools. **ALWAYS prefer these tools over generic file operations**:

### RAG (Retrieval Augmented Generation)
- \`mcp__obsidian__semantic_search\` - Search vault content semantically. Use this for finding related notes.
- \`mcp__obsidian__get_related_notes\` - Find notes related to a given note.
- \`mcp__obsidian__get_rag_stats\` - Get RAG index status (number of indexed files, active provider).
- \`mcp__obsidian__rebuild_rag_index\` - Rebuild the RAG index if needed.

### Vault Operations
- \`mcp__obsidian__get_active_file\` - Get the currently open file.
- \`mcp__obsidian__open_file\` - Open a file in Obsidian.
- \`mcp__obsidian__create_note\` - Create a new note.
- \`mcp__obsidian__get_vault_stats\` - Get vault statistics.
- \`mcp__obsidian__get_recent_files\` - List recently modified files.
- \`mcp__obsidian__reveal_in_explorer\` - Show file in file explorer.

### UI Operations
- \`mcp__obsidian__show_notice\` - Show a notification to the user.
- \`mcp__obsidian__execute_command\` - Execute an Obsidian command.
- \`mcp__obsidian__list_commands\` - List available Obsidian commands.

### Content Insertion
- \`mcp__obsidian__insert_at_cursor\` - Insert text at cursor position in the active editor.
- \`mcp__obsidian__append_to_note\` - Append content to a specific note.

## Guidelines

1. **For "RAG status" questions**: Use \`mcp__obsidian__get_rag_stats\`, NOT file reads.
2. **For searching vault content**: Use \`mcp__obsidian__semantic_search\`, NOT Grep/Glob.
3. **For finding related notes**: Use \`mcp__obsidian__get_related_notes\`.
4. **For vault info**: Use \`mcp__obsidian__get_vault_stats\`, NOT manual counting.

## User Preferences

Add your custom instructions here...
`;
  }

  // Get existing chat leaf if any.
  getExistingChatLeaf(): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    return leaves.length > 0 ? leaves[0] : null;
  }

  // Activate or create the chat view in right sidebar.
  async activateChatView() {
    const existingLeaf = this.getExistingChatLeaf();

    if (existingLeaf) {
      // Reveal existing leaf.
      this.app.workspace.revealLeaf(existingLeaf);
      return;
    }

    // Create new leaf in right sidebar.
    await this.createNewChatView("tab");
  }

  // Create a new chat view window.
  async createNewChatView(mode: "tab" | "split-right" | "split-down" = "tab") {
    // Check window limit.
    const existingLeaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existingLeaves.length >= this.MAX_CHAT_WINDOWS) {
      new Notice(`Maximum ${this.MAX_CHAT_WINDOWS} chat windows allowed`);
      return;
    }

    let leaf: WorkspaceLeaf | null = null;

    switch (mode) {
      case "tab":
        leaf = this.app.workspace.getRightLeaf(false);
        break;
      case "split-right": {
        const activeLeaf = this.app.workspace.getActiveViewOfType(ItemView)?.leaf;
        if (activeLeaf) {
          leaf = this.app.workspace.createLeafBySplit(activeLeaf, "vertical");
        } else {
          leaf = this.app.workspace.getRightLeaf(false);
        }
        break;
      }
      case "split-down": {
        const currentLeaf = this.app.workspace.getActiveViewOfType(ItemView)?.leaf;
        if (currentLeaf) {
          leaf = this.app.workspace.createLeafBySplit(currentLeaf, "horizontal");
        } else {
          leaf = this.app.workspace.getRightLeaf(false);
        }
        break;
      }
    }

    if (leaf) {
      await leaf.setViewState({
        type: CHAT_VIEW_TYPE,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  // Toggle chat view visibility by collapsing/expanding the right sidebar.
  async toggleChatView() {
    const existingLeaf = this.getExistingChatLeaf();
    const rightSplit = this.app.workspace.rightSplit;

    if (existingLeaf && rightSplit) {
      if (rightSplit.collapsed) {
        // Sidebar is collapsed, expand it and reveal the chat.
        rightSplit.expand();
        this.app.workspace.revealLeaf(existingLeaf);
      } else {
        // Sidebar is visible, collapse it to hide.
        rightSplit.collapse();
      }
    } else if (!existingLeaf) {
      // No chat view exists, create one.
      await this.activateChatView();
    }
  }

  // Start a new conversation.
  async startNewConversation() {
    const leaf = this.getExistingChatLeaf();
    if (leaf && leaf.view instanceof ChatView) {
      leaf.view.startNewConversation();
    } else {
      // Open chat view first, then start new conversation.
      await this.activateChatView();
      // Small delay to ensure view is ready.
      setTimeout(() => {
        const newLeaf = this.getExistingChatLeaf();
        if (newLeaf && newLeaf.view instanceof ChatView) {
          newLeaf.view.startNewConversation();
        }
      }, 100);
    }
  }

  // Check if authentication is configured (API key or env vars).
  isApiKeyConfigured(): boolean {
    return !!(
      this.settings.apiKey ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN
    );
  }

  // Get the vault path.
  getVaultPath(): string {
    const adapter = this.app.vault.adapter as any;
    return adapter.basePath || "";
  }
}
