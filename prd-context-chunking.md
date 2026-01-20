# PRD: Context Chunking for Synology Chat Claude Bridge

**Version:** 1.0
**Date:** 2026-01-20
**Status:** Ready for Implementation
**Author:** Atlas (PAI Architect Agent)

---

## Executive Summary

### Project Overview
The Synology Chat Claude Bridge currently lacks proper context management, resulting in messages being skipped when they exceed Claude's context window. This PRD outlines a comprehensive solution to implement intelligent context chunking, conversation history summarization, and context windowing to ensure no messages are lost due to context overflow.

### Success Metrics
- **Zero Skipped Messages**: 100% of user messages successfully processed regardless of length
- **Response Quality**: Maintain conversation coherence across context window boundaries
- **Latency**: Keep response time under 10 seconds for 95th percentile requests
- **Storage Efficiency**: Reduce session storage growth by 60% through intelligent summarization

### Technical Stack
- **Language**: TypeScript (user preference)
- **Package Manager**: bun (user requirement)
- **Runtime**: Bun
- **Framework**: Hono (existing)
- **Core Dependencies**: No new dependencies required (use built-in utilities)

### Timeline Estimate
**Total: 8-12 hours** across 6 stories (1-2 hours each, completable in single context windows)

### Resource Requirements
- **Developer**: 1 TypeScript engineer familiar with LLM context management
- **Testing Environment**: Claude Code CLI access for integration testing
- **Review**: Code review from project maintainer

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Synology Chat Bridge                      │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │   Webhook   │───▶│ Input Chunk  │───▶│  Session Mgr  │  │
│  │  Receiver   │    │   Handler    │    │  (Enhanced)   │  │
│  └─────────────┘    └──────────────┘    └───────────────┘  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Claude Code Executor                       │
│  ┌──────────────┐    ┌──────────────┐   ┌────────────────┐ │
│  │   Context    │───▶│ Claude CLI   │──▶│    Output      │ │
│  │   Manager    │    │   Spawner    │   │   Chunker      │ │
│  │  (NEW)       │    │              │   │  (Enhanced)    │ │
│  └──────────────┘    └──────────────┘   └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow
1. **Input Processing**: Long messages chunked before Claude execution
2. **Context Management**: Conversation history summarized when approaching limits
3. **Execution**: Claude processes with managed context window
4. **Output Processing**: Long responses chunked for Synology Chat delivery
5. **Session Update**: Context state persisted for next interaction

### Technology Decisions

**No External Dependencies**
**Justification**: Context chunking and text manipulation can be handled with TypeScript built-ins, avoiding dependency bloat and potential security issues.

**Semantic Chunking Algorithm**
**Justification**: Break text at natural boundaries (paragraphs, sentences) rather than character counts for better comprehension.

**Rolling Summarization Strategy**
**Justification**: Summarize older messages while keeping recent ones verbatim to maintain context coherence with bounded memory.

**Token Estimation Heuristic**
**Justification**: Use 4 chars ≈ 1 token approximation (conservative for Claude) to avoid expensive tokenizer dependencies.

### Infrastructure Requirements
- **Storage**: No change to existing file-based session storage
- **Hosting**: No change to existing deployment model
- **Scaling**: Context management is stateless and scales with existing architecture

### Security Architecture
- **Input Validation**: Sanitize chunked inputs to prevent injection attacks
- **Session Isolation**: Context management maintains existing session boundaries
- **Data Privacy**: Summarization happens in-memory; no external API calls

### Integration Points
- **Claude Code CLI**: Pass managed context via stdin
- **Session Manager**: Enhanced to store context state (summarization metadata)
- **Bridge Webhook**: Add chunking layer before executor forwarding

---

## Feature Breakdown

### User Stories

#### Story 1: Input Message Chunking Foundation
**As a** bridge developer
**I want** long input messages chunked intelligently
**So that** Claude can process messages exceeding the context window

**Functional Requirements:**
- Create `InputChunker` utility class in `src/utils/input-chunker.ts`
- Implement semantic chunking algorithm (break at paragraph/sentence boundaries)
- Support max chunk size of 15,000 characters (≈3,750 tokens, conservative)
- Preserve markdown formatting across chunks
- Handle edge cases (no natural breaks, code blocks, lists)

**Non-Functional Requirements:**
- Chunking latency: <50ms for 100KB input
- Zero data loss during chunking
- Deterministic chunking (same input → same chunks)

**Acceptance Criteria:**
- [ ] `InputChunker` class accepts text and returns array of chunks
- [ ] Chunks break at paragraph boundaries when possible
- [ ] Chunks fall back to sentence boundaries if paragraphs too large
- [ ] Code blocks (```) never split mid-block
- [ ] Maximum chunk size enforced (15,000 chars)
- [ ] Unit tests cover: normal text, edge cases, markdown preservation

**Dependencies:** None

**Estimated Time:** 1.5 hours

---

#### Story 2: Multi-Chunk Execution Pipeline
**As a** executor service
**I want** to process multiple input chunks sequentially
**So that** Claude receives the full message across multiple prompts

**Functional Requirements:**
- Enhance `runClaude()` in `claude-runner.ts` to support multi-prompt execution
- Execute chunks sequentially using same Claude session
- First chunk: normal execution
- Subsequent chunks: continuation with "Here's more of the input: [chunk]"
- Aggregate outputs from all chunks into single response
- Track chunk execution in session metadata

**Non-Functional Requirements:**
- Total execution time: linear with chunk count (no excessive overhead)
- Session continuity maintained across chunks
- Error handling: if chunk N fails, return partial results + error

**Acceptance Criteria:**
- [ ] `runClaude()` accepts optional `chunks: string[]` parameter
- [ ] Single chunk: executes normally (backward compatible)
- [ ] Multiple chunks: executes sequentially with same session ID
- [ ] Outputs aggregated into single response
- [ ] Session ID preserved across all chunks
- [ ] Error mid-chunking returns partial success + error message

**Dependencies:** Story 1 (InputChunker)

**Estimated Time:** 2 hours

---

#### Story 3: Context Window Estimation
**As a** session manager
**I want** to estimate total context window usage
**So that** I know when to trigger summarization

**Functional Requirements:**
- Create `ContextEstimator` utility in `src/utils/context-estimator.ts`
- Implement token estimation: 4 chars ≈ 1 token (conservative)
- Calculate total context from: system prompt + history + current prompt
- Define context limits: 180,000 tokens max (Claude 3.7 Sonnet limit)
- Define soft limit trigger: 120,000 tokens (67% threshold for summarization)
- Add context metadata to `SessionData` type

**Non-Functional Requirements:**
- Estimation accuracy: ±10% of actual token count
- Calculation latency: <10ms for 100KB text
- Thread-safe for concurrent session access

**Acceptance Criteria:**
- [ ] `ContextEstimator.estimate(text)` returns token count
- [ ] `ContextEstimator.calculateTotal(session)` returns total context usage
- [ ] Soft limit constant: `CONTEXT_SOFT_LIMIT = 120000`
- [ ] Hard limit constant: `CONTEXT_HARD_LIMIT = 180000`
- [ ] `SessionData` type includes: `estimated_tokens`, `needs_summarization` flag
- [ ] Unit tests validate estimation within ±10% margin

**Dependencies:** None

**Estimated Time:** 1 hour

---

#### Story 4: Conversation History Summarization
**As a** context manager
**I want** to summarize older conversation history
**So that** sessions stay within context limits

**Functional Requirements:**
- Create `HistorySummarizer` in `src/utils/history-summarizer.ts`
- Implement rolling summarization strategy:
  - Keep last 5 messages verbatim (recent context)
  - Summarize messages 6-20 into "conversation summary"
  - Discard messages 21+ after incorporating into summary
- Use Claude itself to generate summaries via one-shot prompt
- Store summary in session metadata
- Trigger summarization when `needs_summarization = true`

**Non-Functional Requirements:**
- Summarization latency: <5 seconds for 20-message history
- Summary compression: Reduce tokens by 60-80%
- Summary quality: Preserve key context and user preferences

**Summarization Prompt Template:**
```
Summarize this conversation history concisely, preserving:
- User's stated goals/preferences
- Key decisions made
- Important context for future messages

History:
{older_messages}

Summary (200 words max):
```

**Acceptance Criteria:**
- [ ] `HistorySummarizer.summarize(messages)` returns condensed summary
- [ ] Last 5 messages always kept verbatim
- [ ] Messages 6-20 summarized using Claude
- [ ] Summary stored in `SessionData.conversation_summary` field
- [ ] Token reduction: 60% minimum for typical conversations
- [ ] Integration test: summarize 20-message history successfully

**Dependencies:** Story 3 (ContextEstimator)

**Estimated Time:** 2 hours

---

#### Story 5: Context Manager Integration
**As a** executor service
**I want** context managed automatically before Claude execution
**So that** sessions never exceed context limits

**Functional Requirements:**
- Create `ContextManager` in `src/context-manager.ts`
- Orchestrate chunking and summarization before Claude execution
- Workflow:
  1. Load session data
  2. Estimate current context usage
  3. If > soft limit: trigger summarization
  4. If input > chunk limit: trigger chunking
  5. Execute with managed context
  6. Update session with new context state
- Integrate into `server.ts` `/execute` endpoint

**Non-Functional Requirements:**
- Zero user-facing changes (transparent operation)
- Graceful degradation: if summarization fails, continue with warning
- Atomic session updates (no partial state corruption)

**API Design:**
```typescript
interface ContextManagerOptions {
  sessionId: string;
  prompt: string;
  userName: string;
}

interface ManagedExecutionResult {
  success: boolean;
  output: string;
  sessionId: string;
  contextState: {
    estimatedTokens: number;
    wasChunked: boolean;
    wasSummarized: boolean;
  };
  error?: string;
}

class ContextManager {
  async execute(options: ContextManagerOptions): Promise<ManagedExecutionResult>
}
```

**Acceptance Criteria:**
- [ ] `ContextManager.execute()` handles full workflow
- [ ] Automatic summarization when context > 120K tokens
- [ ] Automatic chunking when input > 15K chars
- [ ] Session updated with new context state
- [ ] `/execute` endpoint uses `ContextManager` instead of direct `runClaude()`
- [ ] Backward compatibility: existing sessions work without migration

**Dependencies:** Stories 1-4 (all utilities)

**Estimated Time:** 2 hours

---

#### Story 6: Enhanced Output Chunking
**As a** bridge service
**I want** improved output chunking for long Claude responses
**So that** Synology Chat receives well-formatted message chunks

**Functional Requirements:**
- Enhance existing output chunking in `bridge/src/executor-client.ts`
- Current: 3,500 char max chunks (good, keep this)
- Improvement: Add semantic chunking (prefer paragraph breaks)
- Improvement: Add chunk indicators: "[1/3]", "[2/3]", "[3/3]"
- Improvement: Preserve code block formatting across chunks
- Send chunks with 500ms delay between (avoid chat flooding)

**Non-Functional Requirements:**
- Chunk delivery latency: 500ms between chunks (user-perceivable pacing)
- Formatting preservation: code blocks, lists, headings intact
- Error handling: if chunk N fails, continue with N+1

**Acceptance Criteria:**
- [ ] Output chunker breaks at paragraph boundaries when possible
- [ ] Chunk indicators added: "[1/N]" at start of each chunk
- [ ] Code blocks never split mid-block
- [ ] 500ms delay between chunk sends (use `setTimeout`)
- [ ] Existing 3,500 char limit preserved
- [ ] Integration test: send 15KB response successfully

**Dependencies:** None (independent enhancement)

**Estimated Time:** 1.5 hours

---

## Implementation Checklists

### Development Checklist (Per Story)
- [ ] Create feature branch: `feature/context-chunking-story-N`
- [ ] Implement core functionality
- [ ] Write unit tests (minimum 80% coverage)
- [ ] Update TypeScript types in `src/types.ts`
- [ ] Test locally with Claude Code CLI
- [ ] Run integration tests
- [ ] Update inline code documentation
- [ ] Create PR with story acceptance criteria in description

### Testing Checklist (Per Story)
- [ ] Unit tests: all edge cases covered
- [ ] Integration test: story works end-to-end
- [ ] Performance test: meets non-functional requirements
- [ ] Error handling: graceful degradation verified
- [ ] Backward compatibility: existing sessions unaffected

### Security Checklist (Per Story)
- [ ] Input validation: no injection vulnerabilities
- [ ] Error messages: no sensitive data leakage
- [ ] Session isolation: no cross-session data leakage
- [ ] Rate limiting: existing limits respected

### Performance Checklist (Per Story)
- [ ] Latency: meets story requirements
- [ ] Memory: no unbounded growth
- [ ] CPU: no blocking operations in hot path
- [ ] Storage: session data size reasonable (<100KB/session)

### Documentation Checklist (Per Story)
- [ ] Inline code comments for complex logic
- [ ] JSDoc for public APIs
- [ ] README update (if user-facing changes)
- [ ] Type definitions updated

### Deployment Checklist (All Stories)
- [ ] All stories merged to main
- [ ] Version bumped in `package.json`
- [ ] CHANGELOG.md updated with new features
- [ ] Docker images rebuilt (if applicable)
- [ ] Deployment tested in staging environment
- [ ] Rollback plan documented
- [ ] Production deployment executed
- [ ] Monitoring: verify zero skipped messages

---

## API Specifications

### New Types (src/types.ts)

```typescript
// Context management types
export interface ContextState {
  estimated_tokens: number;
  needs_summarization: boolean;
  conversation_summary?: string;
  last_summarization?: string; // ISO timestamp
  chunk_count?: number; // for current execution
}

// Enhanced session data
export interface SessionData {
  session_id: string;
  claude_session_id?: string;
  user_name: string;
  created_at: string;
  last_activity: string;
  message_count: number;
  context_state?: ContextState; // NEW
}

// Execution options
export interface ManagedExecutionOptions {
  session_id: string;
  prompt: string;
  user_name: string;
  claudeSessionId?: string;
}

// Execution result
export interface ManagedExecutionResult {
  success: boolean;
  output: string;
  sessionId?: string;
  contextState: ContextState;
  error?: string;
}
```

### InputChunker API (src/utils/input-chunker.ts)

```typescript
export interface ChunkOptions {
  maxChunkSize?: number; // default: 15000
  preserveCodeBlocks?: boolean; // default: true
}

export class InputChunker {
  /**
   * Chunk text at semantic boundaries
   * @param text - Input text to chunk
   * @param options - Chunking options
   * @returns Array of text chunks
   */
  static chunk(text: string, options?: ChunkOptions): string[];

  /**
   * Check if text needs chunking
   * @param text - Input text
   * @param maxSize - Max chunk size (default: 15000)
   * @returns True if text exceeds max size
   */
  static needsChunking(text: string, maxSize?: number): boolean;
}
```

### ContextEstimator API (src/utils/context-estimator.ts)

```typescript
export const CONTEXT_SOFT_LIMIT = 120000; // tokens
export const CONTEXT_HARD_LIMIT = 180000; // tokens
export const CHARS_PER_TOKEN = 4; // conservative estimate

export class ContextEstimator {
  /**
   * Estimate token count from text
   * @param text - Input text
   * @returns Estimated token count
   */
  static estimate(text: string): number;

  /**
   * Calculate total context usage for session
   * @param session - Session data
   * @param newPrompt - New prompt to add
   * @returns Total estimated tokens
   */
  static calculateTotal(session: SessionData, newPrompt: string): number;

  /**
   * Check if summarization needed
   * @param totalTokens - Total estimated tokens
   * @returns True if exceeds soft limit
   */
  static needsSummarization(totalTokens: number): boolean;
}
```

### HistorySummarizer API (src/utils/history-summarizer.ts)

```typescript
export interface SummarizationResult {
  summary: string;
  tokensSaved: number;
  messagesProcessed: number;
}

export class HistorySummarizer {
  /**
   * Summarize conversation history using Claude
   * @param messages - Full message history
   * @param existingSummary - Previous summary to incorporate
   * @returns Summarization result
   */
  static async summarize(
    messages: string[],
    existingSummary?: string
  ): Promise<SummarizationResult>;

  /**
   * Build condensed history (summary + recent messages)
   * @param session - Session data
   * @returns Condensed history string
   */
  static buildCondensedHistory(session: SessionData): string;
}
```

### ContextManager API (src/context-manager.ts)

```typescript
export class ContextManager {
  /**
   * Execute Claude with managed context
   * @param options - Execution options
   * @returns Managed execution result
   */
  async execute(options: ManagedExecutionOptions): Promise<ManagedExecutionResult>;

  /**
   * Manually trigger summarization for session
   * @param sessionId - Session ID
   * @returns True if summarization succeeded
   */
  async forceSummarization(sessionId: string): Promise<boolean>;
}
```

---

## Database Schema

### Session Storage Changes

**File Location:** `${PAI_DIR}/integrations/synology-chat/sessions/<session_id>.json`

**Enhanced Schema:**
```json
{
  "session_id": "channel_123_user_456",
  "claude_session_id": "abc-def-ghi",
  "user_name": "Luke",
  "created_at": "2026-01-20T10:00:00.000Z",
  "last_activity": "2026-01-20T10:15:00.000Z",
  "message_count": 15,
  "context_state": {
    "estimated_tokens": 85000,
    "needs_summarization": false,
    "conversation_summary": "User is working on privacy blog post...",
    "last_summarization": "2026-01-20T10:10:00.000Z",
    "chunk_count": 0
  }
}
```

**Migration Strategy:** Backward compatible (context_state is optional)

**Storage Growth:** Summarization reduces growth rate by 60%, typical session <50KB

---

## Security Specifications

### Input Validation
- **Max Input Size:** 1MB (reject larger inputs with error)
- **Chunk Validation:** Sanitize each chunk before Claude execution
- **Injection Prevention:** Escape special characters in user input

### Session Security
- **Isolation:** Context state scoped to session ID (no cross-contamination)
- **Data Retention:** Session cleanup unchanged (30-minute timeout)
- **Sensitive Data:** No PII stored in summaries (rely on Claude's handling)

### Error Handling
- **Graceful Degradation:** If summarization fails, log warning and continue
- **Error Messages:** Generic messages to users, detailed logs server-side
- **Rate Limiting:** Respect existing rate limits (no bypass)

---

## Performance Criteria

### Latency Targets
- **Input Chunking:** <50ms for 100KB input
- **Context Estimation:** <10ms per calculation
- **Summarization:** <5 seconds for 20-message history
- **Total E2E:** <10 seconds (95th percentile) for chunked + summarized execution

### Resource Limits
- **Memory:** Context manager stateless (no caching)
- **CPU:** Chunking/estimation in main thread (fast operations)
- **Storage:** Session data capped at 100KB per session

### Scalability
- **Concurrent Sessions:** No change (existing queue handles this)
- **Long Sessions:** Bounded growth via summarization
- **High Message Volume:** Linear scaling with existing architecture

---

## Integration Details

### Claude Code CLI Integration
**Command Template (with context management):**
```bash
claude -p \
  --continue <session_id> \
  --output-format json \
  --allowedTools Read,Grep,Glob,Edit,Write \
  --append-system-prompt "Context managed. Recent history: {summary}"
```

### Synology Bridge Integration
**Changes to `/webhook` endpoint:**
1. Input validation: check message size
2. If large: return early with "Processing..." indicator
3. Forward to executor (context management transparent)
4. Receive chunked output and forward to chat

### Executor Service Integration
**Changes to `/execute` endpoint:**
1. Replace `runClaude()` call with `ContextManager.execute()`
2. Add context state to response JSON
3. Log context metrics for monitoring

---

## Third-Party Dependencies

**None Required** - All functionality implemented using:
- TypeScript standard library
- Node.js built-ins (fs, path, child_process)
- Existing dependencies (Hono for HTTP)

**Rationale:** Minimizes attack surface, reduces bundle size, simplifies deployment

---

## Risk Assessment & Mitigation

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Summarization degrades context quality | Medium | High | Keep last 5 messages verbatim; iterate on summary prompt |
| Token estimation inaccurate | Medium | Medium | Use conservative 4 chars/token; monitor actual usage |
| Chunking breaks complex formatting | Low | Medium | Test with markdown, code blocks; handle edge cases |
| Performance regression on latency | Low | Medium | Benchmark each story; optimize hot paths |

### Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Summarization adds latency | High | Low | Async summarization; return immediately if not urgent |
| Session storage grows unbounded | Low | High | Enforce summarization; monitor storage usage |
| Breaking change for existing sessions | Low | High | Backward compatible schema; gradual migration |

### Security Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Prompt injection via chunked input | Medium | High | Sanitize inputs; validate chunk boundaries |
| Context leakage between sessions | Low | Critical | Maintain strict session isolation; add validation |
| DoS via massive inputs | Medium | Medium | Enforce 1MB max input size; rate limit |

---

## Testing Strategy

### Unit Testing
- **Coverage Target:** 80% minimum per file
- **Framework:** Bun's built-in test runner
- **Scope:** Each utility class (InputChunker, ContextEstimator, etc.)
- **Test Files:** Co-located `*.test.ts` files

### Integration Testing
- **Scope:** Full context management workflow
- **Test Cases:**
  - Long input → chunked execution → aggregated output
  - Context over limit → summarization → continued conversation
  - Error during chunking → graceful degradation
- **Environment:** Local Claude Code CLI required

### Performance Testing
- **Tools:** Simple benchmarking scripts
- **Metrics:** Latency (p50, p95, p99), memory usage
- **Scenarios:** 100KB input, 20-message history, concurrent executions

### Acceptance Testing
- **User Scenarios:**
  - Send 50KB message → verify no skipping
  - Conduct 50-message conversation → verify context maintained
  - Test output chunking with 20KB response

---

## Deployment Plan

### Story-by-Story Deployment
1. **Stories 1-4:** Deploy to development branch (no user impact)
2. **Story 5:** Deploy to staging for integration testing
3. **Story 6:** Deploy all stories to production

### Rollback Strategy
- **Git:** Each story in separate commit for easy revert
- **Feature Flag:** Add `ENABLE_CONTEXT_MANAGEMENT` env var (default: true)
- **Monitoring:** Track error rates, latency, context overflow events

### Monitoring & Alerting
- **Metrics to Track:**
  - Messages chunked (count, avg chunk size)
  - Sessions summarized (count, token reduction)
  - Context overflow events (should be zero)
  - Execution latency (p95)
- **Alerts:**
  - Error rate >5% → page on-call
  - Context overflow detected → investigate immediately
  - Latency p95 >15s → review performance

---

## Success Criteria

### Functional Success
- ✅ Zero skipped messages (100% delivery rate)
- ✅ Context overflow events eliminated
- ✅ Conversation coherence maintained across windows

### Performance Success
- ✅ p95 latency <10s (with chunking/summarization)
- ✅ Session storage growth <30% over baseline
- ✅ No memory leaks or unbounded growth

### Quality Success
- ✅ 80% unit test coverage achieved
- ✅ All integration tests passing
- ✅ Zero critical bugs in first 7 days post-deployment

### User Success
- ✅ No user-reported message skipping after deployment
- ✅ Response quality remains high (subjective, monitor feedback)
- ✅ Transparent operation (users unaware of context management)

---

## Appendix

### Story Dependencies Graph

```
Story 1 (InputChunker)
   │
   ├──▶ Story 2 (Multi-Chunk Execution)
   │       │
   │       └──▶ Story 5 (Context Manager Integration)
   │
Story 3 (ContextEstimator)
   │
   └──▶ Story 4 (Summarization)
           │
           └──▶ Story 5 (Context Manager Integration)

Story 6 (Output Chunking) ─── (independent)
```

### Recommended Implementation Order
1. **Story 3** (ContextEstimator) - Foundation, no dependencies
2. **Story 1** (InputChunker) - Independent utility
3. **Story 4** (Summarization) - Depends on Story 3
4. **Story 2** (Multi-Chunk Execution) - Depends on Story 1
5. **Story 5** (Context Manager Integration) - Depends on Stories 1-4
6. **Story 6** (Output Chunking) - Independent, can run in parallel

### Development Timeline
| Story | Estimated Hours | Dependencies | Can Start After |
|-------|----------------|--------------|-----------------|
| 3 (Estimator) | 1h | None | Immediately |
| 1 (Chunker) | 1.5h | None | Immediately |
| 4 (Summarization) | 2h | Story 3 | Story 3 complete |
| 2 (Multi-Chunk) | 2h | Story 1 | Story 1 complete |
| 5 (Integration) | 2h | Stories 1-4 | All utilities complete |
| 6 (Output) | 1.5h | None | Immediately |

**Total Parallel Path:** 6 hours (Stories 3→4→5, then Story 6)
**Total Serial Path:** 10 hours (all stories sequentially)

### Key Assumptions
- Claude Code CLI supports `--continue` for session continuity (verified: yes)
- 4 chars/token estimation is conservative enough (standard heuristic)
- Summarization via Claude itself is acceptable (no external summarizer needed)
- Bun runtime supports all required Node.js APIs (verified: yes)

### Open Questions
- **Q:** Should summarization be synchronous or async?
  **A:** Synchronous for MVP (simpler), async optimization in future iteration

- **Q:** How to handle multi-modal inputs (images, files)?
  **A:** Out of scope for MVP; text-only chunking sufficient for current use case

- **Q:** Should we expose context state to users via `/status` command?
  **A:** Yes, add to Story 5 acceptance criteria: show tokens used, summarization status

---

## Document Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-20 | Atlas | Initial PRD creation |

---

**PRD Status:** ✅ Ready for Implementation
**Next Step:** Review with stakeholder, then begin Story 3 (ContextEstimator)
**Questions:** Contact Atlas or project maintainer
