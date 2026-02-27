# LOL Auction Web (롤 내전 팀 경매 시스템)

리그 오브 레전드(LoL) 내전 및 대회 팀 구성을 위한 실시간 경매 웹 애플리케이션입니다.
방장이 경매 방을 생성하고, 팀장들이 실시간으로 포인트 입찰을 통해 팀원을 영입하는 시스템을 제공합니다.

🔗 **Live Demo:** [https://lol-auction.co.kr](https://lol-auction.co.kr)

## ✨ 주요 기능

*   **실시간 경매 시스템:** Firebase Realtime Database를 활용하여 지연 없는 실시간 입찰 및 상태 동기화.
*   **방 생성 및 관리:**
    *   초기 자본금 설정 및 팀장(참여자) 등록.
    *   초대 링크 생성 (방장 및 각 팀장 전용 링크).
*   **선수 명단 관리:**
    *   CSV 파일을 통한 대량 선수 명단 등록.
    *   이름, 닉네임, 최고티어, 현재티어, 주/부 포지션, 모스트 챔피언 정보 지원.
*   **경매 진행:**
    *   랜덤 순서로 선수 경매 진행.
    *   실시간 타이머 및 입찰 경쟁 (입찰 시 타이머 리셋).
    *   유찰 시스템 및 유찰자 재경매 로직.
    *   퍼즈(일시정지) 및 재개 기능.
*   **결과 관리:**
    *   팀별 낙찰 선수 및 잔여 포인트 실시간 확인.
    *   최종 팀 구성 결과 엑셀(CSV) 다운로드.
*   **관전자 모드:** 입찰 권한 없이 경매 진행 상황만 볼 수 있는 관전 전용 링크 제공.

## 🛠 기술 스택

*   **Frontend:** [Vite](https://vitejs.dev/), [TypeScript](https://www.typescriptlang.org/)
*   **Database:** [Firebase Realtime Database](https://firebase.google.com/docs/database)
*   **Deployment:** [GitHub Pages](https://pages.github.com/)
*   **Libraries:**
    *   `firebase`: 실시간 데이터 동기화.
    *   `papaparse`: CSV 파일 파싱 및 내보내기.

## 🚀 설치 및 실행 방법

### 1. 프로젝트 클론
```bash
git clone https://github.com/GwanghyeokChoi/lol-auction.git
cd lol-auction
```

### 2. 의존성 설치
```bash
npm install
```

### 3. 환경 변수 설정 (.env)
프로젝트 루트에 `.env` 파일을 생성하고 Firebase 설정값을 입력하세요.
(Firebase 콘솔에서 프로젝트 생성 후 웹 앱 설정값을 확인하세요.)

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your_database_url.firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 4. 로컬 개발 서버 실행
```bash
npm run dev
```
브라우저에서 `http://localhost:5173`으로 접속하여 확인합니다.

## 📦 빌드 및 배포

이 프로젝트는 GitHub Pages에 배포되도록 설정되어 있습니다.

### 빌드
```bash
npm run build
```
`dist` 폴더에 프로덕션용 빌드 파일이 생성됩니다.

### 수동 배포 (GitHub Pages)
```bash
# 1. 빌드
npm run build

# 2. dist 폴더로 이동
cd dist

# 3. git 초기화 및 커밋
git init
git add .
git commit -m "Deploy"

# 4. gh-pages 브랜치로 강제 푸시
git push -f https://github.com/GwanghyeokChoi/lol-auction.git master:gh-pages
```

## 📝 CSV 명단 양식
선수 명단 등록 시 아래와 같은 CSV 형식을 사용하세요. (헤더 없음)

```csv
이름,닉네임,티어,주포지션,부포지션,모스트1,모스트2,모스트3
홍길동,Hide on bush,Challenger,Mid,Top,Ahri,Leblanc,Zed
김철수,Deft,Grandmaster,ADC,Supp,Jinx,Ezreal,Caitlyn
...
```

## 📄 License
This project is licensed under the MIT License.