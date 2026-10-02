# lookhere for Android: MVP 계획

> 에뮬레이터나 실기기에서 돌아가는 앱 화면을 캡처하고, 네모를 친 곳이 **어느 View/Composable이고 어느 소스 파일인지**까지 에이전트에게 넘긴다.

웹 버전의 URL 캡처가 DOM 요소를 붙여주듯, Android 캡처는 화면의 접근성 트리(UI hierarchy)를 붙이고,
프로젝트 소스에서 그 요소를 찾아 후보 위치를 붙인다. **앱 코드를 고치거나 SDK를 심지 않는다.** adb만 쓴다.

## 🎯 Goal: Android MVP 달성

- [ ] UI의 **Android** 버튼(또는 `lookhere capture --android`)으로 연결된 기기의 현재 화면을 3초 안에 캡처한다
- [ ] 기기가 여러 대면 고를 수 있고, *3초 후 캡처*로 메뉴·키보드가 열린 상태도 찍을 수 있다
- [ ] 네모마다 화면 요소가 붙는다: resource-id, 클래스, 텍스트, content-desc, testTag (View 기반 + Compose)
- [ ] Android 프로젝트 폴더에서 실행하면 네모마다 **소스 후보**가 붙는다 (레이아웃 XML의 id, 문자열 리소스 사용처, testTag, 하드코딩된 텍스트)
- [ ] MCP 도구 `list_android_devices`, `capture_android`가 있고 Codex/Claude Code에서 한 번 끝까지 검증한다
- [ ] 기기 없이 도는 단위 테스트(덤프 XML 픽스처 + 픽스처 프로젝트)와 README Android 절

## 왜 이 방식인가

| 방식 | 장점 | 단점 | 결정 |
|---|---|---|---|
| **호스트에서 adb** (`screencap` + `uiautomator dump`) | 아무 앱이나, 앱 수정 없음, 웹 버전 구조 그대로 재사용 | 애니메이션 중엔 덤프 실패 가능, Compose는 semantics 의존 | **MVP** |
| 기기 위 오버레이 앱 (폰에서 직접 네모 그리기) | 폰만으로 피드백 | 별도 APK, 권한(오버레이·캡처), 호스트 전송 경로 필요 | 이후 |
| 앱에 SDK 삽입 (디버그 빌드 전용) | 정확한 Composable·소스 위치 | 사용자 앱 수정 필요 | 이후 (선택 기능) |

`screencap` 이미지와 `uiautomator dump`의 `bounds`는 **같은 화면 픽셀 좌표계**라서, 웹 버전의 `matchElements()`(네모 ↔ 요소 매칭)를 그대로 쓸 수 있다.

## 동작 흐름

```
[Android 버튼] → POST /api/capture-android {serial, delayMs}
   ├─ adb -s <serial> exec-out screencap -p                 → image.png
   ├─ adb -s <serial> shell uiautomator dump /sdcard/lh.xml → 노드 트리 (bounds, resource-id, text, …)
   │    (+ exec-out cat, rm)  애니메이션으로 실패하면 2회 재시도 → 그래도 실패면 이미지만 + 경고
   ├─ adb shell dumpsys window | mCurrentFocus              → 패키지 / Activity 이름
   └─ SourceLocator(projectDir).locate(nodes)                → 노드별 소스 후보
→ draft(kind: "android", elements) → 기존 UI에서 네모/메모 → 보내기 → 기존 번들/MCP 그대로
```

## 요소 정보 (예시 출력)

```markdown
### 1.1 버튼을 더 크게

- Region: x=820 y=2010 w=380 h=140
- Elements under the box:
  - `com.acme.notes:id/signup_button` · Button · "Sign up" (matches the box)
    - source `app/src/main/res/layout/activity_login.xml:42` (android:id)
    - source `app/src/main/java/com/acme/notes/LoginActivity.kt:57` (R.id.signup_button)
  - `LinearLayout[2]` · LinearLayout (wraps the box)
- Screen: com.acme.notes/.LoginActivity → `app/src/main/java/com/acme/notes/LoginActivity.kt`
```

## 소스 후보 찾기 (SourceLocator)

프로젝트를 한 번 훑어 인덱스를 만든다 (`build/`, `.gradle/`, `node_modules/` 제외).

| 화면 요소 정보 | 찾는 곳 | 근거 표시 |
|---|---|---|
| resource-id `pkg:id/name` | `res/layout*/**.xml`의 `@+id/name` · 코드의 `R.id.name`, ViewBinding `binding.camelName` | `android:id`, `R.id.name` |
| text "Sign up" | `res/values*/strings.xml`에서 같은 값의 `name` → 코드/레이아웃의 `R.string.name`, `@string/name`, `stringResource(R.string.name)` · 코드 안 문자열 리터럴 | `string resource`, `literal` |
| content-desc | text와 같은 방식 | `contentDescription` |
| testTag (Compose, `testTagsAsResourceId`) | `testTag("name")` | `testTag` |
| 현재 Activity | `class LoginActivity` 정의 파일 | `activity` |

후보는 근거가 강한 순(id > testTag > 문자열 리소스 > 리터럴)으로 최대 3개. 텍스트가 여러 파일에 있으면 같은 화면(Activity/Fragment/Screen 파일) 쪽을 먼저 올린다.

## 코드 구조 변경

```
src/capture/
  adapter.ts        CaptureAdapter 인터페이스 { id, capture(opts) → {png, source, elements} }
  web.ts            기존 capture-url.ts 이동
  android/
    adb.ts          adb 찾기(PATH, ANDROID_HOME, ANDROID_SDK_ROOT, winget 설치 경로), devices, screencap, dump(재시도)
    hierarchy.ts    uiautomator XML → ElementInfo[] (bounds 파싱, 경로 selector 생성)
    locate.ts       SourceLocator: 프로젝트 인덱싱 + 후보 검색
src/shared/types.ts CaptureKind에 "android" 추가, ElementInfo에 platform, sources?: {file, line, reason}[]
```

웹(DOM)·Android 모두 같은 `ElementInfo`를 쓰므로 매칭, 번들, MCP, UI는 거의 그대로다. 이후 iOS(`idb`/XCUITest), Flutter(VM service) 어댑터도 같은 자리에 붙는다.

## 마일스톤

| # | 내용 | 산출물 | 예상 |
|---|---|---|---|
| A0 ✅ | 스파이크: 에뮬레이터에서 screencap·dump 속도, idle 실패 빈도, Compose 덤프 모양 확인 | 메모 + 실제 덤프 XML 픽스처 3종 (View, Compose, 다이얼로그) | 0.5일 |
| A1 ✅ | adb 레이어 + hierarchy 파서 | `adb.ts`, `hierarchy.ts`, 픽스처 단위 테스트 | 1일 |
| A2 ✅ | SourceLocator | `locate.ts`, 픽스처 Android 프로젝트(빌드 불필요한 res/ + .kt 몇 개) 테스트 | 1.5일 |
| A3 ✅ | 서버·CLI·MCP | `/api/android/devices`, `/api/capture-android`, `lookhere capture --android [--serial]`, MCP `list_android_devices`·`capture_android` | 1일 |
| A4 | UI | Android 버튼, 기기 선택, 3초 후 캡처, 요소 칩에 id/클래스/소스 표시 | 1일 |
| A5 | 검증·문서 | 에뮬레이터 E2E(데모 앱), Codex로 MCP 끝까지, README Android 절 | 1일 |
| A6 | (선택) 라이브 미러 | screencap 폴링(1–2fps) 미리보기로 기기를 조작하며 원하는 순간 캡처 | 이후 |

## 준비물

- **Android SDK platform-tools (adb)**: ✅ `winget install Google.PlatformTools`로 설치 (adb 37.0.1)
- **테스트 기기**: Android Studio 공식 에뮬레이터(AVD) — Pixel 8, API 35, Google APIs x86_64 이미지. Hyper-V가 켜진 PC라 "Windows 하이퍼바이저 플랫폼" 기능이 필요하다. 실기기(USB 디버깅)는 보조 확인용
- **데모 앱** `examples/android-demo`: View 화면 1개 + Compose 화면 1개 (id, 문자열 리소스, testTag, 하드코딩 텍스트를 일부러 섞음)

## A0 결과 (2026-10-02, 에뮬레이터 Pixel 8 / API 35, WHPX 가속)

- 부팅 63초. `screencap -p` 약 0.7초(1080×2400, 94KB~), `uiautomator dump` 약 3초
- 덤프 `bounds`를 캡처 이미지에 그리면 픽셀 단위로 정확히 겹친다 → `matchElements()` 그대로 사용 가능
- 앱이 막 뜨는 중(스플래시)에는 덤프가 `null root node returned`로 실패. 화면이 안정되면 성공
  → **덤프를 먼저 성공시키고 바로 이어서 screencap** (시점 일치), 실패 시 2초 간격 재시도
- Settings 홈 덤프: 노드 64개, `resource-id`(`com.android.settings:id/homepage_title` 등)·`text`·`class` 모두 채워짐
  → `test/fixtures/android/settings-home.xml`로 저장
- 현재 화면: `dumpsys window` → `mCurrentFocus=…/com.android.settings.homepage.SettingsHomepageActivity`

## A1 결과

- `src/capture/android/adb.ts`: adb 찾기(LOOKHERE_ADB → ANDROID_HOME/SDK_ROOT → 기본 SDK 경로 → winget → PATH), `devices -l` 파싱, 기기 선택 오류 안내(unauthorized/offline/여러 대), `uiautomator dump /dev/tty`(pull 없이 stdout, 3회 재시도), `screencap`, 포커스 Activity
- `src/capture/android/hierarchy.ts`: 의존성 없는 덤프 파서 → `ElementInfo` (resource-id가 화면에서 유일하면 그대로, 아니면 `recycler_view > LinearLayout[2] > TextView[1]#title` 같은 경로), 컨테이너는 자식 텍스트를 모아 표시
- 실기 측정: 에뮬레이터 Settings 홈 캡처 **2.6초**, 요소 63개, 네모 → `Connected devices` TextView 매칭 확인
- 단위 테스트 13개 추가 (전체 29개 통과)

## A2 결과

- `src/capture/android/locate.ts`: 프로젝트를 한 번 훑어 색인 (레이아웃 `@+id`, `R.id`/`@id`, `binding.camelName`, 모든 로캘의 `strings.xml`, `R.string`/`@string`, `testTag("…")`, 코드·레이아웃의 하드코딩 텍스트, class 선언, Gradle `namespace`/`applicationId`)
- 근거 강도 순: 레이아웃 id = testTag > `R.id` > ViewBinding > 문자열 리소스 사용처 > 하드코딩 텍스트 > 문자열 정의. 동점이면 현재 Activity 파일 우선, 최대 3개
- Compose `testTagsAsResourceId`의 resource-id(패키지 없는 이름)를 testTag로 처리, `android:id/*` 프레임워크 id는 무시
- 다른 앱 화면(런처·설정 등)의 요소에는 후보를 붙이지 않음 (패키지 비교, `.debug` 접미사 허용) → 흔한 단어 우연 일치 방지
- 컨테이너가 자식에게서 모은 텍스트는 근거로 쓰지 않음 (`textFromChildren`)
- 번들 마크다운에 후보마다 근거 표시, 화면의 Activity 파일 표시
- 성능: 60만 줄(Kotlin 3,000개) 색인 5.2초, 조회 200회 1ms → 첫 빌드 후에는 오래된 색인으로 즉시 응답하고 백그라운드 갱신
- 테스트 13개 추가 (전체 42개). 에뮬레이터 Settings 캡처에 데모 프로젝트를 붙이면 후보 0개 (다른 앱이라 정상)

## A3 결과

- HTTP: `GET /api/android/devices`, `POST /api/capture-android {serial?, delayMs?}` (경고가 있으면 응답에 `warning`)
- CLI: `lookhere devices`, `lookhere capture --android [--serial] [--delay]`
- MCP: `list_android_devices`, `capture_android {serial?, delay_seconds?, open_browser?}`
- 서버·MCP 시작 시 Android 프로젝트(Gradle 파일 존재)면 소스 색인을 백그라운드로 미리 생성
- 근거 표기를 파일 종류에 맞춤: 코드는 `R.string.x`/`R.id.x`, XML은 `@string/x`/`@id/x`
- 실기 검증 (에뮬레이터 Settings + Settings를 흉내 낸 임시 프로젝트): MCP `capture_android` → API로 네모 2개 → `get_feedback`에
  `TextView "Network & internet"` → `SettingsHomepageActivity.kt:4 (R.string.network_dashboard_title)`,
  `homepage_title` → `settings_homepage.xml:3 (android:id)`, 화면 → Activity 파일까지 표시됨

## 위험과 대응

| 위험 | 대응 |
|---|---|
| 애니메이션 중 `uiautomator dump`가 "could not get idle state"로 실패 | 2회 재시도 → 실패 시 이미지만 저장하고 "요소 정보 없음" 경고 |
| Compose 노드가 semantics 없이 `android.view.View`로만 보임 | 텍스트·contentDescription 매칭으로 보완, README에 `testTagsAsResourceId = true` 안내 |
| `FLAG_SECURE` 화면은 검은 화면으로 찍힘 | 전부 검은 이미지면 경고 |
| Flutter·React Native·게임 엔진은 트리가 빈약함 | MVP 범위 밖. 이미지 캡처는 동작, 이후 전용 어댑터 |
| adb가 여러 대 / 무선 adb / 권한 문제 | `devices -l` 상태(unauthorized, offline)를 그대로 보여주고 해결 방법 안내 |
| 고해상도 PNG(1080×2400, 1–3MB) 전송 | 그대로 저장, MCP 이미지는 기존 `images: crops` 옵션으로 줄임 |
