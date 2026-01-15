// Hybrid RAG service that tries multiple providers in priority order.
// Smart Connections > Omnisearch > Internal RAG

import { App } from "obsidian";
import {
  IRAGProvider,
  RAGSearchResult,
  RAGSearchOptions,
  RAGSettings,
  DEFAULT_RAG_SETTINGS,
  IndexStats,
} from "./types";
import { SmartConnectionsAdapter } from "./SmartConnectionsAdapter";
import { OmnisearchAdapter } from "./OmnisearchAdapter";
import { InternalRAGProvider } from "./InternalRAGProvider";
import { logger } from "../utils/Logger";

export class HybridRAGService {
  private app: App;
  private settings: RAGSettings;
  private providers: Map<string, IRAGProvider> = new Map();
  private internalProvider: InternalRAGProvider;
  private activeProvider: IRAGProvider | null = null;

  constructor(app: App, settings?: Partial<RAGSettings>) {
    this.app = app;
    this.settings = { ...DEFAULT_RAG_SETTINGS, ...settings };

    // Initialize all providers.
    this.providers.set("smart-connections", new SmartConnectionsAdapter());
    this.providers.set("omnisearch", new OmnisearchAdapter());
    this.internalProvider = new InternalRAGProvider(app, this.settings);
    this.providers.set("internal", this.internalProvider);

    logger.info("HybridRAG", "Service initialized", {
      providerPriority: this.settings.providerPriority,
    });
  }

  // Check if RAG is enabled and available.
  isEnabled(): boolean {
    return this.settings.enableRAG;
  }

  // Get the first available provider based on priority.
  private getActiveProvider(): IRAGProvider | null {
    for (const providerName of this.settings.providerPriority) {
      const provider = this.providers.get(providerName);
      if (provider?.isAvailable()) {
        if (this.activeProvider !== provider) {
          logger.info("HybridRAG", "Using provider", { provider: providerName });
          this.activeProvider = provider;
        }
        return provider;
      }
    }

    logger.warn("HybridRAG", "No providers available");
    return null;
  }

  // Search across vault using best available provider.
  async search(query: string, options?: RAGSearchOptions): Promise<RAGSearchResult[]> {
    if (!this.settings.enableRAG) {
      return [];
    }

    const mergedOptions: RAGSearchOptions = {
      topK: this.settings.topK,
      similarityThreshold: this.settings.similarityThreshold,
      useHybridSearch: this.settings.useHybridSearch,
      ...options,
    };

    const provider = this.getActiveProvider();
    if (!provider) {
      return [];
    }

    try {
      const results = await provider.search(query, mergedOptions);
      logger.debug("HybridRAG", "Search completed", {
        provider: provider.name,
        results: results.length,
        query: query.slice(0, 50),
      });
      return results;
    } catch (error) {
      logger.error("HybridRAG", "Search failed", {
        provider: provider.name,
        error: String(error),
      });
      return [];
    }
  }

  // Find notes related to given content.
  async findRelated(content: string, topK?: number): Promise<RAGSearchResult[]> {
    if (!this.settings.enableRAG) {
      return [];
    }

    const provider = this.getActiveProvider();
    if (!provider) {
      return [];
    }

    if (provider.findRelated) {
      return provider.findRelated(content, topK ?? this.settings.topK);
    }

    // Fallback to search with content snippet.
    return this.search(content.slice(0, 200), { topK: topK ?? this.settings.topK });
  }

  // Get context string for Claude query augmentation.
  async getContextForQuery(query: string, options?: RAGSearchOptions): Promise<string> {
    const results = await this.search(query, options);

    if (results.length === 0) {
      return "";
    }

    // Format results as context.
    const contextParts = results.map((r) => {
      const header = r.metadata?.headings?.length
        ? `# ${r.file} > ${r.metadata.headings.join(" > ")}`
        : `# ${r.file}`;
      return `${header}\n${r.content}`;
    });

    return `Relevant context from vault:\n\n${contextParts.join("\n\n---\n\n")}`;
  }

  // Reindex vault (only works with internal provider).
  async reindex(
    force = false,
    onProgress?: (current: number, total: number, file: string) => void
  ): Promise<IndexStats> {
    return this.internalProvider.indexVault(force, onProgress);
  }

  // Get index statistics.
  async getStats(): Promise<IndexStats> {
    return this.internalProvider.getStats();
  }

  // Index a single file (for auto-indexing on change).
  async indexFile(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file && "stat" in file) {
      await this.internalProvider.indexFile(file as any);
    }
  }

  // Delete file from index.
  async deleteFile(filePath: string): Promise<void> {
    await this.internalProvider.deleteFile(filePath);
  }

  // Update settings.
  updateSettings(settings: Partial<RAGSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.internalProvider.updateSettings(this.settings);
    this.activeProvider = null; // Force re-detection of provider.
    logger.info("HybridRAG", "Settings updated", {
      providerPriority: this.settings.providerPriority,
    });
  }

  // Get current settings.
  getSettings(): RAGSettings {
    return { ...this.settings };
  }

  // Get active provider name.
  getActiveProviderName(): string | null {
    const provider = this.getActiveProvider();
    return provider?.name ?? null;
  }

  // Check if internal RAG is available (Ollama running).
  async checkInternalAvailability(): Promise<boolean> {
    return this.internalProvider.checkAvailability();
  }

  // Close and cleanup.
  close(): void {
    this.internalProvider.close();
    this.providers.clear();
    this.activeProvider = null;
  }
}
