// RAG system types and interfaces.

// Search result from any RAG provider.
export interface RAGSearchResult {
  file: string;
  content: string;
  score: number;
  chunkIndex?: number;
  metadata?: {
    headings?: string[];
    tags?: string[];
    modified?: number;
  };
}

// RAG provider interface - all providers must implement this.
export interface IRAGProvider {
  name: string;
  isAvailable(): boolean;
  search(query: string, options?: RAGSearchOptions): Promise<RAGSearchResult[]>;
  findRelated?(content: string, topK?: number): Promise<RAGSearchResult[]>;
}

// Search options for RAG queries.
export interface RAGSearchOptions {
  topK?: number;
  folder?: string;
  similarityThreshold?: number;
  useHybridSearch?: boolean;
}

// Vector record for IndexedDB storage.
export interface VectorRecord {
  id: string;
  file: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: {
    headings: string[];
    tags: string[];
    modified: number;
  };
}

// Chunk from markdown chunker.
export interface Chunk {
  content: string;
  index: number;
  metadata: {
    headings: string[];
    startLine: number;
    endLine: number;
  };
}

// Chunk configuration.
export interface ChunkConfig {
  strategy: "heading" | "fixed" | "smart";
  maxSize: number;
  overlap: number;
}

// RAG settings (to be added to ClaudeCodeSettings).
export interface RAGSettings {
  // Enable/disable.
  enableRAG: boolean;

  // Provider priority: try in order until one works.
  providerPriority: ("smart-connections" | "omnisearch" | "internal")[];

  // Embedding (for internal provider).
  embeddingProvider: "ollama" | "openai";
  ollamaUrl: string;
  ollamaModel: string;
  openaiApiKey?: string;

  // Chunking.
  chunkStrategy: "heading" | "fixed" | "smart";
  chunkSize: number;
  chunkOverlap: number;

  // Search.
  topK: number;
  similarityThreshold: number;
  useHybridSearch: boolean;

  // Indexing.
  autoIndex: boolean;
  excludeFolders: string[];
}

// Default RAG settings.
export const DEFAULT_RAG_SETTINGS: RAGSettings = {
  enableRAG: true,
  providerPriority: ["smart-connections", "omnisearch", "internal"],
  embeddingProvider: "ollama",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "nomic-embed-text",
  chunkStrategy: "heading",
  chunkSize: 512,
  chunkOverlap: 50,
  topK: 5,
  similarityThreshold: 0.7,
  useHybridSearch: true,
  autoIndex: false,
  excludeFolders: [".obsidian", ".trash", "node_modules"],
};

// Embedding service interface.
export interface IEmbeddingService {
  embed(text: string): Promise<number[]>;
  batchEmbed(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  isAvailable(): Promise<boolean>;
}

// Index statistics.
export interface IndexStats {
  files: number;
  chunks: number;
  lastUpdated: number;
}
