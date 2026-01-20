import { describe, expect, test } from "bun:test";
import { InputChunker } from "./input-chunker";

describe("InputChunker", () => {
  describe("needsChunking", () => {
    test("returns false for text under default max size", () => {
      const text = "Short text";
      expect(InputChunker.needsChunking(text)).toBe(false);
    });

    test("returns true for text over default max size", () => {
      const text = "x".repeat(15001);
      expect(InputChunker.needsChunking(text)).toBe(true);
    });

    test("returns false for text exactly at max size", () => {
      const text = "x".repeat(15000);
      expect(InputChunker.needsChunking(text)).toBe(false);
    });

    test("respects custom max size", () => {
      const text = "x".repeat(100);
      expect(InputChunker.needsChunking(text, 50)).toBe(true);
      expect(InputChunker.needsChunking(text, 200)).toBe(false);
    });

    test("handles empty string", () => {
      expect(InputChunker.needsChunking("")).toBe(false);
    });
  });

  describe("chunk - basic functionality", () => {
    test("returns single chunk for text under max size", () => {
      const text = "This is a short text.";
      const chunks = InputChunker.chunk(text);
      expect(chunks).toEqual([text]);
    });

    test("returns empty array element for empty string", () => {
      const chunks = InputChunker.chunk("");
      expect(chunks).toEqual([""]);
    });

    test("splits text at paragraph boundaries", () => {
      const text = "Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 20 });

      expect(chunks.length).toBeGreaterThan(1);
      // Verify no chunks exceed max size
      chunks.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(20));
    });

    test("preserves paragraph separators when splitting", () => {
      const text = "First.\n\nSecond.\n\nThird.";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 15 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });

    test("handles multiple consecutive paragraph breaks", () => {
      const text = "Text1\n\n\n\nText2";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 10 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });
  });

  describe("chunk - sentence boundaries", () => {
    test("splits at sentence boundaries when paragraphs too large", () => {
      const text = "First sentence. Second sentence. Third sentence. Fourth sentence.";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 30 });

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(30));
    });

    test("handles different sentence terminators", () => {
      const text = "Question? Exclamation! Statement. Another sentence.";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 25 });

      expect(chunks.length).toBeGreaterThan(1);
      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });

    test("preserves sentence spacing", () => {
      const text = "First. Second. Third.";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 12 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });
  });

  describe("chunk - line boundaries", () => {
    test("splits at line boundaries when sentences too large", () => {
      const text = "Line one with no sentence terminator\nLine two\nLine three";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 30 });

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(30));
    });

    test("preserves newlines when splitting at lines", () => {
      const text = "First\nSecond\nThird\nFourth";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 12 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });
  });

  describe("chunk - hard split fallback", () => {
    test("hard splits when no semantic boundaries available", () => {
      const text = "x".repeat(100);
      const chunks = InputChunker.chunk(text, { maxChunkSize: 30 });

      expect(chunks.length).toBe(4); // 30, 30, 30, 10
      chunks.slice(0, 3).forEach(chunk => expect(chunk.length).toBe(30));
      expect(chunks[3].length).toBe(10);
    });

    test("hard splits respect max size exactly", () => {
      const text = "a".repeat(50);
      const chunks = InputChunker.chunk(text, { maxChunkSize: 15 });

      chunks.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(15));
    });
  });

  describe("chunk - code block handling", () => {
    test("preserves code blocks intact", () => {
      const codeBlock = "```javascript\nconst x = 1;\nconsole.log(x);\n```";
      const text = `Text before.\n\n${codeBlock}\n\nText after.`;
      const chunks = InputChunker.chunk(text, { maxChunkSize: 30 });

      // Code block should appear complete in one chunk
      const codeChunk = chunks.find(chunk => chunk.includes("```javascript"));
      expect(codeChunk).toContain("```javascript");
      expect(codeChunk).toContain("```"); // closing backticks
    });

    test("never splits inside code block", () => {
      const codeBlock = "```\n" + "x".repeat(100) + "\n```";
      const text = `Before\n\n${codeBlock}\n\nAfter`;
      const chunks = InputChunker.chunk(text, { maxChunkSize: 50 });

      // Verify code block appears complete in exactly one chunk
      const chunksWithCode = chunks.filter(chunk => chunk.includes("```"));
      expect(chunksWithCode.length).toBe(1);

      const codeChunk = chunksWithCode[0];
      const openCount = (codeChunk.match(/```/g) || []).length;
      expect(openCount).toBe(2); // opening and closing
    });

    test("handles multiple code blocks", () => {
      const code1 = "```\ncode1\n```";
      const code2 = "```\ncode2\n```";
      const text = `Text1\n\n${code1}\n\nText2\n\n${code2}\n\nText3`;
      const chunks = InputChunker.chunk(text, { maxChunkSize: 25 });

      // Join and verify no content lost
      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);

      // Verify both code blocks present
      expect(rejoined).toContain("code1");
      expect(rejoined).toContain("code2");
    });

    test("handles code block exceeding max size", () => {
      const largeCode = "```\n" + "x".repeat(20000) + "\n```";
      const chunks = InputChunker.chunk(largeCode, { maxChunkSize: 15000 });

      // Should keep code block intact despite exceeding max size
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe(largeCode);
    });

    test("handles code block with language specifier", () => {
      const codeBlock = "```typescript\ninterface Foo { bar: string; }\n```";
      const text = `Before\n\n${codeBlock}\n\nAfter`;
      const chunks = InputChunker.chunk(text, { maxChunkSize: 30 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });

    test("can disable code block preservation", () => {
      const codeBlock = "```\n" + "x".repeat(100) + "\n```";
      const chunks = InputChunker.chunk(codeBlock, {
        maxChunkSize: 50,
        preserveCodeBlocks: false,
      });

      // With preservation disabled, should split the code block
      expect(chunks.length).toBeGreaterThan(1);
    });

    test("handles nested backticks inside code blocks", () => {
      const codeBlock = "```markdown\nHere is `inline code` in markdown\n```";
      const text = `Text\n\n${codeBlock}\n\nMore text`;
      const chunks = InputChunker.chunk(text, { maxChunkSize: 40 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });
  });

  describe("chunk - markdown preservation", () => {
    test("preserves markdown headers", () => {
      const text = "# Header 1\n\nSome text.\n\n## Header 2\n\nMore text.";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 30 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });

    test("preserves markdown lists", () => {
      const text = "- Item 1\n- Item 2\n- Item 3\n\nParagraph.";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 20 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });

    test("preserves markdown links", () => {
      const text = "Check [this link](https://example.com) for more info.";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 30 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });

    test("preserves markdown bold and italic", () => {
      const text = "This is **bold** and this is *italic* text.";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 25 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });
  });

  describe("chunk - edge cases", () => {
    test("handles text with only whitespace", () => {
      const text = "   \n\n   \n   ";
      const chunks = InputChunker.chunk(text);
      expect(chunks).toEqual([text]);
    });

    test("handles text with unicode characters", () => {
      const text = "Hello 世界! 🌍\n\nこんにちは\n\nEmoji: 😀🎉";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 20 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });

    test("handles very long single line", () => {
      const text = "x".repeat(50000);
      const chunks = InputChunker.chunk(text, { maxChunkSize: 15000 });

      expect(chunks.length).toBe(4);
      expect(chunks.every(chunk => chunk.length <= 15000)).toBe(true);
    });

    test("handles alternating code and text", () => {
      const text = "Text1\n\n```\ncode1\n```\n\nText2\n\n```\ncode2\n```\n\nText3";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 25 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });

    test("handles custom max chunk size", () => {
      const text = "a".repeat(100);
      const chunks = InputChunker.chunk(text, { maxChunkSize: 25 });

      expect(chunks.length).toBe(4);
      chunks.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(25));
    });

    test("handles text ending with code block", () => {
      const text = "Some text\n\n```\nfinal code\n```";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 20 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });

    test("handles text starting with code block", () => {
      const text = "```\ninitial code\n```\n\nFollowing text";
      const chunks = InputChunker.chunk(text, { maxChunkSize: 20 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);
    });
  });

  describe("chunk - realistic scenarios", () => {
    test("chunks a realistic markdown document", () => {
      const text = `# API Documentation

## Introduction

This API provides access to user data.

## Endpoints

### GET /users

Returns all users.

\`\`\`javascript
fetch('/users')
  .then(res => res.json())
  .then(data => console.log(data));
\`\`\`

### POST /users

Creates a new user.

\`\`\`javascript
fetch('/users', {
  method: 'POST',
  body: JSON.stringify({ name: 'John' })
});
\`\`\`

## Conclusion

See the full docs for more.`;

      const chunks = InputChunker.chunk(text, { maxChunkSize: 200 });

      // Verify no data loss
      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);

      // Verify all chunks within size limit
      chunks.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(200));

      // Verify code blocks not split
      chunks.forEach(chunk => {
        const backtickCount = (chunk.match(/```/g) || []).length;
        // Each chunk should have 0 or 2 backticks (complete code blocks)
        expect(backtickCount % 2).toBe(0);
      });
    });

    test("handles chat message with mixed content", () => {
      const text = `User asked about TypeScript.

Here's an example:

\`\`\`typescript
interface User {
  id: number;
  name: string;
}

const user: User = {
  id: 1,
  name: "Alice"
};
\`\`\`

This shows type safety in action. TypeScript prevents errors by checking types at compile time.

Another example with generics:

\`\`\`typescript
function identity<T>(arg: T): T {
  return arg;
}
\`\`\`

Pretty cool, right?`;

      const chunks = InputChunker.chunk(text, { maxChunkSize: 150 });

      const rejoined = chunks.join("");
      expect(rejoined).toBe(text);

      chunks.forEach(chunk => expect(chunk.length).toBeLessThanOrEqual(150));
    });
  });
});
