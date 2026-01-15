# Obsidian Claude Plugin - Feature Recommendations

Based on an analysis of popular Obsidian plugins (Smart Connections, Copilot, Dataview) and user needs, here are recommended features to implement next.

## 1. Active "Smart View" (High Impact)
**Inspiration:** Smart Connections
**Description:** Instead of requiring the user to *ask* for information, actively show relevant notes in a sidebar pane as they type in the active editor.
*   **Why:** Turns the AI from a passive chatbot into an active research assistant.
*   **Implementation:** 
    *   Monitor `workspace.on('editor-change')`.
    *   Debounce input and run a background RAG query using the current paragraph/note as the query.
    *   Display "Related Notes" in a dedicated view.

## 2. Contextual Editor Commands (AI-Assisted Editing)
**Inspiration:** Obsidian Copilot, Text Generator
**Description:** Add right-click or command palette actions that operate directly on selected text.
*   **Features:**
    *   **"Fix Grammar & Style"**: Rewrite selection to be more professional/concise.
    *   **"Summarize Selection"**: Create a callout with a summary.
    *   **"Continue Writing"**: Generate the next paragraph based on context.
    *   **"Generate Tags"**: Analyze the note and suggest YAML tags.
*   **Why:** frequent, low-friction interactions are often used more than full chat conversations.

## 3. "Chat with Data" (Dataview Integration)
**Inspiration:** Dataview, Smart Connections
**Description:** Enable Claude to execute Dataview queries or "Chat with your Metadata".
*   **Use Case:** "Show me all notes modified last week tagged #project/active" -> Claude translates this to a Dataview query, executes it, and summarizes the results.
*   **Why:** Dataview is powerful but has a steep learning curve. NL-to-Dataview is a killer feature.

## 4. Content Ingestion & Analysis
**Inspiration:** Omnisearch, Copilot
**Description:** Better handling of non-markdown formats.
*   **Features:**
    *   **PDF Analysis**: Extract text from PDFs and vector-index them.
    *   **YouTube Summarizer**: "Paste a YouTube URL -> Get a summary/transcript note".
    *   **Web Clipper**: Save a URL as a clean markdown note (using `WebFetch` tool).

## 5. Task Intelligence
**Inspiration:** Tasks Plugin
**Description:** LLM-based task extraction and management.
*   **Use Case:** "Find all action items in my meeting notes from this week" -> Claude scans recent files for `- [ ]` and aggregates them, potentially organizing by priority/topic.

## 6. Daily Reflection / Automated Journaling
**Inspiration:** Periodic Notes
**Description:** Automated prompts or summaries for Daily Notes.
*   **Feature:** "Fill my Daily Note" -> Claude looks at the calendar, tasks, and notes created today to generate a "What I did today" summary log in the daily note.

---

## Recommended Prioritization

1.  **Contextual Editor Commands** (Easiest to implement, high immediate value)
2.  **Smart View / Related Notes** (Leverages the RAG system you are already building)
3.  **Chat with Data / Dataview** (High "wow" factor for power users)
