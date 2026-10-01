# lookhere

**화면을 가리키며 AI 에이전트에게 고칠 곳을 말하세요.**

아무 화면이나 캡처하고, 고칠 곳에 네모를 그리고, 메모를 적어서 보내면 됩니다.
에이전트(Claude Code, Codex, Cursor 등 MCP를 쓰는 모든 도구)는 번호 붙은 네모, 메모, 크롭 이미지를 받습니다.
웹페이지라면 네모 아래 실제 DOM 요소와 컴포넌트 이름도 함께 받습니다.

## 시작하기

```bash
npx lookhere                 # 주석 UI 열기
npx lookhere setup claude    # 연결 방법 보기 (codex, cursor도 가능)
```

| 에이전트 | 명령 |
|---|---|
| Claude Code | `claude mcp add lookhere -- npx -y lookhere mcp` |
| Codex | `codex mcp add lookhere -- npx -y lookhere mcp` |
| Cursor | `.cursor/mcp.json`에 `{"mcpServers":{"lookhere":{"command":"npx","args":["-y","lookhere","mcp"]}}}` 추가 |

연결한 뒤 에이전트에게 *"lookhere 열어줘"*, *"localhost:3000 캡처해줘"*, *"lookhere 피드백 확인해줘"*라고 말하면 됩니다.

## 캡처 방법

| 방법 | 용도 | 요소 매핑 |
|---|---|---|
| **붙여넣기** (`Ctrl+V`) | OS 캡처 도구로 찍은 아무 화면 | 없음 |
| **이미지 파일** 열기·드롭 | 시안, 버그 리포트 | 없음 |
| **화면 공유** → 프레임 캡처 | 시뮬레이터, 에뮬레이터, 데스크톱 앱 | 없음 |
| **URL 캡처** | 개발 서버 페이지 | **있음**: selector, 텍스트, React/Vue 컴포넌트 |

## 에이전트가 받는 것

보낼 때마다 `.lookhere/inbox/<id>/`에 `feedback.md`, `feedback.json`, 주석 이미지, 원본 이미지, 네모별 크롭이 저장됩니다.
받는 경로는 세 가지입니다.

1. **MCP**: `get_feedback`, `wait_for_feedback` 도구 (텍스트 + 이미지)
2. **CLI**: `lookhere pull`
3. **파일**: `.lookhere/inbox/` 폴더, 또는 UI의 *Copy as Markdown*

자세한 내용은 [README.md](README.md)와 [docs/PLAN.md](docs/PLAN.md)를 보세요.
