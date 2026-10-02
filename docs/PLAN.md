# lookhere — MVP 계획

> 화면을 찍고, 고칠 곳에 네모를 치고, 메모를 붙여서 AI 코딩 에이전트 세션에 넘긴다.

## 🎯 Goal: MVP 달성

아래 **완료 기준**이 모두 체크되면 MVP 달성이다.

- [x] `npx lookhere` 한 줄로 로컬 주석 UI가 열린다 (Windows에서 확인. macOS/Linux는 CI 빌드·테스트만)
- [x] 캡처 4가지: 클립보드 붙여넣기, 이미지 파일 드롭, 화면 공유(`npm run e2e`에서 Chromium 탭 자동 선택으로 검증), URL 캡처
- [x] 캡처 위에 네모를 그리고(이동·크기조절·삭제) 네모마다 캡션을 단다
- [x] 여러 캡처를 모아 한 번에 "보내기"
- [x] 에이전트가 세 경로로 받는다: MCP 도구(텍스트+이미지), `lookhere pull`(stdout), `.lookhere/inbox/` 파일
- [x] URL 캡처는 네모마다 실제 DOM 요소(selector, 텍스트, React 컴포넌트 이름, 소스 파일:줄)를 같이 넘긴다
- [x] Claude Code / Codex / Cursor 연결 방법이 README에 있고, `lookhere setup <agent>`가 설정 명령을 알려준다
- [x] 단위 테스트 통과 + 실제 브라우저에서 캡처→주석→MCP 수신까지 한 번 끝까지 검증

## 남은 일 (MVP 마무리)

- [x] 화면 공유: Chromium 자동 선택으로 E2E 통과. 사람이 직접 고르는 Chrome 선택창은 사용자 확인 대기
- [x] React 개발 서버(examples/react-demo)로 URL 캡처 → `NavButton < Header < App`, `src/NavButton.jsx:3` 확인 (React 19 디버그 스택 + 소스맵)
- [x] Codex(`codex exec`, gpt-5.5)가 MCP로 피드백을 받아 메모와 selector를 정확히 답함
- [x] Claude Code에 MCP 등록(`claude mcp get lookhere` → Connected). 대화 테스트는 CLI 재로그인 후
- [x] 실제 Chrome(browser-skill)에서 URL 캡처 → 네모 → 메모 → 보내기 확인
- [ ] npm 배포 (`npx lookhere`가 실제로 동작하려면 필요)

## 다음: Android

[ANDROID_PLAN.md](ANDROID_PLAN.md)

## 범위 밖 (MVP 이후)

- 전역 단축키 / 데스크톱 오버레이 (Tauri)
- Flutter·Android·iOS 요소 트리 매핑 (어댑터 구조만 열어둔다)
- 화살표·자유곡선 등 네모 외 도형, 스타일 미리보기 편집
- 팀 공유 / 원격 저장

## 구조

```
lookhere (npm 패키지 하나, bin: lookhere)
├─ src/shared   타입, 번들 포맷, 영역→요소 매핑, 마크다운 렌더러   ← 순수 함수, 테스트 대상
├─ src/server   node:http — 정적 UI + REST API + Playwright URL 캡처
├─ src/mcp      MCP stdio 서버 (필요하면 UI 서버도 같이 띄움)
├─ src/cli.ts   lookhere [open|mcp|pull|setup]
└─ web/         React + Vite 주석 UI (빌드 결과는 dist/web)
```

**상태는 전부 파일**(`<프로젝트>/.lookhere/`)로 공유한다. UI 서버와 MCP 서버가 다른 프로세스여도 같은 폴더만 보면 된다.

```
.lookhere/
├─ drafts/<captureId>/      아직 안 보낸 캡처
│   ├─ capture.json         메타 + 네모/캡션 + (URL 캡처면) 요소 목록
│   └─ image.png
└─ inbox/<bundleId>/        보낸 묶음
    ├─ feedback.md          에이전트가 읽을 지시문
    ├─ feedback.json        구조화 데이터
    ├─ capture-1.png        네모·번호가 그려진 전체 화면
    ├─ capture-1-box-1.png  네모 영역 크롭
    └─ status               pending | delivered | done
```

## 마일스톤

| # | 내용 | 산출물 |
|---|------|--------|
| M0 | 스캐폴드 | package.json, tsconfig, vite, vitest, MIT, git |
| M1 | 공유 코어 | 타입, 저장소, 번들 생성, 마크다운, 영역→요소 매핑 + 테스트 |
| M2 | 주석 UI | 붙여넣기/드롭/화면공유/URL, 네모 그리기·편집, 캡션, 캡처 트레이, 보내기 |
| M3 | UI 서버 | 정적 파일, REST API, Playwright URL 캡처 + 요소 수집 |
| M4 | MCP 서버 | `get_feedback`, `wait_for_feedback`, `list_feedback`, `open_annotator`, `capture_url`, `mark_done` |
| M5 | CLI | `lookhere`, `lookhere mcp`, `lookhere pull`, `lookhere setup <agent>` |
| M6 | 검증·문서 | 브라우저 E2E, MCP 클라이언트로 수신 확인, README |
