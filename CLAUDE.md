# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 지침

- 응답은 항상 한국어로
- 기술 스택: Vite + TypeScript, Firebase Realtime Database, GitHub Pages 배포
- 반응형 작업 시 Firebase 실시간 입찰 로직이 깨지지 않도록 주의
- 추후 다른 게임(오버워치, 발로란트 등) 확장을 고려해 게임 관련 문자열/아이콘은
  가능하면 하드코딩하지 말고 설정값으로 분리
- 리그 오브 레전드 로고/방패 문장을 직접 모사하는 이미지·에셋은 사용하지 않기

## 명령어

```bash
npm run dev       # 로컬 개발 서버 (Vite, 기본 http://localhost:5173)
npm run build     # tsc 타입 체크 후 dist/에 프로덕션 빌드
npm run preview   # 빌드 결과 로컬 미리보기
npm run deploy    # predeploy(빌드) 후 gh-pages -d dist 로 GitHub Pages 배포
```

테스트 스위트는 별도로 구성되어 있지 않다. 타입 오류는 `npm run build`(내부적으로 `tsc`)로 확인한다.

로컬 실행에는 루트에 `.env` 파일이 필요하다 (`VITE_FIREBASE_*` 키 목록은 README.md 참고).

## 아키텍처

**빌드되지 않은 순수 TS + DOM 조작 구조.** React/Vue 등 프레임워크 없이, `index.html`에 모든 화면(랜딩/설정/경매장/각종 모달)을 정적 마크업으로 미리 배치해두고, `src/main.ts`가 `DOMContentLoaded` 시점에 ID로 엘리먼트를 찾아 이벤트 리스너를 바인딩하는 단일 진입점 방식이다. 화면 전환은 SPA 라우팅 없이 각 화면 컨테이너의 `display` 스타일을 토글하는 방식으로 이루어진다.

### 데이터 흐름
1. `src/firebase.ts` — `.env`의 `VITE_FIREBASE_*` 값으로 Firebase 앱/DB 초기화, `db` 인스턴스 export.
2. `src/services/*.ts` — Firebase Realtime Database에 대한 모든 읽기/쓰기가 여기 집중되어 있다. `main.ts`와 `ui/renderer.ts`는 DB를 직접 건드리지 않는다.
   - `roomService.ts` — 방 생성(`createRoom`), 선수 명단 등록, 경매 시작 시 참가자/팀장 순서 셔플, 팀장 접속 상태(`onDisconnect`) 관리.
   - `auctionService.ts` — 경매 진행의 상태 머신(`nextPlayer` → `bidding` → `finalize` → `cooldown` → 다음 선수). 입찰(`placeBid`/`placeTargetBid`)은 내부적으로 `_processBid`로 합류하며, 남은 팀 슬롯 수만큼 포인트를 남겨야 하는 최소 포인트 검증 로직이 포함되어 있다.
   - `csvService.ts` — CSV 선수 명단 파싱(papaparse, 헤더 없음 고정 컬럼 순서) 및 경매 결과 CSV 내보내기.
3. `src/main.ts` — `rooms/{roomId}` 전체를 `onValue`로 구독해 `latestData`에 저장하고 `Renderer.*`를 호출해 화면을 다시 그린다. 또한 두 개의 폴링 타이머를 돌린다:
   - 100ms 주기: 모든 클라이언트에서 타이머 UI(`#timer`) 갱신.
   - 1000ms 주기: **`userRole === 'team_1'`(방장) 클라이언트에서만** 상태 전이를 실제로 트리거(`nextPlayer`/`finalize`/`resumeAuction`/`startBidding` 호출). 즉 경매 상태 진행의 권위는 방장 클라이언트에 있고, 다른 클라이언트는 Firebase 데이터를 구독해 결과만 반영한다.
4. `src/ui/renderer.ts` — `Renderer` 객체가 DB 데이터를 받아 각 패널(`player-list`, `auction-stage`, `team-list`, `auction-stats`, 로그, 툴팁)의 `innerHTML`을 갱신하는 순수 렌더 함수 모음. 티어 색상표(`getTierColor`)와 티어/포지션 목록(`TIERS`, `POSITIONS`)이 이 파일 상단에 하드코딩되어 있다.
5. `src/utils/timer.ts` — Firebase `.info/serverTimeOffset`을 구독해 클라이언트-서버 시간 오차를 보정한 `getServerTime()` 제공. 모든 타이머/마감시각 비교는 `Date.now()`가 아니라 이 함수를 사용해야 한다.

### Firebase Realtime Database 스키마 (`rooms/{roomId}`)
- `info`: 생성 시각/상태.
- `teams/{teamId}`: `leaderName`, `points`(잔여 포인트), `members`(낙찰된 player id 배열), `pauseCount`, `online`.
- `live`: 경매 상태 머신 전체 (`status: idle|bidding|paused|cooldown|resuming`, `activePlayerId`, `highestBid`, `highestBidderId`, `playerOrder`, `leaderOrder`, `endTime`, `pauseLimitTime`, `nextAuctionTime` 등) — 타입은 `src/types/index.ts`의 `AuctionState` 참고.
- `players/{playerId}`: 선수 정보 + `status: waiting|bidding|sold|passed`.
- `logs/{logId}`: `onChildAdded`로 append-only 구독되는 경매 로그.

역할(`role` 쿼리 파라미터)은 `team_1`(방장/첫 팀장), `team_N`(일반 팀장), `viewer`(관전자) 세 가지이며 URL(`?id={roomId}&role={role}`)로만 구분된다 — 별도 인증 없음.

### 알아둘 점
- 팀당 정원(4명)이 `auctionService.ts`, `roomService.ts`, `main.ts`, `renderer.ts`에 매직 넘버로 중복 산재해 있다. 정원 관련 로직을 고칠 때는 이 네 곳을 모두 확인할 것.
- `TIERS`/`POSITIONS`, 각종 타이머 길이(입찰 15초, 재개 대기 5초, 퍼즈 2분 등)는 상수화되어 있지 않고 코드 곳곳에 하드코딩되어 있다. 다른 게임 확장을 고려한 설정값 분리 작업 시 이 부분들이 주 대상이다.
- 경매 상태 전이는 방장(`team_1`) 클라이언트가 단독으로 트리거하므로, 방장 클라이언트가 오프라인이면 경매가 멈춘다(별도 서버/Cloud Functions 없음).
