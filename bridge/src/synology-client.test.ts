import { describe, test, expect } from 'bun:test';
import { SynologyClient } from './synology-client';

// Test helper to access private chunkMessage method
function chunkMessage(client: SynologyClient, text: string): string[] {
  // @ts-expect-error - accessing private method for testing
  return client.chunkMessage(text);
}

describe('SynologyClient', () => {
  const mockWebhookUrl = 'https://example.com/webhook';

  describe('chunkMessage - basic text chunking', () => {
    test('short message stays as single chunk', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const text = 'This is a short message.';
      const chunks = chunkMessage(client, text);

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe(text);
    });

    test('empty input returns single empty chunk', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const chunks = chunkMessage(client, '');

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('');
    });

    test('long text splits into multiple chunks', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const paragraph = 'A'.repeat(2000);
      const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
      const chunks = chunkMessage(client, text);

      expect(chunks.length).toBeGreaterThan(1);
    });

    test('preserves paragraph boundaries when chunking', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const para1 = 'First paragraph. '.repeat(100);
      const para2 = 'Second paragraph. '.repeat(100);
      const text = `${para1}\n\n${para2}`;
      const chunks = chunkMessage(client, text);

      // Should split on paragraph boundary
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(3500);
      });
    });
  });

  describe('chunkMessage - code block preservation', () => {
    test('single code block stays intact', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const codeBlock = '```typescript\nconst x = 1;\nconst y = 2;\n```';
      const text = `Here is some code:\n\n${codeBlock}\n\nThat was the code.`;
      const chunks = chunkMessage(client, text);

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toContain('```typescript');
      expect(chunks[0]).toContain('const x = 1;');
      expect(chunks[0]).toContain('```');
    });

    test('code block never gets split across chunks', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const longText = 'A'.repeat(3000);
      const codeBlock = '```js\nfunction test() {\n  return true;\n}\n```';
      const text = `${longText}\n\n${codeBlock}\n\nMore text after.`;
      const chunks = chunkMessage(client, text);

      // Code block should be entirely in one chunk
      const chunkWithCode = chunks.find((c) => c.includes('```js'));
      expect(chunkWithCode).toBeDefined();
      expect(chunkWithCode).toContain('function test()');
      expect(chunkWithCode).toContain('return true;');

      // Verify no partial code blocks
      chunks.forEach((chunk) => {
        const openCount = (chunk.match(/```/g) || []).length;
        // Each chunk should have even number of ``` (pairs)
        expect(openCount % 2).toBe(0);
      });
    });

    test('multiple code blocks preserved separately', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const code1 = '```python\nprint("hello")\n```';
      const code2 = '```bash\necho "world"\n```';
      const text = `First code:\n${code1}\n\nSecond code:\n${code2}`;
      const chunks = chunkMessage(client, text);

      const fullText = chunks.join('');
      expect(fullText).toContain('print("hello")');
      expect(fullText).toContain('echo "world"');

      // Both code blocks should be intact
      expect(fullText.match(/```python[\s\S]*?```/)).toBeTruthy();
      expect(fullText.match(/```bash[\s\S]*?```/)).toBeTruthy();
    });

    test('large code block (>3500 chars) stays intact', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const largeCode = 'const line = "x";\n'.repeat(300); // ~5000 chars
      const codeBlock = `\`\`\`javascript\n${largeCode}\`\`\``;
      const text = `Before text.\n\n${codeBlock}\n\nAfter text.`;

      const chunks = chunkMessage(client, text);

      // Code block should be in one chunk despite being >3500
      const chunkWithCode = chunks.find((c) => c.includes('```javascript'));
      expect(chunkWithCode).toBeDefined();
      expect(chunkWithCode!.includes(largeCode)).toBe(true);
    });

    test('code block at chunk boundary handled correctly', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const textBefore = 'A'.repeat(3400); // Close to limit
      const codeBlock = '```ts\nconst x = 1;\n```';
      const textAfter = 'B'.repeat(100);
      const text = `${textBefore}\n\n${codeBlock}\n\n${textAfter}`;

      const chunks = chunkMessage(client, text);

      // Code block should be complete in whichever chunk it's in
      const chunkWithCode = chunks.find((c) => c.includes('```ts'));
      expect(chunkWithCode).toBeDefined();
      expect(chunkWithCode).toContain('const x = 1;');
    });
  });

  describe('chunkMessage - chunk indicators', () => {
    test('single chunk has no indicator', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const text = 'Short message';
      const chunks = chunkMessage(client, text);

      expect(chunks.length).toBe(1);
      expect(chunks[0]).not.toMatch(/^\[\d+\/\d+\]/);
    });

    test('multiple chunks have [N/Total] indicators', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const para = 'Paragraph text. '.repeat(150);
      const text = `${para}\n\n${para}\n\n${para}`;
      const chunks = chunkMessage(client, text);

      expect(chunks.length).toBeGreaterThan(1);

      chunks.forEach((chunk, i) => {
        const expectedPrefix = `[${i + 1}/${chunks.length}]`;
        expect(chunk.startsWith(expectedPrefix)).toBe(true);
      });
    });

    test('chunk indicators format correctly for 2 chunks', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const text = 'A'.repeat(3000) + '\n\n' + 'B'.repeat(3000);
      const chunks = chunkMessage(client, text);

      expect(chunks[0]).toMatch(/^\[1\/2\] /);
      expect(chunks[1]).toMatch(/^\[2\/2\] /);
    });

    test('chunk indicators format correctly for 3+ chunks', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const para = 'X'.repeat(2000);
      const text = Array(5).fill(para).join('\n\n');
      const chunks = chunkMessage(client, text);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks[0]).toMatch(/^\[1\/\d+\] /);
      expect(chunks[chunks.length - 1]).toMatch(new RegExp(`^\\[${chunks.length}\/${chunks.length}\\] `));
    });
  });

  describe('chunkMessage - mixed content (text + code)', () => {
    test('text and code blocks chunked together with indicators', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const longText = 'Lorem ipsum. '.repeat(300);
      const code = '```js\nconsole.log("test");\n```';
      const text = `${longText}\n\n${code}\n\n${longText}`;

      const chunks = chunkMessage(client, text);

      if (chunks.length > 1) {
        chunks.forEach((chunk, i) => {
          expect(chunk).toMatch(/^\[\d+\/\d+\] /);
        });
      }

      // Code block should be intact somewhere
      const fullText = chunks.join('');
      expect(fullText).toContain('console.log("test");');
    });

    test('multiple code blocks with long text between', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const text1 = 'A'.repeat(2000);
      const code1 = '```python\nprint(1)\n```';
      const text2 = 'B'.repeat(2000);
      const code2 = '```bash\nls -la\n```';
      const text3 = 'C'.repeat(2000);

      const text = `${text1}\n\n${code1}\n\n${text2}\n\n${code2}\n\n${text3}`;
      const chunks = chunkMessage(client, text);

      const fullText = chunks.join('');
      expect(fullText).toContain('print(1)');
      expect(fullText).toContain('ls -la');
    });
  });

  describe('chunkMessage - edge cases', () => {
    test('message exactly at 3500 char limit', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const text = 'A'.repeat(3500);
      const chunks = chunkMessage(client, text);

      expect(chunks.length).toBe(1);
      expect(chunks[0].length).toBe(3500);
    });

    test('message just over 3500 char limit', () => {
      const client = new SynologyClient(mockWebhookUrl);
      // Create text with paragraphs to force chunking
      const para1 = 'A'.repeat(2000);
      const para2 = 'B'.repeat(2000);
      const text = `${para1}\n\n${para2}`;
      const chunks = chunkMessage(client, text);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        // Account for chunk indicators in length
        const contentLength = chunk.replace(/^\[\d+\/\d+\] /, '').length;
        expect(contentLength).toBeLessThanOrEqual(3500);
      });
    });

    test('code block with complex content (nested backticks in string)', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const code = '```js\nconst x = "Use \\`backticks\\` here";\n```';
      const text = `Check this:\n\n${code}\n\nCool, right?`;
      const chunks = chunkMessage(client, text);

      expect(chunks[0]).toContain('const x = "Use \\`backticks\\` here";');
    });

    test('malformed code blocks (unclosed) treated as text', () => {
      const client = new SynologyClient(mockWebhookUrl);
      const text = 'Start\n```js\nconst x = 1;\n\nNo closing backticks!';
      const chunks = chunkMessage(client, text);

      // Should still chunk successfully without crashing
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Integration test - 15KB response', () => {
    test('successfully chunks 15KB response', () => {
      const client = new SynologyClient(mockWebhookUrl);

      // Create a realistic 15KB response with mixed content
      const intro = 'Here is a comprehensive analysis:\n\n';
      const section1 = 'Section 1: '.repeat(200) + '\n\n';
      const code1 = '```typescript\nfunction example() {\n  return "data";\n}\n```\n\n';
      const section2 = 'Section 2 content. '.repeat(500) + '\n\n';
      const code2 = '```bash\n# Commands\nls -la\ncd /path\n```\n\n';
      const section3 = 'Final thoughts. '.repeat(600);

      const text = intro + section1 + code1 + section2 + code2 + section3;

      // Verify it's actually ~15KB
      expect(text.length).toBeGreaterThan(12000);
      expect(text.length).toBeLessThan(25000);

      const chunks = chunkMessage(client, text);

      // Should chunk successfully
      expect(chunks.length).toBeGreaterThan(1);

      // All chunks should have indicators
      chunks.forEach((chunk, i) => {
        expect(chunk).toMatch(/^\[\d+\/\d+\] /);
      });

      // Code blocks should be intact
      const fullText = chunks.join('');
      expect(fullText).toContain('function example()');
      expect(fullText).toContain('ls -la');

      // Verify chunks exist (some may be larger due to large code blocks being kept intact)
      // The important thing is that code blocks are never split
      chunks.forEach((chunk) => {
        const codeBlockCount = (chunk.match(/```/g) || []).length;
        // Each chunk should have even number of ``` (complete blocks)
        expect(codeBlockCount % 2).toBe(0);
      });
    });
  });
});
