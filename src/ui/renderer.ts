import type { Player, Team, AuctionState } from "../types";

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

export const Renderer = {
    // 1. 좌측 플레이어 리스트 (경매 순서)
    renderPlayerList(players: Record<string, Player>, order: string[]) {
        const el = document.getElementById('player-list');
        if (!el) return;

        const sortedIds = order.length > 0 ? order : Object.keys(players);
        const listHtml = sortedIds.map(id => {
            const p = players[id];
            if (!p) return '';
            const tierColor = getTierColor(p.currentTier);
            return `<div class="player-card ${p.status}" data-id="${p.id}">
                <strong>${p.name}</strong> <small style="color:${tierColor}">${p.currentTier}</small> <small>(${p.mainPos})</small>
            </div>`;
        }).join('');

        el.innerHTML = `<div class="panel-header">PLAYERS (경매 순서)</div><div class="scroll-area">${listHtml}</div>`;
    },

    // 2. 중앙 상세 정보 및 상태 메시지
    renderStage(live: AuctionState, players: Record<string, Player>, teams: Record<string, Team>) {
        const statusEl = document.getElementById('auction-status-message');
        const infoEl = document.getElementById('player-info-area');
        
        if (!statusEl || !infoEl) return;

        // 상태 메시지 렌더링
        let statusHtml = '';
        if (live.status === 'resuming') {
            statusHtml = `<span style="color:#3fb950">퍼즈 해제! 5초 후 재개됩니다.</span>`;
        } else if (live.status === 'cooldown') {
            if (live.highestBidderId) {
                const winner = teams[live.highestBidderId]?.leaderName;
                statusHtml = `<span style="color:#c8aa6e">${winner}</span> 팀에게 <span style="color:#fff">${live.highestBid}P</span> 낙찰!`;
            } else if (live.activePlayerId && players[live.activePlayerId]?.status === 'passed') {
                statusHtml = `<span style="color:#ff4655">유찰되었습니다.</span>`;
            } else {
                statusHtml = `곧 경매가 시작합니다. 준비해 주세요!`;
            }
        } else if (live.status === 'paused') {
            statusHtml = `<span style="color:#ffff00">일시 정지 상태입니다.</span>`;
        } else if (live.status === 'bidding') {
            const currentLeader = live.highestBidderId ? teams[live.highestBidderId] : null;
            statusHtml = `현재 최고가: <span style="color:#ff4655">${live.highestBid || 0}P</span> <span style="font-size:0.8em; color:#c8aa6e">(${currentLeader ? currentLeader.leaderName : '입찰 없음'})</span>`;
        } else {
            statusHtml = `경매 대기 중`;
        }
        statusEl.innerHTML = statusHtml;

        // 선수 정보 렌더링
        if (!live.activePlayerId || !players[live.activePlayerId]) {
            infoEl.innerHTML = `<div style="padding: 50px; color: #888;">대기 중인 선수가 없습니다.</div>`;
            return;
        }

        const p = players[live.activePlayerId];
        const highTierColor = getTierColor(p.highTier);
        const currentTierColor = getTierColor(p.currentTier);

        infoEl.innerHTML = `
            <span class="p-name">${p.name}</span>
            <span class="p-nick">(${p.nickname})</span>
            <div class="tier-badge">
                <span style="color:#aaa; font-size:0.8em;">최고:</span> <span style="color:${highTierColor}; font-weight:bold;">${p.highTier}</span>
                <span style="color:#444; margin:0 8px;">|</span>
                <span style="color:#aaa; font-size:0.8em;">현재:</span> <span style="color:${currentTierColor}; font-weight:bold;">${p.currentTier}</span>
            </div>
            <div class="p-info-grid">
                <div><strong>주 포지션:</strong> ${p.mainPos}</div>
                <div><strong>부 포지션:</strong> ${p.subPos}</div>
                <div class="full"><strong>Most:</strong> ${p.most ? p.most.join(', ') : '-'}</div>
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
                <div class="t-header">${onlineBadge} ${t.leaderName} ${userRole === t.id ? '(나)' : ''}</div>
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

    // 6. 툴팁 HTML 생성 (추가)
    getTooltipHtml(p: Player): string {
        const highTierColor = getTierColor(p.highTier);
        const currentTierColor = getTierColor(p.currentTier);

        return `
            <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px; color: #fff;">
                ${p.name} <span style="font-size: 13px; color: #888; font-weight: normal;">(${p.nickname})</span>
            </div>
            <div style="font-size: 13px; line-height: 1.6; color: #ccc;">
                <div><span style="color:#888;">최고:</span> <span style="color:${highTierColor}; font-weight:bold;">${p.highTier}</span></div>
                <div><span style="color:#888;">현재:</span> <span style="color:${currentTierColor}; font-weight:bold;">${p.currentTier}</span></div>
                <div style="margin-top: 4px;"><span style="color:#888;">주포 / 부포:</span> ${p.mainPos} / ${p.subPos || '-'}</div>
                <div><span style="color:#888;">Most:</span> ${p.most ? p.most.join(', ') : '-'}</div>
            </div>
        `;
    }
};