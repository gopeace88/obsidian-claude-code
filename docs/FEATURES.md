# Obsidian Claude Code - 기능 문서

## 개요

Obsidian 볼트에 Claude AI 어시스턴트를 통합하는 플러그인. Claude Agent SDK를 사용하여 파일 읽기/쓰기, 시맨틱 검색, Obsidian 전용 도구를 제공한다.

---

## 핵심 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    Obsidian Plugin                       │
├─────────────────────────────────────────────────────────┤
│  ChatView (사이드바 UI)                                  │
│    ├── MessageList (메시지 렌더링)                       │
│    ├── ChatInput (입력 + 자동완성)                       │
│    └── ToolCallDisplay (도구 실행 표시)                  │
├─────────────────────────────────────────────────────────┤
│  AgentController (Claude Agent SDK 연동)                 │
│    ├── query() 함수로 Claude 호출                        │
│    ├── 내장 도구 (Read, Write, Bash, Grep 등)            │
│    └── MCP 서버 (Obsidian 전용 도구)                     │
├─────────────────────────────────────────────────────────┤
│  ConversationManager (대화 관리)                         │
│    ├── 대화 저장/로드                                    │
│    ├── 세션 ID 관리                                      │
│    └── 핀 파일 저장                                      │
├─────────────────────────────────────────────────────────┤
│  RAG System (시맨틱 검색)                                │
│    ├── Smart Connections 연동                            │
│    ├── Omnisearch 연동                                   │
│    └── Internal (Ollama/OpenAI 임베딩)                   │
├─────────────────────────────────────────────────────────┤
│  SkillManager (스킬 관리)                                │
│    ├── 스킬 목록/삭제                                    │
│    ├── URL로 설치                                        │
│    └── 프리셋 설치                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 1. 인증 시스템

### 지원 방식

| 방식 | 설정 위치 | 우선순위 |
|------|----------|----------|
| API Key (설정) | 플러그인 설정 | 1 (최우선) |
| ANTHROPIC_API_KEY | 환경변수 | 2 |
| CLAUDE_CODE_OAUTH_TOKEN | 환경변수 (Claude Max 구독) | 3 |

### Claude Max 구독 사용법
```bash
# 터미널에서 실행
claude setup-token

# macOS에서 GUI 앱 환경변수 설정
launchctl setenv CLAUDE_CODE_OAUTH_TOKEN "$(echo $CLAUDE_CODE_OAUTH_TOKEN)"
```

---

## 2. 채팅 UI

### 위치
- 오른쪽 사이드바 (Cursor 스타일)
- 리본 아이콘 또는 명령어로 열기

### 기능
- **메시지 렌더링**: Markdown 지원, 코드 하이라이팅
- **도구 호출 표시**: 접기/펼치기, 상태 표시 (성공/실패)
- **스트리밍**: 실시간 응답 표시
- **자동완성**: `@`로 파일, `/`로 명령어

### 자동완성 트리거
| 트리거 | 기능 |
|--------|------|
| `@` | 파일 검색 및 컨텍스트 추가 |
| `/` | 명령어 (미구현 예정) |

---

## 3. 대화 관리

### 저장 위치
```
vault/.obsidian-claude-code/conversations/
├── {conversation-id}.json
└── ...
```

### 기능
- **대화 목록**: 히스토리 모달에서 확인
- **대화 전환**: 드롭다운으로 선택
- **새 대화**: 버튼 클릭
- **대화 삭제**: 히스토리에서 삭제
- **자동 제목 생성**: Haiku 모델로 첫 메시지 기반 제목 생성

### 저장 데이터
```typescript
interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  history: MessageParam[];      // Claude API 형식
  displayMessages: ChatMessage[]; // UI 표시용
  pinnedFiles?: string[];       // 핀된 파일 경로
}
```

---

## 4. MCP 도구 (Obsidian 전용)

### 사용 가능한 도구

| 도구 | 설명 |
|------|------|
| `mcp__obsidian__get_active_file` | 현재 열린 파일 정보 (경로, 내용, 메타데이터) |
| `mcp__obsidian__open_file` | 파일을 Obsidian에서 열기 |
| `mcp__obsidian__create_note` | 새 노트 생성 |
| `mcp__obsidian__execute_command` | Obsidian 명령어 실행 |
| `mcp__obsidian__list_commands` | 사용 가능한 명령어 목록 |
| `mcp__obsidian__show_notice` | 알림 표시 |
| `mcp__obsidian__reveal_in_explorer` | 파일 탐색기에서 표시 |
| `mcp__obsidian__get_vault_stats` | 볼트 통계 (파일 수, 크기 등) |
| `mcp__obsidian__get_recent_files` | 최근 수정된 파일 목록 |
| `mcp__obsidian__rebuild_vault_index` | 검색 인덱스 재구축 |

### SDK 내장 도구
- Read, Write, Edit (파일 조작)
- Bash (명령어 실행)
- Glob, Grep (파일 검색)
- Task (서브에이전트)

---

## 5. RAG 시스템 (시맨틱 검색)

### 하이브리드 아키텍처

```
요청 → Provider Priority 확인
       ↓
  ┌────────────────┐
  │ Smart          │ → 설치됨? → API 호출 → 결과
  │ Connections    │
  └────────────────┘
       ↓ (실패/미설치)
  ┌────────────────┐
  │ Omnisearch     │ → 설치됨? → API 호출 → 결과
  └────────────────┘
       ↓ (실패/미설치)
  ┌────────────────┐
  │ Internal       │ → Ollama/OpenAI 임베딩 → 결과
  └────────────────┘
```

### Provider 우선순위 설정
- `Smart Connections → Omnisearch → Internal`
- `Omnisearch → Internal`
- `Internal only`

### MCP 도구로 노출

| 도구 | 설명 |
|------|------|
| `mcp__obsidian__semantic_search` | 시맨틱 검색 실행 |
| `mcp__obsidian__get_rag_stats` | RAG 상태 확인 (provider, 인덱스 상태) |

### Internal Provider 설정
- **Ollama**: 로컬 임베딩 (nomic-embed-text 등)
- **OpenAI**: 클라우드 임베딩 (text-embedding-3-small)
- **청킹 전략**: heading, fixed, smart

---

## 6. 스킬 시스템

### 스킬 위치
```
vault/.claude/skills/
├── obsidian-markdown.md
├── obsidian-bases.md
├── json-canvas.md
└── custom-skill.md
```

### 스킬 구조
```markdown
---
name: skill-name
description: 스킬 설명 (Claude가 언제 사용할지 판단)
---

# 스킬 내용
...
```

### 설정 UI 기능
- **설치된 스킬 목록**: 이름, 설명, 삭제 버튼
- **URL로 설치**: GitHub blob/raw URL
- **프리셋 설치**: Kepano's Obsidian Skills (3개)

### 포함된 프리셋 스킬
| 스킬 | 용도 |
|------|------|
| obsidian-markdown.md | Obsidian Flavored Markdown 작성 |
| obsidian-bases.md | Obsidian Bases (데이터베이스) |
| json-canvas.md | Canvas 파일 생성 |

### 작동 방식
1. SDK가 `.claude/skills/` 폴더 스캔
2. 스킬 내용을 시스템 컨텍스트에 포함
3. Claude가 description 기반으로 관련 스킬 자동 참조

---

## 7. 권한 시스템

### 설정 옵션

| 설정 | 기본값 | 설명 |
|------|--------|------|
| Auto-approve vault reads | true | 파일 읽기 자동 승인 |
| Auto-approve vault writes | false | 파일 쓰기 자동 승인 |
| Require approval for commands | true | Bash 명령어 승인 필요 |

### Always Allowed Tools
- 한번 승인한 도구 영구 허용
- 설정에서 제거 가능

### 권한 모달
- 도구 이름, 설명, 입력 표시
- 위험도 표시 (Low/Medium/High)
- "Always allow this tool" 옵션

---

## 8. 모델 선택

| 모델 | 용도 |
|------|------|
| Sonnet | 기본값, 빠르고 균형잡힌 성능 |
| Opus | 복잡한 작업, 높은 품질 |
| Haiku | 빠른 응답, 간단한 작업 (제목 생성 등) |

---

## 9. 에이전트 설정

| 설정 | 기본값 | 설명 |
|------|--------|------|
| Max budget per session | $10.00 | 세션당 최대 비용 |
| Max turns per query | 50 | 쿼리당 최대 턴 수 |

---

## 10. 파일 컨텍스트 (노트 핀)

### 기능
- `@파일명`으로 파일을 컨텍스트에 추가
- 핀된 파일은 모든 쿼리에 포함
- 대화별로 핀 상태 저장

### UI
- 입력창 위에 핀된 파일 칩 표시
- X 버튼으로 제거

---

## 11. 기술 스택

### 의존성
- `obsidian` - Obsidian API
- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK
- `zod` - 스키마 검증

### 빌드
- `bun` - 패키지 매니저
- `esbuild` - 번들러
- `TypeScript` - 타입 체크

### 플랫폼 지원
- **Windows**: cmd.exe를 통한 MCP 서버 실행 (패치 적용)
- **macOS/Linux**: 기본 지원

---

## 12. 디버깅

### 로그 위치
```
~/.obsidian-claude-code/debug.log
```

### 로그 확인
```bash
tail -f ~/.obsidian-claude-code/debug.log
```

### 로그 컴포넌트
- `[Plugin]` - 플러그인 라이프사이클
- `[ChatView]` - UI, 메시지 처리
- `[AgentController]` - SDK 쿼리, 도구 실행
- `[ConversationManager]` - 저장/로드
- `[SkillManager]` - 스킬 관리
- `[RAGManager]` - 시맨틱 검색

---

## 사용 시나리오

### 1. 기본 질문/답변
```
"Obsidian의 데일리 노트 기능 설명해줘"
→ Claude가 일반 지식으로 답변
```

### 2. 볼트 검색 + 분석
```
"내 볼트에서 '프로젝트' 관련 노트 찾아서 요약해줘"
→ RAG 검색 → 노트 읽기 → 요약 생성
```

### 3. 노트 생성
```
"오늘 회의 노트 만들어줘"
→ obsidian-markdown 스킬 참조 → Obsidian 문법으로 생성
```

### 4. 캔버스 생성
```
"이 주제로 마인드맵 캔버스 만들어줘"
→ json-canvas 스킬 참조 → .canvas 파일 생성
```

### 5. 볼트 종합 분석
```
"최근 1주일 노트들의 공통 주제 분석해줘"
→ 최근 파일 목록 → 각 파일 읽기 → 분석 결과
```

### 6. 자동화 작업
```
"모든 회의록에서 액션 아이템 추출해서 새 노트로 만들어줘"
→ 검색 → 읽기 → 추출 → 생성
```

---

## 향후 확장 가능 영역

1. ~~**시각화**: Mermaid 다이어그램 자동 생성~~ ✅ 구현됨
2. ~~**템플릿 연동**: Templater 플러그인 통합~~ ✅ 구현됨
3. ~~**태스크 관리**: Tasks 플러그인 연동~~ ✅ 구현됨
4. ~~**백링크 분석**: 그래프 뷰 데이터 활용~~ ✅ 구현됨
5. **음성 입력**: Whisper API 연동
6. **이미지 분석**: Vision API로 첨부 이미지 분석
7. **스케줄링**: 주기적 노트 분석/정리
8. **멀티 볼트**: 여러 볼트 동시 검색

---

## 추가 구현된 MCP 도구

### Mermaid 다이어그램 도구

| 도구 | 설명 |
|------|------|
| `mcp__obsidian__generate_mermaid` | Mermaid 다이어그램 템플릿 생성 (flowchart, sequence, class, state, ER, gantt, pie, mindmap, timeline) |
| `mcp__obsidian__analyze_for_diagram` | 노트 내용 분석하여 적합한 다이어그램 유형 추천 |

**사용 예시:**
```
"이 노트에 플로우차트 추가해줘"
"프로젝트 타임라인을 간트 차트로 만들어줘"
"이 노트 구조를 마인드맵으로 시각화해줘"
```

### Templater 통합 도구

| 도구 | 설명 |
|------|------|
| `mcp__obsidian__list_templates` | 사용 가능한 Templater 템플릿 목록 |
| `mcp__obsidian__apply_template` | 템플릿 적용 (새 노트 생성 또는 현재 위치에 삽입) |

**사용 예시:**
```
"사용 가능한 템플릿 보여줘"
"회의록 템플릿으로 새 노트 만들어줘"
"현재 위치에 일일 템플릿 삽입해줘"
```

### Tasks 플러그인 도구

| 도구 | 설명 |
|------|------|
| `mcp__obsidian__query_tasks` | 태스크 검색 (all, due, overdue, today, upcoming, completed, incomplete) |
| `mcp__obsidian__create_task` | 새 태스크 생성 (마감일, 우선순위, 예정일 포함) |
| `mcp__obsidian__toggle_task` | 태스크 완료 상태 토글 |

**사용 예시:**
```
"오늘 마감인 태스크 보여줘"
"지연된 태스크 목록 확인"
"프로젝트 노트에 새 태스크 추가해줘: 보고서 작성 📅 2024-01-20"
"3번째 줄 태스크 완료 처리해줘"
```

### 백링크/그래프 분석 도구

| 도구 | 설명 |
|------|------|
| `mcp__obsidian__get_backlinks` | 특정 노트로 링크하는 노트 목록 (백링크) |
| `mcp__obsidian__get_outgoing_links` | 노트에서 나가는 링크 목록 |
| `mcp__obsidian__analyze_connections` | 노트 또는 볼트 전체의 연결 구조 분석 |
| `mcp__obsidian__find_unlinked_mentions` | 링크되지 않은 멘션 찾기 |

**사용 예시:**
```
"이 노트의 백링크 보여줘"
"볼트에서 가장 많이 연결된 노트 분석해줘"
"고아 노트(연결 없는 노트) 찾아줘"
"링크되지 않은 멘션 찾아서 링크 추가 제안해줘"
```
