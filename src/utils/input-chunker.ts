/**
 * InputChunker - Utility for chunking long text at semantic boundaries
 *
 * Chunking priority:
 * 1. Paragraph boundaries (\n\n)
 * 2. Sentence boundaries (. ! ?)
 * 3. Line boundaries (\n)
 * 4. Hard split at max size
 *
 * Special handling for code blocks (```):
 * - Never split inside a code block
 * - Keep code blocks intact even if they exceed max size
 */

export interface ChunkOptions {
  maxChunkSize?: number; // default: 15000
  preserveCodeBlocks?: boolean; // default: true
}

interface CodeBlock {
  start: number;
  end: number;
}

export class InputChunker {
  private static readonly DEFAULT_MAX_SIZE = 15000;

  /**
   * Check if text needs chunking
   * @param text - Input text
   * @param maxSize - Max chunk size (default: 15000)
   * @returns True if text exceeds max size
   */
  static needsChunking(text: string, maxSize: number = this.DEFAULT_MAX_SIZE): boolean {
    return text.length > maxSize;
  }

  /**
   * Chunk text at semantic boundaries
   * @param text - Input text to chunk
   * @param options - Chunking options
   * @returns Array of text chunks
   */
  static chunk(text: string, options: ChunkOptions = {}): string[] {
    const maxChunkSize = options.maxChunkSize ?? this.DEFAULT_MAX_SIZE;
    const preserveCodeBlocks = options.preserveCodeBlocks ?? true;

    // If text doesn't need chunking, return as-is
    if (!this.needsChunking(text, maxChunkSize)) {
      return [text];
    }

    // Find all code blocks if preservation is enabled
    const codeBlocks = preserveCodeBlocks ? this.findCodeBlocks(text) : [];

    const chunks: string[] = [];
    let currentPosition = 0;

    while (currentPosition < text.length) {
      const remainingText = text.substring(currentPosition);

      // If remaining text fits in one chunk, we're done
      if (remainingText.length <= maxChunkSize) {
        chunks.push(remainingText);
        break;
      }

      // Check if we're at the start of a code block
      const codeBlockAtPosition = codeBlocks.find(cb => cb.start === currentPosition);

      if (codeBlockAtPosition) {
        const codeBlockText = text.substring(codeBlockAtPosition.start, codeBlockAtPosition.end);

        // If code block exceeds max size, log warning but keep it intact
        if (codeBlockText.length > maxChunkSize) {
          console.warn(`Code block at position ${currentPosition} exceeds max chunk size (${codeBlockText.length} > ${maxChunkSize}). Keeping intact.`);
        }

        chunks.push(codeBlockText);
        currentPosition = codeBlockAtPosition.end;
        continue;
      }

      // Find the best split point within maxChunkSize
      const splitPoint = this.findBestSplitPoint(
        text,
        currentPosition,
        maxChunkSize,
        codeBlocks
      );

      chunks.push(text.substring(currentPosition, splitPoint));
      currentPosition = splitPoint;
    }

    return chunks;
  }

  /**
   * Find all code blocks in the text
   * @param text - Input text
   * @returns Array of code block positions
   */
  private static findCodeBlocks(text: string): CodeBlock[] {
    const codeBlocks: CodeBlock[] = [];
    const codeBlockRegex = /```[\s\S]*?```/g;
    let match: RegExpExecArray | null;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      codeBlocks.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return codeBlocks;
  }

  /**
   * Check if a position is inside a code block
   * @param position - Position to check
   * @param codeBlocks - Array of code blocks
   * @returns True if position is inside a code block
   */
  private static isInsideCodeBlock(position: number, codeBlocks: CodeBlock[]): boolean {
    return codeBlocks.some(cb => position > cb.start && position < cb.end);
  }

  /**
   * Find the best split point within the max chunk size
   * @param text - Full text
   * @param startPos - Starting position
   * @param maxSize - Maximum chunk size
   * @param codeBlocks - Array of code blocks to avoid splitting
   * @returns Position to split at
   */
  private static findBestSplitPoint(
    text: string,
    startPos: number,
    maxSize: number,
    codeBlocks: CodeBlock[]
  ): number {
    const searchEnd = Math.min(startPos + maxSize, text.length);
    const searchText = text.substring(startPos, searchEnd);

    // Priority 1: Try to split at paragraph boundary (\n\n)
    const paragraphMatch = this.findLastOccurrence(searchText, /\n\n/g);
    if (paragraphMatch !== -1) {
      const splitPoint = startPos + paragraphMatch + 2; // +2 to include the \n\n
      if (!this.isInsideCodeBlock(splitPoint, codeBlocks)) {
        return splitPoint;
      }
    }

    // Priority 2: Try to split at sentence boundary (. ! ?)
    const sentenceMatch = this.findLastOccurrence(searchText, /[.!?]\s/g);
    if (sentenceMatch !== -1) {
      const splitPoint = startPos + sentenceMatch + 2; // +2 to include punctuation and space
      if (!this.isInsideCodeBlock(splitPoint, codeBlocks)) {
        return splitPoint;
      }
    }

    // Priority 3: Try to split at line boundary (\n)
    const lineMatch = this.findLastOccurrence(searchText, /\n/g);
    if (lineMatch !== -1) {
      const splitPoint = startPos + lineMatch + 1; // +1 to include the \n
      if (!this.isInsideCodeBlock(splitPoint, codeBlocks)) {
        return splitPoint;
      }
    }

    // Priority 4: Hard split at max size (last resort)
    // But make sure we don't split inside a code block
    let candidateSplit = searchEnd;
    while (candidateSplit > startPos && this.isInsideCodeBlock(candidateSplit, codeBlocks)) {
      // Walk backwards to find the start of the code block
      const blockStart = codeBlocks.find(cb => candidateSplit > cb.start && candidateSplit <= cb.end)?.start;
      if (blockStart !== undefined) {
        candidateSplit = blockStart;
      } else {
        break;
      }
    }

    return candidateSplit;
  }

  /**
   * Find the last occurrence of a pattern in text
   * @param text - Text to search
   * @param pattern - Regex pattern
   * @returns Position of last match, or -1 if not found
   */
  private static findLastOccurrence(text: string, pattern: RegExp): number {
    let lastMatch = -1;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      lastMatch = match.index;
    }

    return lastMatch;
  }
}
