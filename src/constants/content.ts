export const HELP_CONTENT = `
<h3>📜 LOL Auction 가이드</h3>
<p><strong>1. 방 생성 및 입장</strong></p>
<ul>
    <li>방장은 초기 자본금과 팀장(참여자) 목록을 설정하여 방을 생성합니다.</li>
    <li>생성된 링크를 각 팀장에게 공유하여 입장시킵니다.</li>
    <li>모든 팀장이 접속해야 경매를 시작할 수 있습니다.</li>
</ul>

<p><strong>2. 선수 명단 등록</strong></p>
<ul>
    <li>방장은 CSV 파일을 업로드하여 경매 대상 선수를 등록합니다.</li>
    <li>CSV 형식: 이름, 닉네임, 티어, 주포지션, 부포지션, 모스트1, 모스트2, 모스트3 (헤더 없음)</li>
</ul>

<p><strong>3. 경매 진행</strong></p>
<ul>
    <li>경매가 시작되면 랜덤 순서로 선수가 등장합니다.</li>
    <li>팀장들은 보유한 포인트로 입찰할 수 있습니다.</li>
    <li>제한 시간 내에 입찰이 없으면 유찰됩니다.</li>
    <li>낙찰된 선수는 해당 팀에 소속되며 포인트가 차감됩니다.</li>
</ul>

<p><strong>4. 퍼즈 및 종료</strong></p>
<ul>
    <li>팀장은 경매 중 퍼즈를 요청할 수 있습니다 (횟수 제한).</li>
    <li>모든 팀이 4명의 팀원을 채우면 경매가 종료됩니다.</li>
    <li>종료 후 방장은 최종 결과를 엑셀로 다운로드할 수 있습니다.</li>
</ul>
`;

export const UPDATE_LOG = `
<h3>🚀 업데이트 내역</h3>
<ul class="update-list">
    <li>
        <span class="version">v1.2.0</span> <span class="date">2024.02.26</span>
        <p>- 팀원 정보 및 선수 상세 정보 모달 추가</p>
        <p>- 퍼즈 해제 권한 수정 및 타이머 리셋 기능 추가</p>
        <p>- 경매 종료 조건 및 유찰자 재경매 로직 개선</p>
    </li>
    <li>
        <span class="version">v1.1.0</span> <span class="date">2024.02.25</span>
        <p>- 퍼즈 기능 추가</p>
        <p>- 직접 입찰 기능 추가</p>
        <p>- UI 레이아웃 개선 (로그 영역 확장)</p>
    </li>
    <li>
        <span class="version">v1.0.0</span> <span class="date">2024.02.24</span>
        <p>- 서비스 오픈</p>
        <p>- 실시간 경매 시스템 구축</p>
        <p>- CSV 명단 등록 및 결과 다운로드 기능</p>
    </li>
</ul>
`;