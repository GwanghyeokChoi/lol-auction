export const HELP_CONTENT = `
<h3>📜 LOL Auction 가이드</h3>
<p><strong>0. 서비스 안내</strong></p>
<ul>
    <li>본 사이트는 리그 오브 레전드 내전 팀 구성을 위한 실시간 경매 시스템입니다.</li>
    <li>모바일 환경은 지원하지 않으며, PC 전체 화면 해상도에 최적화되어 있습니다.</li>
    <li>이용 전 개인정보처리방침 및 이용약관을 반드시 확인해 주세요.</li>
</ul>

<p><strong>1. 방 생성 및 준비</strong></p>
<ul>
    <li>방장(팀장1)은 AUCTION SETUP 화면에서 초기 자본금과 팀장 목록을 설정하여 방을 생성합니다.</li>
    <li>생성된 링크를 각 팀장 및 관전자에게 공유하여 입장시킵니다.</li>
    <li>모든 팀장이 접속해야 경매를 시작할 수 있습니다.</li>
</ul>

<p><strong>2. 선수 명단 등록</strong></p>
<ul>
    <li>방장(팀장1)은 CSV 파일을 업로드하여 경매 대상 선수를 일괄 등록합니다.</li>
    <li>CSV 형식은 따로 헤더가 없으며 이름, 닉네임, 최고티어, 현재티어, 주포지션, 부포지션, 모스트1, 모스트2, 모스트3 순서로 작성해 주세요.</li>
</ul>

<p><strong>3. 경매 진행</strong></p>
<ul>
    <li>경매가 시작되면 시스템이 지정한 랜덤 순서대로 선수가 등장합니다.</li>
    <li>팀장들은 보유한 포인트로 입찰할 수 있습니다.</li>
    <li>좌측 참가자 명단에 마우스를 올리거나, 클릭하면 참가자의 상세 정보를 확인할 수 있습니다.</li>
    <li>우측 팀장 명단을 클릭한 경우, 현재까지 팀에서 낙찰한 선수의 정보를 확인할 수 있습니다.</li>
    <li>제한 시간 내에 입찰자가 없으면 해당 선수는 유찰됩니다.</li>
    <li>낙찰된 선수는 해당 팀에 소속되며 포인트가 차감됩니다.</li>
    <li>입찰 포인트는 남은 팀원 수 만큼의 최소 포인트를 남겨야 합니다. (남은 인원 x 1포인트) </li>
</ul>

<p><strong>4. 퍼즈 및 종료</strong></p>
<ul>
    <li>각 팀장들은 경매 중 최대 2회, 회당 최대 2분까지 퍼즈가 가능합니다.</li>
    <li>모든 팀이 4명의 팀원(팀장 포함 5인 로스터 완성 시)을 채우면 경매가 종료됩니다.</li>
    <li>종료 후 방장은 최종 팀 구성 결과를 엑셀 파일로 다운로드할 수 있습니다.</li>
</ul>

<hr style="border: 0; border-top: 1px solid #333; margin: 20px 0;">
<p><strong>📧 문의 및 건의사항</strong></p>
<p>서비스 이용 중 불편한 점이나 개선 사항이 있다면 아래 메일로 연락주세요.</p>
<p><a href="mailto:ewq15651@gmail.com" style="color: #c8aa6e;">ewq15651@gmail.com</a></p>
`;


export const UPDATE_LOG = `
<h3>🚀 패치노트</h3>
<ul class="update-list">
    <li>
        <span class="version">v1.3.2</span> <span class="date">2026.03.03</span>
        <p>- 반응형 디자인 적용</p>
        <p>- 전체 화면 UI 개선</p>
        <p>- 경매 최초 시작 대기시간 3초 → 15초로 변경</p>
        <p>- 도움말 내 '서비스 안내' 항목 추가</p>
    </li>
    <li>
        <span class="version">v1.3.1</span> <span class="date">2026.02.27</span>
        <p>- 참가자 명단에 최고 티어/현재 티어 구분 추가</p>
        <p>- 선수 상세 정보 및 경매 화면 UI 개선</p>
    </li>
    <li>
        <span class="version">v1.3.0</span> <span class="date">2026.02.27</span>
        <p>- 경매 화면 레이아웃 개선 (통합 카드 형태)</p>
        <p>- 방장 전용 도움말 및 경매장 가이드 툴팁 추가</p>
        <p>- 헤더 및 공통 Footer 적용</p>
        <p>- 도움말 및 패치노트 내용 추가</p>
    </li>
    <li>
        <span class="version">v1.2.0</span> <span class="date">2026.02.26</span>
        <p>- 팀원 정보 및 선수 상세 정보 모달 추가</p>
        <p>- 퍼즈 해제 권한 수정 및 타이머 리셋 기능 추가</p>
        <p>- 경매 종료 조건 및 유찰자 재경매 로직 개선</p>
    </li>
    <li>
        <span class="version">v1.1.0</span> <span class="date">2026.02.25</span>
        <p>- 퍼즈 기능 추가</p>
        <p>- 직접 입찰 기능 추가</p>
        <p>- UI 레이아웃 개선 (로그 영역 확장)</p>
    </li>
    <li>
        <span class="version">v1.0.0</span> <span class="date">2026.02.24</span>
        <p>- 웹 서비스 오픈</p>
        <p>- 실시간 경매 시스템 구축</p>
    </li>
    <li>
        <span class="version">v0.0.0</span> <span class="date">2025.10.16</span>
        <p>- 디스코드 봇</p>
        <p>- 턴제 경매 시스템 구축</p>
        <p>- CSV 명단 등록 및 결과 다운로드 기능</p>
    </li>
</ul>
`;