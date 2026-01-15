# Obsidian Claude Code - RAG 시스템 아키텍처

## 개요

Obsidian vault의 전체 파일 내용을 컨텍스트에 넣는 대신, 관련 청크만 검색하여 토큰 효율성을 높이는 RAG(Retrieval Augmented Generation) 시스템.

## 생태계 분석 결과

### 기존 플러그인 현황

| 플러그인 | 임베딩 | 스토리지 | 청킹 | 특징 |
|---------|--------|---------|------|------|
| Smart Connections | BGE-micro-v2 (384d) | JSON → IndexedDB 이전중 | 블록 기반 | 로컬 우선, 100+ API 지원 |
| Copilot | nomic-embed-text | IndexedDB | 미공개 | Ollama 통합, 하이브리드 검색 |
| Omnisearch | N/A (BM25) | 메모리 | N/A | 키워드 검색, 플러그인 API 있음 |

### 핵심 인사이트

1. **스토리지**: JSON → IndexedDB 진화 추세
2. **임베딩**: 로컬(Ollama) 우선, 클라우드 옵션
3. **청킹**: 헤딩 기반이 가장 인기 (문서 구조 존중)
4. **API**: 버전화된 글로벌 API 패턴 (`window["plugin.api.v1"]`)

---

## 아키텍처 설계

### 컴포넌트 구조

```
src/rag/
├── EmbeddingService.ts      # 임베딩 생성 (Ollama/OpenAI)
├── VectorStore.ts           # IndexedDB 벡터 저장소
├── MarkdownChunker.ts       # 마크다운 청킹
├── RAGOrchestrator.ts       # 검색 오케스트레이션
├── types.ts                 # RAG 타입 정의
└── index.ts                 # 모듈 export
```

### 데이터 흐름

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Markdown   │────▶│   Chunker    │────▶│  Embedding  │
│    File     │     │ (헤딩 기반)   │     │   Service   │
└─────────────┘     └──────────────┘     └─────────────┘
                                                │
                                                ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Claude    │◀────│     RAG      │◀────│  IndexedDB  │
│   Query     │     │ Orchestrator │     │Vector Store │
└─────────────┘     └──────────────┘     └─────────────┘
```

---

## 기술 스택

### 1. 임베딩 모델

**기본값: Ollama + nomic-embed-text**

| 모델 | 차원 | 컨텍스트 | 특징 |
|------|-----|---------|------|
| nomic-embed-text | 768 | 8192 토큰 | 높은 정확도, Matryoshka 지원 |
| BGE-micro-v2 | 384 | 512 토큰 | 빠름, 가벼움 |
| mxbai-embed-large | 1024 | - | 최고 정확도 |

```typescript
interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  batchEmbed(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
}
```

### 2. 벡터 스토리지

**IndexedDB 사용 (Copilot 검증됨)**

장점:
- 브라우저 네이티브, 파일시스템 오버헤드 없음
- 비동기 트랜잭션
- 대용량 데이터 지원

```typescript
interface VectorRecord {
  id: string;              // "파일경로#청크인덱스"
  file: string;            // 파일 경로
  chunkIndex: number;      // 청크 순서
  content: string;         // 청크 내용
  embedding: number[];     // 임베딩 벡터
  metadata: {
    headings: string[];    // 부모 헤딩들
    tags: string[];        // 노트 태그
    modified: number;      // 수정 시간
  };
}
```

### 3. 청킹 전략

**기본값: 헤딩 기반 + 스마트 폴백**

```typescript
interface ChunkConfig {
  strategy: 'heading' | 'fixed' | 'smart';
  maxSize: number;      // 기본값: 512 토큰
  overlap: number;      // 기본값: 50 토큰
}
```

**헤딩 기반 청킹:**
```markdown
# 제목 1        → 청크 1
내용...

## 제목 2       → 청크 2
내용...

### 제목 2.1    → 청크 3
내용...
```

**스마트 폴백** (청크가 너무 크면):
1. 문단 경계로 분할
2. 줄바꿈 경계로 분할
3. 문장 경계로 분할

---

## 설정 인터페이스

```typescript
interface RAGSettings {
  // 활성화
  enableRAG: boolean;

  // 임베딩
  embeddingProvider: 'ollama' | 'openai' | 'voyage';
  ollamaUrl: string;           // default: "http://localhost:11434"
  ollamaModel: string;         // default: "nomic-embed-text"
  openaiApiKey?: string;

  // 청킹
  chunkStrategy: 'heading' | 'fixed' | 'smart';
  chunkSize: number;           // default: 512
  chunkOverlap: number;        // default: 50

  // 검색
  topK: number;                // default: 5
  similarityThreshold: number; // default: 0.7
  useHybridSearch: boolean;    // default: true

  // 인덱싱
  autoIndex: boolean;          // 파일 변경 시 자동
  excludeFolders: string[];    // 제외할 폴더
}
```

---

## MCP 도구 통합

Claude가 직접 RAG를 호출할 수 있도록 SDK MCP 도구 추가:

```typescript
// ObsidianMcpServer.ts에 추가

tool(
  "semantic_search",
  "Search vault using semantic similarity. Returns relevant note chunks.",
  {
    query: z.string().describe("Search query"),
    topK: z.number().optional().describe("Number of results (default: 5)"),
    folder: z.string().optional().describe("Limit search to folder"),
  },
  async (args) => {
    const results = await ragOrchestrator.search(args.query, {
      topK: args.topK ?? 5,
      folder: args.folder,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(results, null, 2)
      }]
    };
  }
),

tool(
  "get_related_notes",
  "Find notes semantically related to current file or query.",
  {
    path: z.string().optional().describe("Note path (default: active file)"),
    topK: z.number().optional().describe("Number of results"),
  },
  async (args) => {
    const file = args.path
      ? app.vault.getAbstractFileByPath(args.path)
      : app.workspace.getActiveFile();

    if (!file) return { content: [{ type: "text", text: "No file found" }] };

    const content = await app.vault.read(file);
    const related = await ragOrchestrator.findRelated(content, args.topK ?? 5);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(related, null, 2)
      }]
    };
  }
),

tool(
  "rebuild_rag_index",
  "Rebuild the RAG semantic index for the vault.",
  {
    force: z.boolean().optional().describe("Force full rebuild"),
  },
  async (args) => {
    const stats = await ragOrchestrator.reindex(args.force);
    return {
      content: [{
        type: "text",
        text: `Indexed ${stats.files} files, ${stats.chunks} chunks`
      }]
    };
  }
)
```

---

## 구현 단계

### Phase 1: 기본 RAG (MVP)

**범위:**
- Ollama 로컬 임베딩 (nomic-embed-text)
- 헤딩 기반 청킹
- IndexedDB 벡터 저장
- 코사인 유사도 검색
- 수동 인덱스 리빌드 명령

**예상 파일:**
```
src/rag/
├── EmbeddingService.ts   (~100 LOC)
├── VectorStore.ts        (~150 LOC)
├── MarkdownChunker.ts    (~100 LOC)
├── RAGOrchestrator.ts    (~200 LOC)
└── types.ts              (~50 LOC)
```

### Phase 2: 향상된 기능

- 클라우드 임베딩 옵션 (OpenAI, Voyage)
- 스마트 청킹 (문단 경계)
- 파일 변경 시 자동 인덱싱
- 하이브리드 검색 (시맨틱 + 키워드)
- Omnisearch 통합

### Phase 3: 고급 기능

- 플러그인 API 노출 (`window["claude-code.rag.v1"]`)
- Smart Connections 통합
- Dataview 쿼리 결합
- WASM 성능 최적화
- 배치 인덱싱 진행률 UI

---

## 대안: 기존 플러그인 통합

자체 구현 대신 Smart Connections/Copilot API 활용 가능:

**장점:**
- 개발 시간 단축
- 검증된 시스템 활용
- 중복 방지

**단점:**
- API 제한/변경 위험
- 의존성 증가
- SDK MCP 통합 어려움

**권장:** Phase 1은 자체 구현, Phase 2+에서 통합 고려

---

## 검증 체크리스트

### Phase 1 완료 조건
- [ ] Ollama 연동 테스트 (nomic-embed-text)
- [ ] IndexedDB 저장/검색 동작
- [ ] 헤딩 기반 청킹 검증
- [ ] "관련 노트 찾아줘" 쿼리 성공
- [ ] 인덱스 리빌드 명령 동작

### 성능 목표
- 인덱싱: 1000개 노트 < 5분
- 검색: < 500ms (topK=5)
- 스토리지: 노트당 평균 10KB 미만

---

## 참고 자료

- [Smart Connections GitHub](https://github.com/brianpetro/obsidian-smart-connections)
- [Copilot for Obsidian](https://github.com/logancyang/obsidian-copilot)
- [nomic-embed-text](https://ollama.com/library/nomic-embed-text)
- [Obsidian MetadataCache API](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache)
