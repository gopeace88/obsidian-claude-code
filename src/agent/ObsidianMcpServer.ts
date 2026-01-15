import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { App, Notice, TFile, TFolder, Command, MarkdownView } from "obsidian";
import { execFile } from "child_process";
import { promisify } from "util";
import { HybridRAGService } from "../rag";

const execFileAsync = promisify(execFile);

// Type for the MCP server instance.
export type ObsidianMcpServerInstance = ReturnType<typeof createSdkMcpServer>;

// Create the Obsidian MCP server with custom tools.
export function createObsidianMcpServer(
  app: App,
  vaultPath: string,
  ragService?: HybridRAGService
): ObsidianMcpServerInstance {
  return createSdkMcpServer({
    name: "obsidian",
    version: "1.0.0",
    tools: [
      // Open a file in Obsidian's editor view.
      tool(
        "open_file",
        "Open a file in Obsidian's editor view. Use this to show the user a specific note or file.",
        {
          path: z.string().describe("Path to the file relative to vault root"),
          newLeaf: z
            .boolean()
            .optional()
            .describe("Open in a new tab (default: false)"),
          line: z
            .number()
            .optional()
            .describe("Line number to scroll to (optional)"),
        },
        async (args) => {
          const file = app.vault.getAbstractFileByPath(args.path);
          if (file instanceof TFile) {
            const leaf = app.workspace.getLeaf(args.newLeaf ?? false);
            await leaf.openFile(file);

            // Scroll to specific line if provided.
            if (args.line !== undefined) {
              const view = leaf.view;
              if ("editor" in view && view.editor) {
                (view.editor as any).scrollToLine(args.line - 1);
              }
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Opened ${args.path}${
                    args.line ? ` at line ${args.line}` : ""
                  }`,
                },
              ],
            };
          }
          return {
            content: [
              { type: "text" as const, text: `File not found: ${args.path}` },
            ],
          };
        }
      ),

      // Execute an Obsidian command by ID.
      tool(
        "execute_command",
        "Execute an Obsidian command by its ID. Use list_commands to discover available commands. Examples: 'editor:toggle-fold', 'app:open-settings', 'daily-notes:goto-today'.",
        {
          commandId: z.string().describe("The command ID to execute"),
        },
        async (args) => {
          const command = (app as any).commands.findCommand(
            args.commandId
          ) as Command | null;
          if (command) {
            (app as any).commands.executeCommandById(args.commandId);
            return {
              content: [
                { type: "text" as const, text: `Executed: ${command.name}` },
              ],
            };
          }
          return {
            content: [
              {
                type: "text" as const,
                text: `Command not found: ${args.commandId}. Use list_commands to see available commands.`,
              },
            ],
          };
        }
      ),

      // Show a notice/notification to the user.
      tool(
        "show_notice",
        "Display a notification to the user in Obsidian. Use for confirmations, alerts, or status updates.",
        {
          message: z.string().describe("Message to display to the user"),
          duration: z
            .number()
            .optional()
            .describe("Duration in milliseconds (default: 5000)"),
        },
        async (args) => {
          new Notice(args.message, args.duration ?? 5000);
          return {
            content: [{ type: "text" as const, text: "Notice displayed" }],
          };
        }
      ),

      // Get information about the currently active file.
      tool(
        "get_active_file",
        "Get information about the currently active/open file in Obsidian. Returns path, name, stats, and a preview of content.",
        {},
        async () => {
          const file = app.workspace.getActiveFile();
          if (file) {
            const stat = file.stat;
            const content = await app.vault.read(file);
            const preview =
              content.slice(0, 500) + (content.length > 500 ? "..." : "");

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      path: file.path,
                      name: file.name,
                      basename: file.basename,
                      extension: file.extension,
                      size: stat.size,
                      created: new Date(stat.ctime).toISOString(),
                      modified: new Date(stat.mtime).toISOString(),
                      preview: preview,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
          return {
            content: [
              { type: "text" as const, text: "No file is currently active" },
            ],
          };
        }
      ),

      // Rebuild the vault search index.
      tool(
        "rebuild_vault_index",
        "Rebuild the semantic search index for the vault. Use when search seems stale or after bulk changes to notes.",
        {
          force: z
            .boolean()
            .optional()
            .describe("Force full rebuild (default: false, incremental)"),
          stats: z
            .boolean()
            .optional()
            .describe("Only show index statistics without rebuilding"),
        },
        async (args) => {
          const pythonPath = `${vaultPath}/.claude/venv/bin/python`;
          const scriptPath = `${vaultPath}/.claude/skills/vault-search/scripts/index.py`;

          const scriptArgs = ["--vault-path", vaultPath];
          if (args.force) scriptArgs.push("--rebuild");
          if (args.stats) scriptArgs.push("--stats");

          try {
            const { stdout, stderr } = await execFileAsync(pythonPath, [
              scriptPath,
              ...scriptArgs,
            ]);
            return {
              content: [{ type: "text" as const, text: stdout || stderr }],
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: ${error.stderr || error.message}`,
                },
              ],
            };
          }
        }
      ),

      // List available Obsidian commands.
      tool(
        "list_commands",
        "List available Obsidian commands. Use this to discover command IDs for execute_command.",
        {
          filter: z
            .string()
            .optional()
            .describe("Filter commands by name (case-insensitive)"),
          limit: z
            .number()
            .optional()
            .describe("Maximum number of commands to return (default: 50)"),
        },
        async (args) => {
          const commands = Object.values(
            (app as any).commands.commands
          ) as Command[];
          let filtered = commands;

          if (args.filter) {
            const f = args.filter.toLowerCase();
            filtered = commands.filter(
              (c: Command) =>
                c.name.toLowerCase().includes(f) || c.id.toLowerCase().includes(f)
            );
          }

          const limit = args.limit ?? 50;
          const list = filtered
            .slice(0, limit)
            .map((c: Command) => `${c.id}: ${c.name}`)
            .join("\n");

          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${filtered.length} commands${
                  filtered.length > limit
                    ? ` (showing first ${limit})`
                    : ""
                }:\n\n${list}`,
              },
            ],
          };
        }
      ),

      // Create a new note with optional template.
      tool(
        "create_note",
        "Create a new note in the vault. Optionally apply a template or specify initial content.",
        {
          path: z
            .string()
            .describe(
              "Path for the new note (e.g., 'folder/note.md'). Creates parent folders if needed."
            ),
          content: z
            .string()
            .optional()
            .describe("Initial content for the note"),
          openAfterCreate: z
            .boolean()
            .optional()
            .describe("Open the note after creating (default: true)"),
        },
        async (args) => {
          // Check if file already exists.
          const existing = app.vault.getAbstractFileByPath(args.path);
          if (existing) {
            return {
              content: [
                { type: "text" as const, text: `File already exists: ${args.path}` },
              ],
            };
          }

          // Create parent folders if needed.
          const folderPath = args.path.substring(
            0,
            args.path.lastIndexOf("/")
          );
          if (folderPath) {
            const folder = app.vault.getAbstractFileByPath(folderPath);
            if (!folder) {
              await app.vault.createFolder(folderPath);
            }
          }

          // Create the file.
          const file = await app.vault.create(args.path, args.content || "");

          // Open if requested.
          if (args.openAfterCreate !== false) {
            const leaf = app.workspace.getLeaf(false);
            await leaf.openFile(file);
          }

          return {
            content: [
              { type: "text" as const, text: `Created note: ${args.path}` },
            ],
          };
        }
      ),

      // Navigate to a folder in the file explorer.
      tool(
        "reveal_in_explorer",
        "Reveal a file or folder in Obsidian's file explorer pane.",
        {
          path: z.string().describe("Path to reveal in the file explorer"),
        },
        async (args) => {
          const file = app.vault.getAbstractFileByPath(args.path);
          if (!file) {
            return {
              content: [
                { type: "text" as const, text: `Path not found: ${args.path}` },
              ],
            };
          }

          // Reveal in file explorer.
          const fileExplorer = app.workspace.getLeavesOfType("file-explorer")[0];
          if (fileExplorer) {
            (fileExplorer.view as any).revealInFolder(file);
            return {
              content: [
                { type: "text" as const, text: `Revealed in explorer: ${args.path}` },
              ],
            };
          }

          return {
            content: [
              { type: "text" as const, text: "File explorer not found" },
            ],
          };
        }
      ),

      // Get vault statistics.
      tool(
        "get_vault_stats",
        "Get statistics about the vault: total files, folders, note count, etc.",
        {},
        async () => {
          const files = app.vault.getFiles();
          const markdownFiles = app.vault.getMarkdownFiles();
          const folders = new Set<string>();

          for (const file of files) {
            const parts = file.path.split("/");
            for (let i = 1; i < parts.length; i++) {
              folders.add(parts.slice(0, i).join("/"));
            }
          }

          const stats = {
            totalFiles: files.length,
            markdownNotes: markdownFiles.length,
            otherFiles: files.length - markdownFiles.length,
            totalFolders: folders.size,
            vaultPath: vaultPath,
          };

          return {
            content: [
              { type: "text" as const, text: JSON.stringify(stats, null, 2) },
            ],
          };
        }
      ),

      // Insert text at cursor position in the active editor.
      tool(
        "insert_at_cursor",
        "Insert text at the current cursor position in the active editor. Use this to directly insert Mermaid diagrams, tables, or any content into the user's note.",
        {
          text: z.string().describe("Text to insert at cursor position"),
        },
        async (args) => {
          const activeView = app.workspace.getActiveViewOfType(MarkdownView);
          if (!activeView) {
            return {
              content: [
                { type: "text" as const, text: "No active markdown editor" },
              ],
            };
          }

          const editor = activeView.editor;
          const cursor = editor.getCursor();
          editor.replaceRange(args.text, cursor);

          // Move cursor to end of inserted text.
          const lines = args.text.split("\n");
          const lastLineLength = lines[lines.length - 1].length;
          const newLine = cursor.line + lines.length - 1;
          const newCh = lines.length === 1 ? cursor.ch + lastLineLength : lastLineLength;
          editor.setCursor({ line: newLine, ch: newCh });

          return {
            content: [
              {
                type: "text" as const,
                text: `Inserted ${args.text.length} characters at line ${cursor.line + 1}`,
              },
            ],
          };
        }
      ),

      // Append content to an existing note.
      tool(
        "append_to_note",
        "Append content to the end of an existing note. Use this to add Mermaid diagrams, tables, or sections to a note without opening it.",
        {
          path: z.string().describe("Path to the note (relative to vault root)"),
          content: z.string().describe("Content to append"),
          separator: z
            .string()
            .optional()
            .describe("Separator before content (default: two newlines)"),
        },
        async (args) => {
          const file = app.vault.getAbstractFileByPath(args.path);
          if (!(file instanceof TFile)) {
            return {
              content: [
                { type: "text" as const, text: `File not found: ${args.path}` },
              ],
            };
          }

          const currentContent = await app.vault.read(file);
          const separator = args.separator ?? "\n\n";
          const newContent = currentContent + separator + args.content;
          await app.vault.modify(file, newContent);

          return {
            content: [
              {
                type: "text" as const,
                text: `Appended ${args.content.length} characters to ${args.path}`,
              },
            ],
          };
        }
      ),

      // Get recently modified files.
      tool(
        "get_recent_files",
        "Get a list of recently modified files in the vault.",
        {
          limit: z
            .number()
            .optional()
            .describe("Maximum number of files to return (default: 10)"),
          folder: z
            .string()
            .optional()
            .describe("Filter to files in this folder"),
        },
        async (args) => {
          let files = app.vault.getMarkdownFiles();

          // Filter by folder if specified.
          if (args.folder) {
            files = files.filter((f) => f.path.startsWith(args.folder!));
          }

          // Sort by modification time.
          files.sort((a, b) => b.stat.mtime - a.stat.mtime);

          const limit = args.limit ?? 10;
          const recent = files.slice(0, limit).map((f) => ({
            path: f.path,
            name: f.name,
            modified: new Date(f.stat.mtime).toISOString(),
          }));

          return {
            content: [
              { type: "text" as const, text: JSON.stringify(recent, null, 2) },
            ],
          };
        }
      ),

      // RAG: Semantic search across vault.
      tool(
        "semantic_search",
        "Search vault using semantic similarity (RAG). Returns relevant note chunks based on meaning, not just keywords. Uses Smart Connections, Omnisearch, or internal embeddings.",
        {
          query: z.string().describe("Search query - describe what you're looking for"),
          topK: z
            .number()
            .optional()
            .describe("Number of results to return (default: 5)"),
          folder: z
            .string()
            .optional()
            .describe("Limit search to this folder"),
        },
        async (args) => {
          if (!ragService || !ragService.isEnabled()) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "RAG is not enabled. Enable it in plugin settings.",
                },
              ],
            };
          }

          const results = await ragService.search(args.query, {
            topK: args.topK ?? 5,
            folder: args.folder,
          });

          if (results.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No results found for: "${args.query}"`,
                },
              ],
            };
          }

          const formatted = results.map((r, i) => ({
            rank: i + 1,
            file: r.file,
            score: r.score.toFixed(3),
            headings: r.metadata?.headings ?? [],
            content: r.content.slice(0, 300) + (r.content.length > 300 ? "..." : ""),
          }));

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(formatted, null, 2),
              },
            ],
          };
        }
      ),

      // RAG: Find related notes.
      tool(
        "get_related_notes",
        "Find notes semantically related to the current file or given content. Uses RAG to find conceptually similar notes.",
        {
          path: z
            .string()
            .optional()
            .describe("Note path to find related notes for (default: active file)"),
          topK: z
            .number()
            .optional()
            .describe("Number of related notes to return (default: 5)"),
        },
        async (args) => {
          if (!ragService || !ragService.isEnabled()) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "RAG is not enabled. Enable it in plugin settings.",
                },
              ],
            };
          }

          // Get target file.
          const targetPath = args.path;
          const file = targetPath
            ? app.vault.getAbstractFileByPath(targetPath)
            : app.workspace.getActiveFile();

          if (!file || !(file instanceof TFile)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: targetPath
                    ? `File not found: ${targetPath}`
                    : "No active file",
                },
              ],
            };
          }

          // Read content and find related.
          const content = await app.vault.read(file);
          const results = await ragService.findRelated(content, args.topK ?? 5);

          // Filter out the source file itself.
          const filtered = results.filter((r) => r.file !== file.path);

          if (filtered.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No related notes found for: ${file.path}`,
                },
              ],
            };
          }

          const formatted = filtered.map((r, i) => ({
            rank: i + 1,
            file: r.file,
            score: r.score.toFixed(3),
            preview: r.content.slice(0, 200) + "...",
          }));

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(formatted, null, 2),
              },
            ],
          };
        }
      ),

      // RAG: Rebuild index.
      tool(
        "rebuild_rag_index",
        "Rebuild the RAG semantic index for the vault. Use this after bulk changes or when search seems stale.",
        {
          force: z
            .boolean()
            .optional()
            .describe("Force full rebuild, ignoring incremental updates (default: false)"),
        },
        async (args) => {
          if (!ragService) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "RAG service not available.",
                },
              ],
            };
          }

          try {
            const stats = await ragService.reindex(args.force ?? false);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `RAG index rebuilt: ${stats.files} files, ${stats.chunks} chunks indexed.`,
                },
              ],
            };
          } catch (error: any) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to rebuild index: ${error.message}`,
                },
              ],
            };
          }
        }
      ),

      // RAG: Get index stats.
      tool(
        "get_rag_stats",
        "Get statistics about the RAG index: number of indexed files, chunks, and active provider.",
        {},
        async () => {
          if (!ragService) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "RAG service not available.",
                },
              ],
            };
          }

          const stats = await ragService.getStats();
          const provider = ragService.getActiveProviderName();

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    enabled: ragService.isEnabled(),
                    activeProvider: provider,
                    indexedFiles: stats.files,
                    totalChunks: stats.chunks,
                    lastUpdated: stats.lastUpdated
                      ? new Date(stats.lastUpdated).toISOString()
                      : "never",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      ),

      // ===== MERMAID DIAGRAM TOOLS =====

      // Generate Mermaid diagram from description.
      tool(
        "generate_mermaid",
        "Generate a Mermaid diagram code block from a description. Returns the Mermaid markdown that can be inserted into a note. Obsidian renders Mermaid diagrams natively.",
        {
          type: z
            .enum(["flowchart", "sequence", "classDiagram", "stateDiagram", "erDiagram", "gantt", "pie", "mindmap", "timeline"])
            .describe("Type of diagram to generate"),
          description: z
            .string()
            .describe("Description of what the diagram should show"),
          direction: z
            .enum(["TB", "BT", "LR", "RL"])
            .optional()
            .describe("Direction for flowcharts (TB=top-bottom, LR=left-right, etc.)"),
        },
        async (args) => {
          // Return a template based on diagram type.
          const templates: Record<string, string> = {
            flowchart: `\`\`\`mermaid
flowchart ${args.direction || "TB"}
    %% ${args.description}
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
\`\`\``,
            sequence: `\`\`\`mermaid
sequenceDiagram
    %% ${args.description}
    participant A as Actor 1
    participant B as Actor 2
    A->>B: Request
    B-->>A: Response
\`\`\``,
            classDiagram: `\`\`\`mermaid
classDiagram
    %% ${args.description}
    class ClassName {
        +attribute: type
        +method(): returnType
    }
\`\`\``,
            stateDiagram: `\`\`\`mermaid
stateDiagram-v2
    %% ${args.description}
    [*] --> State1
    State1 --> State2: Event
    State2 --> [*]
\`\`\``,
            erDiagram: `\`\`\`mermaid
erDiagram
    %% ${args.description}
    ENTITY1 ||--o{ ENTITY2 : relationship
    ENTITY1 {
        string id PK
        string name
    }
\`\`\``,
            gantt: `\`\`\`mermaid
gantt
    title ${args.description}
    dateFormat YYYY-MM-DD
    section Section
    Task 1: a1, 2024-01-01, 7d
    Task 2: after a1, 5d
\`\`\``,
            pie: `\`\`\`mermaid
pie showData
    title ${args.description}
    "Category A": 40
    "Category B": 35
    "Category C": 25
\`\`\``,
            mindmap: `\`\`\`mermaid
mindmap
    root((${args.description}))
        Branch 1
            Sub-topic 1
            Sub-topic 2
        Branch 2
            Sub-topic 3
\`\`\``,
            timeline: `\`\`\`mermaid
timeline
    title ${args.description}
    2024-01-01: Event 1
    2024-02-01: Event 2
    2024-03-01: Event 3
\`\`\``,
          };

          const diagram = templates[args.type] || templates.flowchart;

          return {
            content: [
              {
                type: "text" as const,
                text: `Generated ${args.type} diagram template:\n\n${diagram}\n\nModify the diagram content as needed, then use insert_at_cursor or append_to_note to add it to a note.`,
              },
            ],
          };
        }
      ),

      // Analyze note structure for diagram generation.
      tool(
        "analyze_for_diagram",
        "Analyze a note's content to suggest what kind of Mermaid diagram would be appropriate and extract structure for diagram generation.",
        {
          path: z
            .string()
            .optional()
            .describe("Path to note to analyze (default: active file)"),
        },
        async (args) => {
          const file = args.path
            ? app.vault.getAbstractFileByPath(args.path)
            : app.workspace.getActiveFile();

          if (!file || !(file instanceof TFile)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: args.path ? `File not found: ${args.path}` : "No active file",
                },
              ],
            };
          }

          const content = await app.vault.read(file);

          // Analyze content patterns.
          const analysis = {
            file: file.path,
            headingCount: (content.match(/^#+\s/gm) || []).length,
            listItemCount: (content.match(/^[\s]*[-*]\s/gm) || []).length,
            hasSteps: /step\s*\d|phase\s*\d|stage\s*\d/i.test(content),
            hasDates: /\d{4}[-/]\d{2}[-/]\d{2}/.test(content),
            hasPercentages: /\d+%/.test(content),
            hasRelationships: /relates to|connects|links|depends/i.test(content),
            hasStates: /state|status|phase|stage/i.test(content),
            suggestedDiagrams: [] as string[],
          };

          // Suggest diagrams based on content.
          if (analysis.hasSteps) analysis.suggestedDiagrams.push("flowchart");
          if (analysis.hasDates) analysis.suggestedDiagrams.push("gantt", "timeline");
          if (analysis.hasPercentages) analysis.suggestedDiagrams.push("pie");
          if (analysis.hasRelationships) analysis.suggestedDiagrams.push("erDiagram", "classDiagram");
          if (analysis.hasStates) analysis.suggestedDiagrams.push("stateDiagram");
          if (analysis.headingCount >= 3) analysis.suggestedDiagrams.push("mindmap");

          if (analysis.suggestedDiagrams.length === 0) {
            analysis.suggestedDiagrams.push("flowchart", "mindmap");
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(analysis, null, 2),
              },
            ],
          };
        }
      ),

      // ===== TEMPLATER INTEGRATION =====

      // List available Templater templates.
      tool(
        "list_templates",
        "List available Templater templates from the templates folder. Requires Templater plugin to be installed.",
        {
          folder: z
            .string()
            .optional()
            .describe("Template folder path (default: auto-detect from Templater settings)"),
        },
        async (args) => {
          // Try to get Templater's template folder from its settings.
          const templaterPlugin = (app as any).plugins?.plugins?.["templater-obsidian"];
          let templateFolder = args.folder;

          if (!templateFolder && templaterPlugin) {
            templateFolder = templaterPlugin.settings?.templates_folder || "Templates";
          }
          templateFolder = templateFolder || "Templates";

          const folder = app.vault.getAbstractFileByPath(templateFolder);
          if (!folder || !(folder instanceof TFolder)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Template folder not found: ${templateFolder}. Make sure Templater is installed and configured.`,
                },
              ],
            };
          }

          const templates: string[] = [];
          const collectTemplates = (f: TFolder) => {
            for (const child of f.children) {
              if (child instanceof TFile && child.extension === "md") {
                templates.push(child.path);
              } else if (child instanceof TFolder) {
                collectTemplates(child);
              }
            }
          };
          collectTemplates(folder);

          return {
            content: [
              {
                type: "text" as const,
                text: templates.length > 0
                  ? `Found ${templates.length} templates in ${templateFolder}:\n\n${templates.join("\n")}`
                  : `No templates found in ${templateFolder}`,
              },
            ],
          };
        }
      ),

      // Apply a Templater template.
      tool(
        "apply_template",
        "Apply a Templater template to create a new note or insert into current note. Requires Templater plugin.",
        {
          templatePath: z.string().describe("Path to the template file"),
          targetPath: z
            .string()
            .optional()
            .describe("Path for new note (if omitted, inserts at cursor in active file)"),
          openAfterCreate: z
            .boolean()
            .optional()
            .describe("Open the new note after creation (default: true)"),
        },
        async (args) => {
          const templaterPlugin = (app as any).plugins?.plugins?.["templater-obsidian"];
          if (!templaterPlugin) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Templater plugin is not installed or enabled.",
                },
              ],
            };
          }

          const templateFile = app.vault.getAbstractFileByPath(args.templatePath);
          if (!templateFile || !(templateFile instanceof TFile)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Template not found: ${args.templatePath}`,
                },
              ],
            };
          }

          try {
            if (args.targetPath) {
              // Create new note from template.
              await templaterPlugin.templater.create_new_note_from_template(
                templateFile,
                app.vault.getAbstractFileByPath(args.targetPath.substring(0, args.targetPath.lastIndexOf("/"))) || app.vault.getRoot(),
                args.targetPath.split("/").pop()?.replace(".md", "") || "Untitled",
                args.openAfterCreate !== false
              );
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Created note from template: ${args.targetPath}`,
                  },
                ],
              };
            } else {
              // Insert at cursor.
              await templaterPlugin.templater.append_template_to_active_file(templateFile);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Inserted template at cursor: ${args.templatePath}`,
                  },
                ],
              };
            }
          } catch (error: any) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to apply template: ${error.message}`,
                },
              ],
            };
          }
        }
      ),

      // ===== TASKS PLUGIN INTEGRATION =====

      // Query tasks from Tasks plugin.
      tool(
        "query_tasks",
        "Query tasks from notes using Obsidian Tasks plugin syntax. Returns matching tasks. Requires Tasks plugin.",
        {
          filter: z
            .enum(["all", "due", "overdue", "today", "upcoming", "completed", "incomplete"])
            .optional()
            .describe("Task filter (default: incomplete)"),
          path: z
            .string()
            .optional()
            .describe("Limit to tasks in this folder or file"),
          limit: z
            .number()
            .optional()
            .describe("Maximum tasks to return (default: 20)"),
        },
        async (args) => {
          const files = args.path
            ? app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(args.path!))
            : app.vault.getMarkdownFiles();

          const taskRegex = /^[\s]*[-*]\s+\[([ xX])\]\s+(.+)$/gm;
          const tasks: Array<{
            file: string;
            line: number;
            completed: boolean;
            text: string;
            due?: string;
            priority?: string;
          }> = [];

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          for (const file of files) {
            const content = await app.vault.read(file);
            const lines = content.split("\n");

            for (let i = 0; i < lines.length; i++) {
              const match = taskRegex.exec(lines[i]);
              if (match) {
                const completed = match[1].toLowerCase() === "x";
                const text = match[2];

                // Extract due date (📅 YYYY-MM-DD or due:YYYY-MM-DD).
                const dueMatch = text.match(/(?:📅|due:)\s*(\d{4}-\d{2}-\d{2})/);
                const due = dueMatch ? dueMatch[1] : undefined;

                // Extract priority.
                const priorityMatch = text.match(/[⏫🔼🔽⏬]|priority:\s*(high|medium|low)/i);
                const priority = priorityMatch ? priorityMatch[0] : undefined;

                // Apply filter.
                const filter = args.filter || "incomplete";
                let include = true;

                if (filter === "completed") include = completed;
                else if (filter === "incomplete") include = !completed;
                else if (filter === "due") include = !!due && !completed;
                else if (filter === "overdue" && due) {
                  const dueDate = new Date(due);
                  include = dueDate < today && !completed;
                } else if (filter === "today" && due) {
                  const dueDate = new Date(due);
                  include = dueDate.getTime() === today.getTime() && !completed;
                } else if (filter === "upcoming" && due) {
                  const dueDate = new Date(due);
                  include = dueDate >= today && !completed;
                }

                if (include) {
                  tasks.push({
                    file: file.path,
                    line: i + 1,
                    completed,
                    text: text.trim(),
                    due,
                    priority,
                  });
                }
              }
              taskRegex.lastIndex = 0;
            }
          }

          // Sort by due date.
          tasks.sort((a, b) => {
            if (!a.due && !b.due) return 0;
            if (!a.due) return 1;
            if (!b.due) return -1;
            return a.due.localeCompare(b.due);
          });

          const limited = tasks.slice(0, args.limit || 20);

          return {
            content: [
              {
                type: "text" as const,
                text: limited.length > 0
                  ? `Found ${tasks.length} tasks${tasks.length > limited.length ? ` (showing ${limited.length})` : ""}:\n\n${JSON.stringify(limited, null, 2)}`
                  : "No tasks found matching the filter.",
              },
            ],
          };
        }
      ),

      // Create a task.
      tool(
        "create_task",
        "Create a new task in a note. Can include due date, priority, and other Tasks plugin metadata.",
        {
          text: z.string().describe("Task description"),
          path: z.string().describe("Note path to add the task to"),
          due: z
            .string()
            .optional()
            .describe("Due date in YYYY-MM-DD format"),
          priority: z
            .enum(["high", "medium", "low"])
            .optional()
            .describe("Task priority"),
          scheduled: z
            .string()
            .optional()
            .describe("Scheduled date in YYYY-MM-DD format"),
        },
        async (args) => {
          const file = app.vault.getAbstractFileByPath(args.path);
          if (!file || !(file instanceof TFile)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `File not found: ${args.path}`,
                },
              ],
            };
          }

          // Build task string.
          let task = `- [ ] ${args.text}`;
          if (args.priority) {
            const priorityEmoji = { high: "⏫", medium: "🔼", low: "🔽" }[args.priority];
            task += ` ${priorityEmoji}`;
          }
          if (args.scheduled) task += ` ⏳ ${args.scheduled}`;
          if (args.due) task += ` 📅 ${args.due}`;

          // Append to file.
          const content = await app.vault.read(file);
          await app.vault.modify(file, content + "\n" + task);

          return {
            content: [
              {
                type: "text" as const,
                text: `Created task in ${args.path}:\n${task}`,
              },
            ],
          };
        }
      ),

      // Toggle task completion.
      tool(
        "toggle_task",
        "Toggle a task's completion status in a note.",
        {
          path: z.string().describe("Path to the note containing the task"),
          line: z.number().describe("Line number of the task (1-indexed)"),
        },
        async (args) => {
          const file = app.vault.getAbstractFileByPath(args.path);
          if (!file || !(file instanceof TFile)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `File not found: ${args.path}`,
                },
              ],
            };
          }

          const content = await app.vault.read(file);
          const lines = content.split("\n");
          const lineIndex = args.line - 1;

          if (lineIndex < 0 || lineIndex >= lines.length) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Invalid line number: ${args.line}`,
                },
              ],
            };
          }

          const line = lines[lineIndex];
          const taskMatch = line.match(/^([\s]*[-*]\s+\[)([ xX])(\]\s+.+)$/);
          if (!taskMatch) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No task found at line ${args.line}`,
                },
              ],
            };
          }

          // Toggle completion.
          const wasCompleted = taskMatch[2].toLowerCase() === "x";
          const newStatus = wasCompleted ? " " : "x";
          lines[lineIndex] = `${taskMatch[1]}${newStatus}${taskMatch[3]}`;

          await app.vault.modify(file, lines.join("\n"));

          return {
            content: [
              {
                type: "text" as const,
                text: `Task ${wasCompleted ? "uncompleted" : "completed"}: ${lines[lineIndex].trim()}`,
              },
            ],
          };
        }
      ),

      // ===== BACKLINK & GRAPH ANALYSIS =====

      // Get backlinks for a note.
      tool(
        "get_backlinks",
        "Get all notes that link to a specific note (backlinks). Useful for understanding how notes are connected.",
        {
          path: z
            .string()
            .optional()
            .describe("Path to the note (default: active file)"),
          includeContent: z
            .boolean()
            .optional()
            .describe("Include the linking context/sentence (default: false)"),
        },
        async (args) => {
          const targetFile = args.path
            ? app.vault.getAbstractFileByPath(args.path)
            : app.workspace.getActiveFile();

          if (!targetFile || !(targetFile instanceof TFile)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: args.path ? `File not found: ${args.path}` : "No active file",
                },
              ],
            };
          }

          // Get resolved links from Obsidian's metadata cache.
          const resolvedLinks = app.metadataCache.resolvedLinks;
          const backlinks: Array<{
            file: string;
            count: number;
            contexts?: string[];
          }> = [];

          // Find all files that link to target.
          for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
            if (links[targetFile.path]) {
              const entry: { file: string; count: number; contexts?: string[] } = {
                file: sourcePath,
                count: links[targetFile.path],
              };

              if (args.includeContent) {
                const sourceFile = app.vault.getAbstractFileByPath(sourcePath);
                if (sourceFile instanceof TFile) {
                  const content = await app.vault.read(sourceFile);
                  const targetName = targetFile.basename;
                  const linkRegex = new RegExp(`\\[\\[${targetName}(\\|[^\\]]+)?\\]\\]|\\[([^\\]]+)\\]\\([^)]*${targetName}[^)]*\\)`, "gi");
                  const contexts: string[] = [];

                  const lines = content.split("\n");
                  for (const line of lines) {
                    if (linkRegex.test(line)) {
                      contexts.push(line.trim().slice(0, 150));
                    }
                    linkRegex.lastIndex = 0;
                  }
                  entry.contexts = contexts.slice(0, 5);
                }
              }

              backlinks.push(entry);
            }
          }

          // Sort by count.
          backlinks.sort((a, b) => b.count - a.count);

          return {
            content: [
              {
                type: "text" as const,
                text: backlinks.length > 0
                  ? `Found ${backlinks.length} backlinks to ${targetFile.path}:\n\n${JSON.stringify(backlinks, null, 2)}`
                  : `No backlinks found for ${targetFile.path}`,
              },
            ],
          };
        }
      ),

      // Get outgoing links from a note.
      tool(
        "get_outgoing_links",
        "Get all links from a note to other notes (outgoing links/forward links).",
        {
          path: z
            .string()
            .optional()
            .describe("Path to the note (default: active file)"),
          includeUnresolved: z
            .boolean()
            .optional()
            .describe("Include links to non-existent notes (default: false)"),
        },
        async (args) => {
          const file = args.path
            ? app.vault.getAbstractFileByPath(args.path)
            : app.workspace.getActiveFile();

          if (!file || !(file instanceof TFile)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: args.path ? `File not found: ${args.path}` : "No active file",
                },
              ],
            };
          }

          const cache = app.metadataCache.getFileCache(file);
          const links: Array<{
            target: string;
            display?: string;
            resolved: boolean;
            line?: number;
          }> = [];

          if (cache?.links) {
            for (const link of cache.links) {
              const resolved = app.metadataCache.getFirstLinkpathDest(link.link, file.path);
              if (resolved || args.includeUnresolved) {
                links.push({
                  target: resolved?.path || link.link,
                  display: link.displayText !== link.link ? link.displayText : undefined,
                  resolved: !!resolved,
                  line: link.position.start.line + 1,
                });
              }
            }
          }

          // Also check embeds.
          if (cache?.embeds) {
            for (const embed of cache.embeds) {
              const resolved = app.metadataCache.getFirstLinkpathDest(embed.link, file.path);
              if (resolved || args.includeUnresolved) {
                links.push({
                  target: resolved?.path || embed.link,
                  display: `!embed: ${embed.displayText || embed.link}`,
                  resolved: !!resolved,
                  line: embed.position.start.line + 1,
                });
              }
            }
          }

          return {
            content: [
              {
                type: "text" as const,
                text: links.length > 0
                  ? `Found ${links.length} outgoing links from ${file.path}:\n\n${JSON.stringify(links, null, 2)}`
                  : `No outgoing links found in ${file.path}`,
              },
            ],
          };
        }
      ),

      // Analyze note connections (graph analysis).
      tool(
        "analyze_connections",
        "Analyze the connection structure of a note or the entire vault. Shows most connected notes, orphans, and clusters.",
        {
          path: z
            .string()
            .optional()
            .describe("Analyze connections for this note, or entire vault if omitted"),
          depth: z
            .number()
            .optional()
            .describe("How many link hops to analyze (default: 1)"),
        },
        async (args) => {
          const resolvedLinks = app.metadataCache.resolvedLinks;

          if (args.path) {
            // Analyze specific note.
            const file = app.vault.getAbstractFileByPath(args.path);
            if (!file || !(file instanceof TFile)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `File not found: ${args.path}`,
                  },
                ],
              };
            }

            const outgoing = Object.keys(resolvedLinks[args.path] || {});
            const incoming: string[] = [];

            for (const [source, links] of Object.entries(resolvedLinks)) {
              if (links[args.path]) incoming.push(source);
            }

            // Get second-degree connections if depth > 1.
            const secondDegree = new Set<string>();
            if ((args.depth || 1) > 1) {
              for (const linked of [...outgoing, ...incoming]) {
                for (const secondLink of Object.keys(resolvedLinks[linked] || {})) {
                  if (secondLink !== args.path && !outgoing.includes(secondLink) && !incoming.includes(secondLink)) {
                    secondDegree.add(secondLink);
                  }
                }
              }
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    file: args.path,
                    outgoingLinks: outgoing.length,
                    incomingLinks: incoming.length,
                    totalConnections: new Set([...outgoing, ...incoming]).size,
                    outgoing: outgoing.slice(0, 20),
                    incoming: incoming.slice(0, 20),
                    secondDegreeConnections: args.depth && args.depth > 1 ? Array.from(secondDegree).slice(0, 20) : undefined,
                  }, null, 2),
                },
              ],
            };
          } else {
            // Vault-wide analysis.
            const noteStats: Record<string, { outgoing: number; incoming: number }> = {};

            // Count outgoing links.
            for (const [source, links] of Object.entries(resolvedLinks)) {
              if (!noteStats[source]) noteStats[source] = { outgoing: 0, incoming: 0 };
              noteStats[source].outgoing = Object.keys(links).length;

              // Count incoming for each target.
              for (const target of Object.keys(links)) {
                if (!noteStats[target]) noteStats[target] = { outgoing: 0, incoming: 0 };
                noteStats[target].incoming++;
              }
            }

            // Find most connected and orphans.
            const entries = Object.entries(noteStats);
            const mostConnected = entries
              .map(([path, stats]) => ({ path, total: stats.outgoing + stats.incoming, ...stats }))
              .sort((a, b) => b.total - a.total)
              .slice(0, 10);

            const orphans = entries
              .filter(([_, stats]) => stats.outgoing === 0 && stats.incoming === 0)
              .map(([path]) => path)
              .slice(0, 20);

            const markdownFiles = app.vault.getMarkdownFiles();
            const allOrphans = markdownFiles
              .filter((f) => !noteStats[f.path] || (noteStats[f.path].outgoing === 0 && noteStats[f.path].incoming === 0))
              .map((f) => f.path);

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    totalNotes: markdownFiles.length,
                    notesWithLinks: entries.length,
                    orphanNotes: allOrphans.length,
                    mostConnected,
                    orphanSample: allOrphans.slice(0, 20),
                  }, null, 2),
                },
              ],
            };
          }
        }
      ),

      // Find unlinked mentions.
      tool(
        "find_unlinked_mentions",
        "Find mentions of a note's name in other notes that are not linked. Useful for discovering potential connections.",
        {
          path: z
            .string()
            .optional()
            .describe("Path to the note (default: active file)"),
          limit: z
            .number()
            .optional()
            .describe("Maximum number of results (default: 20)"),
        },
        async (args) => {
          const targetFile = args.path
            ? app.vault.getAbstractFileByPath(args.path)
            : app.workspace.getActiveFile();

          if (!targetFile || !(targetFile instanceof TFile)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: args.path ? `File not found: ${args.path}` : "No active file",
                },
              ],
            };
          }

          const targetName = targetFile.basename;
          const resolvedLinks = app.metadataCache.resolvedLinks;
          const mentions: Array<{ file: string; line: number; context: string }> = [];

          // Search all markdown files.
          const files = app.vault.getMarkdownFiles().filter((f) => f.path !== targetFile.path);

          for (const file of files) {
            // Skip if already linked.
            if (resolvedLinks[file.path]?.[targetFile.path]) continue;

            const content = await app.vault.read(file);
            const lines = content.split("\n");

            // Case-insensitive search for the note name.
            const regex = new RegExp(`\\b${targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i");

            for (let i = 0; i < lines.length; i++) {
              // Skip if it's already a link to this note.
              if (lines[i].includes(`[[${targetName}`) || lines[i].includes(`](${targetFile.path}`)) continue;

              if (regex.test(lines[i])) {
                mentions.push({
                  file: file.path,
                  line: i + 1,
                  context: lines[i].trim().slice(0, 150),
                });

                if (mentions.length >= (args.limit || 20)) break;
              }
            }

            if (mentions.length >= (args.limit || 20)) break;
          }

          return {
            content: [
              {
                type: "text" as const,
                text: mentions.length > 0
                  ? `Found ${mentions.length} unlinked mentions of "${targetName}":\n\n${JSON.stringify(mentions, null, 2)}`
                  : `No unlinked mentions found for "${targetName}"`,
              },
            ],
          };
        }
      ),

      // ===== DATAVIEW INTEGRATION =====

      // Execute a Dataview query (DQL).
      tool(
        "execute_dataview_query",
        `Execute a Dataview Query Language (DQL) query and return results. Use this to search and analyze notes based on metadata, tags, and content.

Common DQL patterns:
- LIST: "LIST FROM #tag" - List notes with a tag
- TABLE: "TABLE file.ctime, status FROM folder" - Table with columns
- TASK: "TASK FROM folder" - List tasks from notes
- CALENDAR: "CALENDAR file.ctime" - Calendar view data

Examples:
- "LIST FROM #project WHERE status = 'active'"
- "TABLE file.name, due FROM #task WHERE !completed SORT due ASC"
- "LIST FROM 'Daily Notes' WHERE file.ctime >= date(today) - dur(7 days)"

Note: The user can ask in natural language like "show me all notes tagged project from last week" and you should translate it to DQL.`,
        {
          query: z.string().describe("The DQL query to execute (e.g., 'LIST FROM #tag')"),
          sourcePath: z.string().optional().describe("Optional: path context for relative links"),
        },
        async (args) => {
          const dataview = (app as any).plugins?.plugins?.dataview;
          if (!dataview?.api) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Dataview plugin is not installed or enabled. Please install Dataview from Community Plugins.",
                },
              ],
            };
          }

          try {
            const api = dataview.api;
            const result = await api.queryMarkdown(args.query, args.sourcePath);

            if (result.successful) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Dataview Query Results:\n\n${result.value}`,
                  },
                ],
              };
            } else {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Query Error: ${result.error}`,
                  },
                ],
              };
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error executing query: ${String(error)}`,
                },
              ],
            };
          }
        }
      ),

      // List available Dataview fields in the vault.
      tool(
        "list_dataview_fields",
        "List all frontmatter fields and inline fields used across the vault. Useful for understanding what metadata is available for Dataview queries.",
        {
          sampleSize: z.number().optional().describe("Number of files to sample (default: 100, max: 500)"),
        },
        async (args) => {
          const dataview = (app as any).plugins?.plugins?.dataview;
          if (!dataview?.api) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Dataview plugin is not installed or enabled.",
                },
              ],
            };
          }

          try {
            const api = dataview.api;
            const files = app.vault.getMarkdownFiles();
            const sampleSize = Math.min(args.sampleSize || 100, 500);
            const sampledFiles = files.slice(0, sampleSize);

            const fieldCounts: Record<string, number> = {};
            const fieldExamples: Record<string, string[]> = {};

            for (const file of sampledFiles) {
              const page = api.page(file.path);
              if (page) {
                for (const [key, value] of Object.entries(page)) {
                  // Skip internal Dataview fields.
                  if (key.startsWith("file")) continue;

                  fieldCounts[key] = (fieldCounts[key] || 0) + 1;

                  // Store example values.
                  if (!fieldExamples[key]) {
                    fieldExamples[key] = [];
                  }
                  if (fieldExamples[key].length < 3 && value !== null && value !== undefined) {
                    const valueStr = String(value).slice(0, 50);
                    if (!fieldExamples[key].includes(valueStr)) {
                      fieldExamples[key].push(valueStr);
                    }
                  }
                }
              }
            }

            // Sort by frequency.
            const sortedFields = Object.entries(fieldCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([field, count]) => ({
                field,
                count,
                examples: fieldExamples[field] || [],
              }));

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Dataview Fields (sampled from ${sampledFiles.length} files):\n\n${JSON.stringify(sortedFields, null, 2)}\n\nBuilt-in file fields: file.name, file.path, file.folder, file.ctime, file.mtime, file.size, file.tags, file.etags, file.inlinks, file.outlinks, file.tasks`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error listing fields: ${String(error)}`,
                },
              ],
            };
          }
        }
      ),

      // Get Dataview page metadata for a specific file.
      tool(
        "get_dataview_page",
        "Get all Dataview metadata for a specific file, including frontmatter, inline fields, tasks, and links.",
        {
          path: z.string().describe("Path to the file relative to vault root"),
        },
        async (args) => {
          const dataview = (app as any).plugins?.plugins?.dataview;
          if (!dataview?.api) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Dataview plugin is not installed or enabled.",
                },
              ],
            };
          }

          try {
            const api = dataview.api;
            const page = api.page(args.path);

            if (!page) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `File not found or not indexed: ${args.path}`,
                  },
                ],
              };
            }

            // Extract relevant metadata.
            const metadata: Record<string, any> = {};
            for (const [key, value] of Object.entries(page)) {
              // Convert Dataview objects to plain values.
              if (value && typeof value === "object" && "path" in value) {
                metadata[key] = (value as any).path;
              } else if (Array.isArray(value)) {
                metadata[key] = value.map((v: any) =>
                  v && typeof v === "object" && "path" in v ? v.path : v
                );
              } else {
                metadata[key] = value;
              }
            }

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Dataview metadata for "${args.path}":\n\n${JSON.stringify(metadata, null, 2)}`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error getting page metadata: ${String(error)}`,
                },
              ],
            };
          }
        }
      ),
    ],
  });
}
