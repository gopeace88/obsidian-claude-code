// IndexedDB vector store for RAG embeddings.

import { VectorRecord, IndexStats } from "./types";
import { logger } from "../utils/Logger";

const DB_NAME = "obsidian-claude-code-rag";
const DB_VERSION = 1;
const STORE_NAME = "vectors";
const META_STORE = "metadata";

export class VectorStore {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  // Initialize the database.
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        logger.error("VectorStore", "Failed to open database", {
          error: request.error?.message,
        });
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        logger.info("VectorStore", "Database opened successfully");
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create vectors store with indexes.
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("file", "file", { unique: false });
          store.createIndex("modified", "metadata.modified", { unique: false });
        }

        // Create metadata store.
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };
    });

    return this.initPromise;
  }

  // Add or update vectors for a file.
  async upsert(records: VectorRecord[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const record of records) {
        store.put(record);
      }
    });
  }

  // Delete all vectors for a file.
  async deleteByFile(filePath: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("file");
      const request = index.getAllKeys(IDBKeyRange.only(filePath));

      request.onsuccess = () => {
        const keys = request.result;
        for (const key of keys) {
          store.delete(key);
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Search for similar vectors using cosine similarity.
  async search(
    queryEmbedding: number[],
    topK = 5,
    options?: { folder?: string; threshold?: number }
  ): Promise<Array<VectorRecord & { score: number }>> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        let records: VectorRecord[] = request.result;

        // Filter by folder if specified.
        if (options?.folder) {
          records = records.filter((r) => r.file.startsWith(options.folder!));
        }

        // Calculate cosine similarity for each record.
        const scored = records.map((record) => ({
          ...record,
          score: this.cosineSimilarity(queryEmbedding, record.embedding),
        }));

        // Filter by threshold.
        const threshold = options?.threshold ?? 0;
        const filtered = scored.filter((r) => r.score >= threshold);

        // Sort by score descending and take top K.
        filtered.sort((a, b) => b.score - a.score);
        resolve(filtered.slice(0, topK));
      };

      request.onerror = () => reject(request.error);
    });
  }

  // Get all records (for debugging/stats).
  async getAll(): Promise<VectorRecord[]> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Clear all vectors.
  async clear(): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Get index statistics.
  async getStats(): Promise<IndexStats> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME, META_STORE], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const metaStore = transaction.objectStore(META_STORE);

      // Request all data within the transaction (before it completes).
      const countRequest = store.count();
      const metaRequest = metaStore.get("lastUpdated");
      const fileIndex = store.index("file");
      const filesRequest = fileIndex.getAllKeys();

      // Results holder.
      let chunks = 0;
      let lastUpdated = 0;
      let uniqueFiles = 0;

      countRequest.onsuccess = () => {
        chunks = countRequest.result;
      };

      metaRequest.onsuccess = () => {
        lastUpdated = metaRequest.result?.value || 0;
      };

      filesRequest.onsuccess = () => {
        uniqueFiles = new Set(filesRequest.result as IDBValidKey[]).size;
      };

      transaction.oncomplete = () => {
        resolve({
          files: uniqueFiles,
          chunks,
          lastUpdated,
        });
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Update last updated timestamp.
  async setLastUpdated(timestamp: number): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([META_STORE], "readwrite");
      const store = transaction.objectStore(META_STORE);
      store.put({ key: "lastUpdated", value: timestamp });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Check if file needs reindexing.
  async needsReindex(filePath: string, modifiedTime: number): Promise<boolean> {
    await this.init();
    if (!this.db) throw new Error("Database not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("file");
      const request = index.get(filePath);

      request.onsuccess = () => {
        if (!request.result) {
          resolve(true);
          return;
        }
        resolve(request.result.metadata.modified < modifiedTime);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // Calculate cosine similarity between two vectors.
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  // Close the database connection.
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}
