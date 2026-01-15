// Markdown chunker for splitting notes into semantic chunks.

import { Chunk, ChunkConfig } from "./types";
import { CachedMetadata, HeadingCache } from "obsidian";

export class MarkdownChunker {
  private config: ChunkConfig;

  constructor(config?: Partial<ChunkConfig>) {
    this.config = {
      strategy: config?.strategy ?? "heading",
      maxSize: config?.maxSize ?? 512,
      overlap: config?.overlap ?? 50,
    };
  }

  // Chunk a markdown file.
  chunk(content: string, cache?: CachedMetadata | null): Chunk[] {
    switch (this.config.strategy) {
      case "heading":
        return this.chunkByHeadings(content, cache?.headings || []);
      case "fixed":
        return this.chunkFixed(content);
      case "smart":
        return this.chunkSmart(content, cache?.headings || []);
      default:
        return this.chunkByHeadings(content, cache?.headings || []);
    }
  }

  // Chunk by markdown headings.
  private chunkByHeadings(content: string, headings: HeadingCache[]): Chunk[] {
    if (headings.length === 0) {
      // No headings, treat as single chunk or use fixed.
      return this.chunkFixed(content);
    }

    const lines = content.split("\n");
    const chunks: Chunk[] = [];
    let currentHeadings: string[] = [];

    // Sort headings by position.
    const sortedHeadings = [...headings].sort(
      (a, b) => a.position.start.line - b.position.start.line
    );

    for (let i = 0; i < sortedHeadings.length; i++) {
      const heading = sortedHeadings[i];
      const nextHeading = sortedHeadings[i + 1];

      const startLine = heading.position.start.line;
      const endLine = nextHeading
        ? nextHeading.position.start.line - 1
        : lines.length - 1;

      // Update heading stack based on level.
      const level = heading.level;
      currentHeadings = currentHeadings.slice(0, level - 1);
      currentHeadings.push(heading.heading);

      // Extract content for this section.
      const sectionLines = lines.slice(startLine, endLine + 1);
      const sectionContent = sectionLines.join("\n").trim();

      if (sectionContent.length > 0) {
        // If section is too large, split further.
        if (this.estimateTokens(sectionContent) > this.config.maxSize) {
          const subChunks = this.splitLargeSection(
            sectionContent,
            startLine,
            currentHeadings
          );
          chunks.push(...subChunks.map((c, idx) => ({ ...c, index: chunks.length + idx })));
        } else {
          chunks.push({
            content: sectionContent,
            index: chunks.length,
            metadata: {
              headings: [...currentHeadings],
              startLine,
              endLine,
            },
          });
        }
      }
    }

    // Handle content before first heading.
    if (sortedHeadings.length > 0 && sortedHeadings[0].position.start.line > 0) {
      const preHeadingContent = lines
        .slice(0, sortedHeadings[0].position.start.line)
        .join("\n")
        .trim();
      if (preHeadingContent.length > 0) {
        chunks.unshift({
          content: preHeadingContent,
          index: 0,
          metadata: {
            headings: [],
            startLine: 0,
            endLine: sortedHeadings[0].position.start.line - 1,
          },
        });
        // Re-index all chunks.
        chunks.forEach((c, i) => (c.index = i));
      }
    }

    return chunks;
  }

  // Fixed-size chunking with overlap.
  private chunkFixed(content: string): Chunk[] {
    const chunks: Chunk[] = [];
    const lines = content.split("\n");
    let currentChunk: string[] = [];
    let currentTokens = 0;
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineTokens = this.estimateTokens(line);

      if (currentTokens + lineTokens > this.config.maxSize && currentChunk.length > 0) {
        // Save current chunk.
        chunks.push({
          content: currentChunk.join("\n"),
          index: chunks.length,
          metadata: {
            headings: [],
            startLine,
            endLine: i - 1,
          },
        });

        // Start new chunk with overlap.
        const overlapLines = Math.ceil(this.config.overlap / 10);
        currentChunk = currentChunk.slice(-overlapLines);
        currentTokens = this.estimateTokens(currentChunk.join("\n"));
        startLine = i - overlapLines;
      }

      currentChunk.push(line);
      currentTokens += lineTokens;
    }

    // Add remaining content.
    if (currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join("\n"),
        index: chunks.length,
        metadata: {
          headings: [],
          startLine,
          endLine: lines.length - 1,
        },
      });
    }

    return chunks;
  }

  // Smart chunking: heading-based with paragraph fallback.
  private chunkSmart(content: string, headings: HeadingCache[]): Chunk[] {
    // First try heading-based.
    const headingChunks = this.chunkByHeadings(content, headings);

    // Then split any oversized chunks by paragraphs.
    const result: Chunk[] = [];
    for (const chunk of headingChunks) {
      if (this.estimateTokens(chunk.content) > this.config.maxSize) {
        const subChunks = this.splitByParagraphs(chunk);
        result.push(...subChunks.map((c, idx) => ({ ...c, index: result.length + idx })));
      } else {
        result.push({ ...chunk, index: result.length });
      }
    }

    return result;
  }

  // Split large section into smaller chunks.
  private splitLargeSection(
    content: string,
    startLine: number,
    headings: string[]
  ): Chunk[] {
    const chunks: Chunk[] = [];
    const paragraphs = content.split(/\n\n+/);
    let currentContent = "";
    let currentStart = startLine;

    for (const para of paragraphs) {
      if (
        this.estimateTokens(currentContent + para) > this.config.maxSize &&
        currentContent.length > 0
      ) {
        chunks.push({
          content: currentContent.trim(),
          index: chunks.length,
          metadata: {
            headings: [...headings],
            startLine: currentStart,
            endLine: currentStart + currentContent.split("\n").length - 1,
          },
        });
        currentContent = para;
        currentStart += currentContent.split("\n").length;
      } else {
        currentContent += (currentContent ? "\n\n" : "") + para;
      }
    }

    if (currentContent.trim().length > 0) {
      chunks.push({
        content: currentContent.trim(),
        index: chunks.length,
        metadata: {
          headings: [...headings],
          startLine: currentStart,
          endLine: startLine + content.split("\n").length - 1,
        },
      });
    }

    return chunks;
  }

  // Split chunk by paragraphs.
  private splitByParagraphs(chunk: Chunk): Chunk[] {
    const paragraphs = chunk.content.split(/\n\n+/);
    const result: Chunk[] = [];
    let currentContent = "";

    for (const para of paragraphs) {
      if (
        this.estimateTokens(currentContent + para) > this.config.maxSize &&
        currentContent.length > 0
      ) {
        result.push({
          content: currentContent.trim(),
          index: result.length,
          metadata: { ...chunk.metadata },
        });
        currentContent = para;
      } else {
        currentContent += (currentContent ? "\n\n" : "") + para;
      }
    }

    if (currentContent.trim().length > 0) {
      result.push({
        content: currentContent.trim(),
        index: result.length,
        metadata: { ...chunk.metadata },
      });
    }

    return result;
  }

  // Estimate token count (rough: ~4 chars per token).
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
