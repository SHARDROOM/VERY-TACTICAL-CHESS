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

## 구조

- `src/engine/` — 순수 게임 엔진. `applyCommand(state, command)`가 상태를 바꾸는 유일한 입구이며, 네트워크·UI·LLM·난수에 의존하지 않습니다.
- `src/scene/` — react-three-fiber 3D 장면. 엔진 상태를 표시만 하고 규칙은 모릅니다.
- `src/ui/` — 3D 화면 위의 2D UI 문구 등.
