// Omnisearch plugin adapter.
// Uses Omnisearch API if available.

import { IRAGProvider, RAGSearchResult, RAGSearchOptions } from "./types";
import { logger } from "../utils/Logger";

// Omnisearch API interface.
interface OmnisearchAPI {
  search(query: string): Promise<OmnisearchResult[]>;
  refreshIndex?(): Promise<void>;
}

interface OmnisearchResult {
  path: string;
  basename: string;
  content?: string;
  matches?: Array<{
    match: string;
    offset: number;
  }>;
  score: number;
}

// Declare global window type for Omnisearch.
declare global {
  interface Window {
    omnisearch?: OmnisearchAPI;
  }
}

export class OmnisearchAdapter implements IRAGProvider {
  name = "omnisearch";

  // Check if Omnisearch plugin is available.
  isAvailable(): boolean {
    return typeof window.omnisearch?.search === "function";
  }

  // Search using Omnisearch (keyword-based BM25).
  async search(query: string, options?: RAGSearchOptions): Promise<RAGSearchResult[]> {
    if (!window.omnisearch) {
      logger.warn("Omnisearch", "API not available");
      return [];
    }

    try {
      const results = await window.omnisearch.search(query);

      // Filter by folder if specified.
      let filtered = results;
      if (options?.folder) {
        filtered = results.filter((r) => r.path.startsWith(options.folder!));
      }

      // Convert to our format.
      return filtered.slice(0, options?.topK ?? 5).map((r) => ({
        file: r.path,
        content: this.extractContent(r),
        score: r.score,
        metadata: {},
      }));
    } catch (error) {
      logger.error("Omnisearch", "Search failed", { error: String(error) });
      return [];
    }
  }

  // Extract content from Omnisearch result.
  private extractContent(result: OmnisearchResult): string {
    if (result.content) {
      return result.content;
    }
    if (result.matches && result.matches.length > 0) {
      // Combine match contexts.
      return result.matches.map((m) => m.match).join(" ... ");
    }
    return `[${result.basename}]`;
  }

  // Find related notes - Omnisearch doesn't support this directly.
  async findRelated(content: string, topK = 5): Promise<RAGSearchResult[]> {
    // Extract keywords from content and search.
    const keywords = this.extractKeywords(content);
    return this.search(keywords, { topK });
  }

  // Extract keywords from content for search.
  private extractKeywords(content: string): string {
    // Simple keyword extraction: take first 10 unique words > 3 chars.
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .filter((w, i, arr) => arr.indexOf(w) === i)
      .slice(0, 10);
    return words.join(" ");
  }
}
