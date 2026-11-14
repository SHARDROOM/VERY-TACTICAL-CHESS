# 아주 전략적인 체스 (Very Tactical Chess)

체스 규칙 위에서 기상천외한 행동을 채팅으로 선언하면 LLM GM이 판정해 주는 TRPG형 3D 체스.
기획은 [`docs/SPEC.md`](docs/SPEC.md), 작업 목록은 GitHub Issues를 참고하세요.

## 개발

```bash
npm install
npm run dev      # 개발 서버
npm test         # 엔진 테스트 (Vitest)
npm run build    # 타입 검사 + 프로덕션 빌드
```

## 플레이 방법

- **핫시트:** 한 화면에서 둘이 번갈아 둡니다.
- **온라인:** "온라인 방 만들기"를 누르면 6자리 방 코드와 초대 링크가 나옵니다. 친구가 링크를 열거나 코드를 입력하면 시작합니다.
  - 서버 없이 두 브라우저를 직접 연결합니다(WebRTC, PeerJS의 무료 공개 중계 서버로 연결만 맺음).
  - 방장 브라우저가 게임 상태, 주사위, GM 호출을 모두 맡습니다. GM API 키는 방장 브라우저에만 있고 상대에게 전송되지 않습니다.
  - 방장은 백, 참가자는 흑입니다. 참가자가 나가도 같은 방 코드로 다시 들어올 수 있습니다.
  - 회사나 학교 네트워크에서는 P2P 연결이 막힐 수 있습니다. 그럴 때는 핫시트 모드를 쓰세요.

### 로컬에서 온라인 대전 시험하기

공개 중계 서버 대신 로컬 PeerServer를 쓰려면 주소에 `?peer=localhost:9000`을 붙입니다.

```bash
npx peer --port 9000   # 별도 터미널에서 (IPv6가 없는 환경이면 127.0.0.1에 바인딩하는 작은 스크립트로 실행)
# 브라우저 두 개에서 http://localhost:5173/?peer=localhost:9000 을 엽니다
```

`&peerdebug=1`을 붙이면 PeerJS 디버그 로그가 콘솔에 나옵니다.

## 배포 (GitHub Pages)

기본 브랜치에 푸시하면 GitHub Actions가 테스트 → 빌드 → 배포를 자동으로 합니다.
다른 브랜치와 PR은 테스트와 빌드만 합니다. 테스트가 실패하면 배포되지 않습니다.

처음 한 번은 저장소 설정에서 Pages를 켜야 합니다 (사람이 해야 하는 단계):

1. 저장소의 **Settings → Pages**로 이동
2. **Build and deployment → Source**를 **GitHub Actions**로 선택
3. 기본 브랜치에 푸시하거나 **Actions** 탭에서 "Test and deploy" 워크플로를 수동 실행

배포 주소는 `https://<소유자>.github.io/<저장소 이름>/` 형태입니다.

## 구조

- `src/engine/` — 순수 게임 엔진. `applyCommand(state, command)`가 상태를 바꾸는 유일한 입구이며, 네트워크·UI·LLM·난수에 의존하지 않습니다.
- `src/scene/` — react-three-fiber 3D 장면. 엔진 상태를 표시만 하고 규칙은 모릅니다.
- `src/gm/` — GM(LLM) 연동. Claude, OpenAI, Gemini 어댑터와 개발용 가짜 GM, 공통 프롬프트와 응답 검증.
- `src/session/` — 게임 진행 계층. `Authority`가 상태를 바꾸는 유일한 주체(차례 확인, 주사위, GM 호출)이고, 핫시트(`LocalSession`), 온라인 방장(`HostSession`), 참가자(`GuestSession`)가 이를 감쌉니다. 방장↔참가자 메시지 형식과 검증은 `protocol.ts`, PeerJS 연결은 `peerTransport.ts`.
- `src/ui/` — 로비, 게임 화면, 3D 화면 위의 2D UI.
