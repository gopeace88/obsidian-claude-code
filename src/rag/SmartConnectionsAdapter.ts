// Smart Connections plugin adapter.
// Uses Smart Connections API if available.

import { IRAGProvider, RAGSearchResult, RAGSearchOptions } from "./types";
import { logger } from "../utils/Logger";

// Smart Connections API interface (based on their docs).
interface SmartConnectionsAPI {
  search?(query: string, options?: { limit?: number }): Promise<SmartConnectionResult[]>;
  list_connections?(notePath: string): Promise<SmartConnectionResult[]>;
  score_connection?(query: string): Promise<SmartConnectionResult[]>;
}

interface SmartConnectionResult {
  path?: string;
  key?: string;
  score?: number;
  similarity?: number;
  text?: string;
  content?: string;
}

// Declare global window type for Smart Connections API.
declare global {
  interface Window {
    "smart-connections"?: {
      api?: SmartConnectionsAPI;
    };
    SmartSearch?: SmartConnectionsAPI;
  }
}

export class SmartConnectionsAdapter implements IRAGProvider {
  name = "smart-connections";

  // Check if Smart Connections plugin is available.
  isAvailable(): boolean {
    const api = this.getAPI();
    return api !== null;
  }

  // Get the Smart Connections API.
  private getAPI(): SmartConnectionsAPI | null {
    // Try different API access patterns.
    if (window["smart-connections"]?.api) {
      return window["smart-connections"].api;
    }
    if (window.SmartSearch) {
      return window.SmartSearch;
    }
    return null;
  }

  // Search using Smart Connections.
  async search(query: string, options?: RAGSearchOptions): Promise<RAGSearchResult[]> {
    const api = this.getAPI();
    if (!api) {
      logger.warn("SmartConnections", "API not available");
      return [];
    }

    try {
      let results: SmartConnectionResult[] = [];

      // Try different search methods.
      if (api.search) {
        results = await api.search(query, { limit: options?.topK ?? 5 });
      } else if (api.score_connection) {
        results = await api.score_connection(query);
      }

      // Convert to our format.
      return results.slice(0, options?.topK ?? 5).map((r, index) => ({
        file: r.path || r.key || "unknown",
        content: r.text || r.content || "",
        score: r.score || r.similarity || 1 - index * 0.1,
        metadata: {},
      }));
    } catch (error) {
      logger.error("SmartConnections", "Search failed", { error: String(error) });
      return [];
    }
  }

  // Find related notes using Smart Connections.
  async findRelated(content: string, topK = 5): Promise<RAGSearchResult[]> {
    // For Smart Connections, we use the same search method.
    return this.search(content.slice(0, 500), { topK });
  }
}
