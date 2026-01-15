// Embedding service for generating vector embeddings.
// Supports Ollama (local) and OpenAI (cloud).

import { IEmbeddingService } from "./types";
import { logger } from "../utils/Logger";

// Ollama embedding service.
export class OllamaEmbeddingService implements IEmbeddingService {
  private url: string;
  private model: string;
  private dimensions: number;

  constructor(url = "http://localhost:11434", model = "nomic-embed-text") {
    this.url = url;
    this.model = model;
    // nomic-embed-text uses 768 dimensions by default.
    this.dimensions = model.includes("nomic") ? 768 : 384;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  // Check if Ollama is available.
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.url}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;

      const data = await response.json();
      const models = data.models || [];
      return models.some((m: { name: string }) => m.name.includes(this.model));
    } catch {
      return false;
    }
  }

  // Generate embedding for single text.
  async embed(text: string): Promise<number[]> {
    const embeddings = await this.batchEmbed([text]);
    return embeddings[0];
  }

  // Generate embeddings for multiple texts.
  async batchEmbed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      try {
        // nomic-embed-text requires task prefix.
        const prefixedText = this.model.includes("nomic")
          ? `search_document: ${text}`
          : text;

        const response = await fetch(`${this.url}/api/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.model,
            input: prefixedText,
          }),
        });

        if (!response.ok) {
          throw new Error(`Ollama error: ${response.status}`);
        }

        const data = await response.json();
        results.push(data.embeddings?.[0] || data.embedding || []);
      } catch (error) {
        logger.error("OllamaEmbedding", "Embed failed", { error: String(error) });
        // Return zero vector on error.
        results.push(new Array(this.dimensions).fill(0));
      }
    }

    return results;
  }
}

// OpenAI embedding service.
export class OpenAIEmbeddingService implements IEmbeddingService {
  private apiKey: string;
  private model: string;
  private dimensions: number;

  constructor(apiKey: string, model = "text-embedding-3-small") {
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = model.includes("large") ? 3072 : 1536;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.batchEmbed([text]);
    return embeddings[0];
  }

  async batchEmbed(texts: string[]): Promise<number[][]> {
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI error: ${response.status}`);
      }

      const data = await response.json();
      return data.data.map((d: { embedding: number[] }) => d.embedding);
    } catch (error) {
      logger.error("OpenAIEmbedding", "Embed failed", { error: String(error) });
      return texts.map(() => new Array(this.dimensions).fill(0));
    }
  }
}
