// Internal RAG provider using Ollama embeddings and IndexedDB.
// Used as fallback when Smart Connections / Omnisearch not available.

import { App, TFile } from "obsidian";
import {
  IRAGProvider,
  RAGSearchResult,
  RAGSearchOptions,
  IEmbeddingService,
  RAGSettings,
  VectorRecord,
  IndexStats,
} from "./types";
import { OllamaEmbeddingService, OpenAIEmbeddingService } from "./EmbeddingService";
import { MarkdownChunker } from "./MarkdownChunker";
import { VectorStore } from "./VectorStore";
import { logger } from "../utils/Logger";

export class InternalRAGProvider implements IRAGProvider {
  name = "internal";

  private app: App;
  private settings: RAGSettings;
  private embedder: IEmbeddingService;
  private chunker: MarkdownChunker;
  private vectorStore: VectorStore;
  private initialized = false;

  constructor(app: App, settings: RAGSettings) {
    this.app = app;
    this.settings = settings;

    // Initialize embedding service based on settings.
    if (settings.embeddingProvider === "openai" && settings.openaiApiKey) {
      this.embedder = new OpenAIEmbeddingService(settings.openaiApiKey);
    } else {
      this.embedder = new OllamaEmbeddingService(
        settings.ollamaUrl,
        settings.ollamaModel
      );
    }

    // Initialize chunker.
    this.chunker = new MarkdownChunker({
      strategy: settings.chunkStrategy,
      maxSize: settings.chunkSize,
      overlap: settings.chunkOverlap,
    });

    // Initialize vector store.
    this.vectorStore = new VectorStore();
  }

  // Check if internal RAG is available (Ollama running).
  isAvailable(): boolean {
    // Sync check - assume available, actual check happens on search.
    return true;
  }

  // Async availability check.
  async checkAvailability(): Promise<boolean> {
    return this.embedder.isAvailable();
  }

  // Initialize the internal RAG system.
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.vectorStore.init();
    this.initialized = true;
    logger.info("InternalRAG", "Initialized");
  }

  // Search using internal embeddings.
  async search(query: string, options?: RAGSearchOptions): Promise<RAGSearchResult[]> {
    await this.initialize();

    // Check if embedding service is available.
    const available = await this.embedder.isAvailable();
    if (!available) {
      logger.warn("InternalRAG", "Embedding service not available");
      return [];
    }

    try {
      // Generate query embedding (with search prefix for nomic).
      const queryText = this.settings.ollamaModel.includes("nomic")
        ? `search_query: ${query}`
        : query;
      const queryEmbedding = await this.embedder.embed(queryText);

      // Search vector store.
      const results = await this.vectorStore.search(queryEmbedding, options?.topK ?? 5, {
        folder: options?.folder,
        threshold: options?.similarityThreshold,
      });

      // Convert to RAGSearchResult format.
      return results.map((r) => ({
        file: r.file,
        content: r.content,
        score: r.score,
        chunkIndex: r.chunkIndex,
        metadata: r.metadata,
      }));
    } catch (error) {
      logger.error("InternalRAG", "Search failed", { error: String(error) });
      return [];
    }
  }

  // Find related notes.
  async findRelated(content: string, topK = 5): Promise<RAGSearchResult[]> {
    // Use first 500 chars as query.
    return this.search(content.slice(0, 500), { topK });
  }

  // Index a single file.
  async indexFile(file: TFile): Promise<number> {
    await this.initialize();

    try {
      // Check if file needs reindexing.
      const needsReindex = await this.vectorStore.needsReindex(
        file.path,
        file.stat.mtime
      );
      if (!needsReindex) {
        return 0;
      }

      // Read file content.
      const content = await this.app.vault.read(file);
      const cache = this.app.metadataCache.getFileCache(file);

      // Chunk the content.
      const chunks = this.chunker.chunk(content, cache);

      if (chunks.length === 0) {
        return 0;
      }

      // Generate embeddings.
      const embeddings = await this.embedder.batchEmbed(chunks.map((c) => c.content));

      // Create vector records.
      const records: VectorRecord[] = chunks.map((chunk, i) => ({
        id: `${file.path}#${chunk.index}`,
        file: file.path,
        chunkIndex: chunk.index,
        content: chunk.content,
        embedding: embeddings[i],
        metadata: {
          headings: chunk.metadata.headings,
          tags: cache?.tags?.map((t) => t.tag) || [],
          modified: file.stat.mtime,
        },
      }));

      // Delete old records and insert new ones.
      await this.vectorStore.deleteByFile(file.path);
      await this.vectorStore.upsert(records);

      return chunks.length;
    } catch (error) {
      logger.error("InternalRAG", "Failed to index file", {
        file: file.path,
        error: String(error),
      });
      return 0;
    }
  }

  // Index all markdown files in vault.
  async indexVault(
    force = false,
    onProgress?: (current: number, total: number, file: string) => void
  ): Promise<IndexStats> {
    await this.initialize();

    // Check embedding service availability.
    const available = await this.embedder.isAvailable();
    if (!available) {
      throw new Error(
        "Embedding service not available. Please ensure Ollama is running with nomic-embed-text model."
      );
    }

    // Clear if force rebuild.
    if (force) {
      await this.vectorStore.clear();
    }

    // Get all markdown files.
    let files = this.app.vault.getMarkdownFiles();

    // Filter out excluded folders.
    if (this.settings.excludeFolders.length > 0) {
      files = files.filter(
        (f) => !this.settings.excludeFolders.some((folder) => f.path.startsWith(folder))
      );
    }

    let totalChunks = 0;
    let indexedFiles = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onProgress?.(i + 1, files.length, file.path);

      const chunks = await this.indexFile(file);
      if (chunks > 0) {
        totalChunks += chunks;
        indexedFiles++;
      }
    }

    // Update last updated timestamp.
    await this.vectorStore.setLastUpdated(Date.now());

    const stats = {
      files: indexedFiles,
      chunks: totalChunks,
      lastUpdated: Date.now(),
    };

    logger.info("InternalRAG", "Vault indexing complete", stats);
    return stats;
  }

  // Get index statistics.
  async getStats(): Promise<IndexStats> {
    await this.initialize();
    return this.vectorStore.getStats();
  }

  // Delete index for a file.
  async deleteFile(filePath: string): Promise<void> {
    await this.initialize();
    await this.vectorStore.deleteByFile(filePath);
  }

  // Clear entire index.
  async clearIndex(): Promise<void> {
    await this.initialize();
    await this.vectorStore.clear();
  }

  // Update settings.
  updateSettings(settings: RAGSettings): void {
    this.settings = settings;

    // Recreate embedding service if provider changed.
    if (settings.embeddingProvider === "openai" && settings.openaiApiKey) {
      this.embedder = new OpenAIEmbeddingService(settings.openaiApiKey);
    } else {
      this.embedder = new OllamaEmbeddingService(
        settings.ollamaUrl,
        settings.ollamaModel
      );
    }

    // Recreate chunker with new settings.
    this.chunker = new MarkdownChunker({
      strategy: settings.chunkStrategy,
      maxSize: settings.chunkSize,
      overlap: settings.chunkOverlap,
    });
  }

  // Close resources.
  close(): void {
    this.vectorStore.close();
    this.initialized = false;
  }
}
