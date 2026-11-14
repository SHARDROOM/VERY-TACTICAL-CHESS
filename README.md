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
- `src/ui/` — 3D 화면 위의 2D UI 문구 등.
