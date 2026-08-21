import type { Player, Team, AuctionState } from "../types";
import { escapeHtml } from "../utils/sanitize";

const TIERS = [
    '언랭크', '챌린저', '그랜드마스터', '마스터', 
    '다이아1', '다이아2', '다이아3', '다이아4', 
    '에메랄드1', '에메랄드2', '에메랄드3', '에메랄드4',
    '플래티넘1', '플래티넘2', '플래티넘3', '플래티넘4',
    '골드1', '골드2', '골드3', '골드4',
    '실버1', '실버2', '실버3', '실버4',
    '브론즈1', '브론즈2', '브론즈3', '브론즈4',
    '아이언1', '아이언2', '아이언3', '아이언4'
];

const POSITIONS = ['탑', '정글', '미드', '원딜', '서폿'];

// 티어별 색상 반환 함수 (내부 사용)
const getTierColor = (tier: string): string => {
    if (!tier) return '#fff';
    const t = tier.trim();
    if (t.startsWith('언랭크')) return '#808080';
    if (t.startsWith('아이언')) return '#544546';
    if (t.startsWith('브론즈')) return '#935b55';
    if (t.startsWith('실버')) return '#808080';
    if (t.startsWith('골드')) return '#b8860b';
    if (t.startsWith('플래티넘')) return '#0a8d5e';
    if (t.startsWith('에메랄드')) return '#006400';
    if (t.startsWith('다이아')) return '#5c6eb4';
    if (t.startsWith('마스터')) return '#9400d3';
    if (t.startsWith('그랜드마스터')) return '#dd534a';
    if (t.startsWith('챌린저')) return '#1583af';
    return '#fff'; // 기본값
};

/*
 * [드롭다운 포탈 방식]
 * .tier-dropdown-list-container는 원래 .searchable-select-container(position:relative) 안에
 * position:absolute로 떠 있었는데, 참가자 일괄 등록 표처럼 부모가 overflow-y:auto인 스크롤
 * 컨테이너(.player-table-body) 안에 들어가면 그 경계에서 잘려 보이지 않는 문제가 있었다.
 * (네이티브 <select>는 브라우저가 별도 레이어에 그려서 이 문제가 없지만, 커스텀 드롭다운은
 * 부모의 overflow에 종속된다.)
 *
 * 해결: setupSearchableSelect가 각 입력창의 드롭다운 컨테이너를 초기화 시점에 document.body로
 * 옮기고(포탈) position:fixed로 띄운다. 열릴 때마다 입력창의 getBoundingClientRect() 기준으로
 * top/left/width를 계산해 그 아래 붙이므로 어떤 스크롤 컨테이너 안에 있든 잘리지 않는다.
 * 스크롤이 발생하면 좌표가 즉시 어긋나므로(매 스크롤마다 재계산하는 대신) 간단히 닫아버린다.
 */
interface TierDropdownInstance {
    input: HTMLInputElement;
    container: HTMLElement;
}

// 현재까지 setupSearchableSelect로 초기화된 모든 (입력창, 드롭다운) 쌍.
// 바깥 클릭 감지 / 스크롤 시 닫기 전역 리스너가 이 목록을 순회한다.
const dropdownInstances: TierDropdownInstance[] = [];

const positionDropdown = (input: HTMLInputElement, container: HTMLElement) => {
    const rect = input.getBoundingClientRect();
    container.style.top = `${rect.bottom}px`;
    container.style.left = `${rect.left}px`;
    container.style.width = `${rect.width}px`;
};

const closeAllDropdowns = () => {
    dropdownInstances.forEach(({ container }) => { container.style.display = 'none'; });
};

// 바깥 클릭으로 닫기 / 스크롤 시 닫기 리스너는 인스턴스 개수와 무관하게 딱 한 번만 등록한다.
let globalDropdownListenersAttached = false;
const attachGlobalDropdownListeners = () => {
    if (globalDropdownListenersAttached) return;
    globalDropdownListenersAttached = true;

    document.addEventListener('click', (e) => {
        const target = e.target as Node;
        dropdownInstances.forEach(({ input, container }) => {
            if (container.style.display !== 'none' && !input.contains(target) && !container.contains(target)) {
                container.style.display = 'none';
            }
        });
    });

    // capture:true — .player-table-body 같은 내부 스크롤 컨테이너의 scroll 이벤트는 버블링되지 않으므로
    // 캡처 단계에서 잡아야 한다.
    window.addEventListener('scroll', (e) => {
        const target = e.target as Node;
        // 드롭다운 목록 자체(티어가 많아 내부 스크롤이 걸리는 경우) 안에서 발생한 스크롤은
        // "바깥 스크롤"이 아니므로 아무 것도 닫지 않는다 — 스크롤한 그 드롭다운뿐 아니라
        // 동시에 열려있는 다른 드롭다운(있다면)까지 덩달아 닫혀버리면 안 되기 때문.
        const scrolledInsideDropdown = dropdownInstances.some(({ container }) => container.contains(target));
        if (scrolledInsideDropdown) return;
        closeAllDropdowns();
    }, true);
    // 창 크기 변경 시에는 좌표가 어긋나므로 예외 없이 전부 닫는다.
    window.addEventListener('resize', closeAllDropdowns);
};

// 검색 가능한 셀렉트 박스 초기화 함수
// (요소를 직접 받는다: 고정 ID 하나뿐 아니라 동적으로 추가되는 행의 입력칸에도 재사용하기 위함)
const setupSearchableSelect = (input: HTMLInputElement, data: string[]) => {
    const dropdownContainer = input.nextElementSibling as HTMLElement;
    const dropdownList = dropdownContainer.querySelector('ul') as HTMLUListElement;

    // 포탈: body 최상위로 이동시키고 fixed 포지셔닝으로 전환
    dropdownContainer.classList.add('tier-dropdown-portal');
    document.body.appendChild(dropdownContainer);
    dropdownInstances.push({ input, container: dropdownContainer });

    const populateList = (filter = '') => {
        dropdownList.innerHTML = '';
        const filteredData = data.filter(item => item.toLowerCase().includes(filter.toLowerCase()));
        filteredData.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            li.addEventListener('click', () => {
                input.value = item;
                dropdownContainer.style.display = 'none';
            });
            dropdownList.appendChild(li);
        });
    };

    const openDropdown = () => {
        positionDropdown(input, dropdownContainer);
        dropdownContainer.style.display = 'block';
    };

    input.addEventListener('focus', () => {
        populateList();
        openDropdown();
    });

    input.addEventListener('input', () => {
        populateList(input.value);
        openDropdown();
    });

    attachGlobalDropdownListeners();
};


export const Renderer = {
    // 0. 참가자 수동 등록 표는 행이 전부 동적으로 생성된다(초기 행 포함 - main.ts의 createPlayerRow 참고).
    //    행을 만들 때마다 아래 두 헬퍼를 그 자리에서 직접 호출해 티어 자동완성/포지션 옵션을 연결한다.

    /*
     * 포탈된 드롭다운은 더 이상 원래 행(.player-row) 안에 있지 않으므로, 행을 통째로 삭제해도
     * 함께 사라지지 않고 document.body에 고아로 남는다(참가자 추가/삭제를 반복할수록 누적됨).
     * 행을 삭제하기 직전에 반드시 호출해 포탈 요소와 dropdownInstances 등록을 함께 정리한다.
     */
    detachTierAutocomplete(input: HTMLInputElement) {
        const idx = dropdownInstances.findIndex((d) => d.input === input);
        if (idx === -1) return;
        dropdownInstances[idx].container.remove();
        dropdownInstances.splice(idx, 1);
    },

    // 티어 검색형 자동완성을 특정 입력칸에 연결
    attachTierAutocomplete(input: HTMLInputElement) {
        setupSearchableSelect(input, TIERS);
    },

    // 포지션 <option> 목록을 특정 select에 채워 넣음 (동적으로 추가된 행용)
    populatePositionOptions(select: HTMLSelectElement) {
        POSITIONS.forEach(pos => {
            select.add(new Option(pos, pos));
        });
    },

    // 티어별 색상 (선수 상세 정보 모달 등 renderer.ts 바깥에서도 동일한 색상표를 쓰기 위해 노출)
    getTierColor(tier: string): string {
        return getTierColor(tier);
    },

    // 1. 좌측 플레이어 리스트 (경매 순서)
    renderPlayerList(players: Record<string, Player>, order: string[], userRole: string, auctionStatus: string) {
        const el = document.getElementById('player-list');
        if (!el) return;

        // order 배열에 없는 새로 추가된 선수들을 맨 뒤에 추가
        const addedPlayerIds = Object.keys(players).filter(id => !order.includes(id));
        const allPlayerIds = [...order, ...addedPlayerIds];

        const listHtml = allPlayerIds.map(id => {
            const p = players[id];
            if (!p) return '';
            const tierColor = getTierColor(p.currentTier);
            
            // 방장이고 경매 시작 전일 때만 삭제 버튼 표시
            let deleteBtn = '';
            if (userRole === 'team_1' && auctionStatus === 'idle') {
                deleteBtn = `<button class="btn-delete-player" data-id="${p.id}" style="
                    background: transparent; border: none; color: #ff4655; font-size: 16px; 
                    cursor: pointer; padding: 0 5px; float: right;">×</button>`;
            }

            return `<div class="player-card ${p.status}" data-id="${p.id}">
                ${deleteBtn}
                <strong>${escapeHtml(p.name)}</strong> <small style="color:${tierColor}">${escapeHtml(p.currentTier)}</small> <small>(${escapeHtml(p.mainPos)})</small>
            </div>`;
        }).join('');

        el.innerHTML = `<div class="panel-header">PLAYERS (경매 순서)</div><div class="scroll-area">${listHtml}</div>`;
    },

    // 2. 중앙 상세 정보 및 상태 메시지
    renderStage(live: AuctionState, players: Record<string, Player>, teams: Record<string, Team>) {
        const statusEl = document.getElementById('auction-status-message');
        const infoEl = document.getElementById('player-info-area');
        
        if (!statusEl || !infoEl) return;

        // 경매 종료 여부 확인
        const allTeamsFull = Object.values(teams).every((t: any) => (t.members?.length || 0) >= 4);

        // 상태 메시지 렌더링
        let statusHtml = '';
        if (allTeamsFull) {
            statusHtml = `<span style="color:#c8aa6e">경매가 종료되었습니다.</span>`;
        } else if (live.status === 'resuming') {
            statusHtml = `<span style="color:#3fb950">퍼즈 해제! 5초 후 재개됩니다.</span>`;
        } else if (live.status === 'cooldown') {
            if (live.highestBidderId) {
                const winner = teams[live.highestBidderId]?.leaderName;
                statusHtml = `<span style="color:#c8aa6e">${escapeHtml(winner)}</span> 팀에게 <span style="color:#fff">${live.highestBid}P</span> 낙찰!`;
            } else if (live.activePlayerId && players[live.activePlayerId]?.status === 'passed') {
                statusHtml = `<span style="color:#ff4655">유찰되었습니다.</span>`;
            } else {
                statusHtml = `곧 경매가 시작합니다. 준비해 주세요!`;
            }
        } else if (live.status === 'paused') {
            statusHtml = `<span style="color:#ffff00">일시 정지 상태입니다.</span>`;
        } else if (live.status === 'bidding') {
            const currentLeader = live.highestBidderId ? teams[live.highestBidderId] : null;
            statusHtml = `현재 최고가: <span style="color:#ff4655">${live.highestBid || 0}P</span> <span style="font-size:0.8em; color:#c8aa6e">(${currentLeader ? escapeHtml(currentLeader.leaderName) : '입찰 없음'})</span>`;
        } else {
            statusHtml = `경매 대기 중`;
        }
        statusEl.innerHTML = statusHtml;

        // 선수 정보 렌더링 (종료 시 메시지 표시)
        if (allTeamsFull) {
            infoEl.innerHTML = `
                <div style="padding: 40px 0; text-align: center;">
                    <p style="font-size: 18px; color: #888; line-height: 1.6;">
                        모든 팀 구성이 완료되었습니다.<br>
                        방장은 <span style="color: #c8aa6e; font-weight: bold;">결과 다운로드</span> 버튼을 통해 결과를 확인해 주세요.
                    </p>
                </div>
            `;
            return;
        }

        // 쿨타임일 때는 결과 화면 표시
        if (live.status === 'cooldown') {
            let resultTitle = "";
            let resultSub = "다음 경매 준비 중...";

            if (live.highestBidderId) {
                const winner = teams[live.highestBidderId]?.leaderName;
                resultTitle = `<span style="color:#c8aa6e">${escapeHtml(winner)}</span> 팀 <span style="color:#fff">${live.highestBid}P</span> 낙찰!`;
            } else if (live.activePlayerId && players[live.activePlayerId]?.status === 'passed') {
                resultTitle = `<span style="color:#ff4655">유찰되었습니다.</span>`;
            } else {
                resultTitle = "곧 경매가 시작합니다.";
                resultSub = "준비해 주세요!";
            }

            infoEl.innerHTML = `
                <div style="padding: 40px 0; text-align: center;">
                    <h2 style="font-size: 32px; margin-bottom: 20px;">${resultTitle}</h2>
                    <p style="font-size: 18px; color: #888;">${resultSub}</p>
                </div>
            `;
            return;
        }

        if (!live.activePlayerId || !players[live.activePlayerId]) {
            infoEl.innerHTML = `<div style="padding: 50px; color: #888;">대기 중인 선수가 없습니다.</div>`;
            return;
        }

        const p = players[live.activePlayerId];
        const highTierColor = getTierColor(p.highTier);
        const currentTierColor = getTierColor(p.currentTier);

        infoEl.innerHTML = `
            <span class="p-name">${escapeHtml(p.name)}</span>
            <span class="p-nick">(${escapeHtml(p.nickname)})</span>
            <div class="tier-badge">
                <span style="color:#aaa; font-size:0.8em;">최고:</span> <span style="color:${highTierColor}; font-weight:bold;">${escapeHtml(p.highTier)}</span>
                <span style="color:#444; margin:0 8px;">|</span>
                <span style="color:#aaa; font-size:0.8em;">현재:</span> <span style="color:${currentTierColor}; font-weight:bold;">${escapeHtml(p.currentTier)}</span>
            </div>
            <div class="p-info-grid">
                <div><strong>주 포지션:</strong> ${escapeHtml(p.mainPos)}</div>
                <div><strong>부 포지션:</strong> ${escapeHtml(p.subPos)}</div>
                <div class="full"><strong>Most:</strong> ${p.most ? p.most.map(escapeHtml).join(', ') : '-'}</div>
            </div>
        `;
    },

    // 3. 우측 팀 현황
    renderTeams(teams: Record<string, Team>, userRole: string) {
        const el = document.getElementById('team-list');
        if (!el) return;

        const html = Object.values(teams).map(t => {
            const onlineBadge = t.online ? '<span class="online-dot">●</span>' : '<span class="offline-dot">○</span>';
            return `
            <div class="team-card ${userRole === t.id ? 'active' : ''}" data-id="${t.id}">
                <div class="t-header">${onlineBadge} ${escapeHtml(t.leaderName)} ${userRole === t.id ? '(나)' : ''}</div>
                <div class="t-points">${t.points.toLocaleString()} P</div>
                <div class="t-members">멤버: ${t.members?.length || 0} / 4</div>
                <div class="t-pause">퍼즈 남음: ${t.pauseCount}회</div>
            </div>
        `}).join('');

        el.innerHTML = `<div class="panel-header">TEAMS</div><div class="scroll-area">${html}</div>`;
    },

    // 4. 하단 통계바
    renderStats(players: Record<string, Player>) {
        const statsEl = document.getElementById('auction-stats');
        if (!statsEl) return;
        const list = Object.values(players);
        statsEl.innerHTML = `
            <span>남은 인원: ${list.filter(p => p.status === 'waiting').length}</span>
            <span>낙찰: ${list.filter(p => p.status === 'sold').length}</span>
            <span>유찰: ${list.filter(p => p.status === 'passed').length}</span>
        `;
    },

    // 5. 로그 렌더링
    renderLog(log: { msg: string, timestamp: number }) {
        const el = document.getElementById('auction-logs');
        if (!el) return;
        const div = document.createElement('div');
        div.className = 'log-item';
        const time = new Date(log.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        div.innerHTML = `<span style="color:#555; font-size:12px; margin-right:5px;">[${time}]</span> ${log.msg}`;
        el.prepend(div); // 최신 로그가 위로 오게
    },

    // 6. 툴팁 HTML 생성
    getTooltipHtml(p: Player): string {
        const highTierColor = getTierColor(p.highTier);
        const currentTierColor = getTierColor(p.currentTier);
        
        return `
            <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px; color: #fff;">
                ${escapeHtml(p.name)} <span style="font-size: 13px; color: #888; font-weight: normal;">(${escapeHtml(p.nickname)})</span>
            </div>
            <div style="font-size: 13px; line-height: 1.6; color: #ccc;">
                <div><span style="color:#888;">최고:</span> <span style="color:${highTierColor}; font-weight:bold;">${escapeHtml(p.highTier)}</span></div>
                <div><span style="color:#888;">현재:</span> <span style="color:${currentTierColor}; font-weight:bold;">${escapeHtml(p.currentTier)}</span></div>
                <div style="margin-top: 4px;"><span style="color:#888;">주포 / 부포:</span> ${escapeHtml(p.mainPos)} / ${p.subPos ? escapeHtml(p.subPos) : '-'}</div>
                <div><span style="color:#888;">Most:</span> ${p.most ? p.most.map(escapeHtml).join(', ') : '-'}</div>
            </div>
        `;
    }
};