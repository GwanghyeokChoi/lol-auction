import type { Player, Team, AuctionState } from "../types";

export const Renderer = {
    // 1. 좌측 플레이어 리스트 (경매 순서)
    renderPlayerList(players: Record<string, Player>, order: string[]) {
        const el = document.getElementById('player-list');
        if (!el) return;

        const sortedIds = order.length > 0 ? order : Object.keys(players);
        const listHtml = sortedIds.map(id => {
            const p = players[id];
            if (!p) return '';
            return `<div class="player-card ${p.status}" data-id="${p.id}">
                <strong>${p.name}</strong> <small>${p.tier} (${p.mainPos})</small>
            </div>`;
        }).join('');

        el.innerHTML = `<div class="panel-header">PLAYERS (경매 순서)</div><div class="scroll-area">${listHtml}</div>`;
    },

    // 2. 중앙 상세 정보
    renderStage(live: AuctionState, players: Record<string, Player>, teams: Record<string, Team>) {
        const el = document.getElementById('auction-stage-info');
        if (!el) return;

        if (live.status === 'cooldown') {
            const winner = live.highestBidderId ? teams[live.highestBidderId]?.leaderName : "유찰";
            const resultText = live.highestBidderId 
                ? `<span style="color:#c8aa6e">${winner}</span> 팀에게 <span style="color:#fff">${live.highestBid}P</span> 낙찰!` 
                : `입찰자가 없어 <span style="color:#ff4655">유찰</span>되었습니다.`;

            el.innerHTML = `
                <div class="player-detail-card">
                    <div class="cooldown-notice">
                        <h2>경매 종료</h2>
                        <p style="font-size: 18px; margin-top: 10px;">${resultText}</p>
                        <p style="color: #888; margin-top: 20px;">잠시 후 다음 선수가 등장합니다...</p>
                    </div>
                </div>`;
            return;
        }

        if (!live.activePlayerId || !players[live.activePlayerId]) {
            el.innerHTML = `<div class="idle-notice" style="text-align:center; padding:50px;">
                <h2>경매 대기 중</h2>
                <p>방장이 '경매 시작'을 누르면 진행됩니다.</p>
            </div>`;
            return;
        }

        const p = players[live.activePlayerId];
        const highestBidder = live.highestBidderId ? teams[live.highestBidderId] : null;

        el.innerHTML = `
            <div class="player-detail-card">
                <span class="p-name">${p.name}</span>
                <span class="p-nick">(${p.nickname})</span>
                <div class="tier-badge">${p.tier}</div>
                <div class="p-info-grid">
                    <div><strong>주 포지션:</strong> ${p.mainPos}</div>
                    <div><strong>부 포지션:</strong> ${p.subPos}</div>
                    <div class="full"><strong>Most:</strong> ${p.most ? p.most.join(', ') : '-'}</div>
                </div>
                <div class="turn-box ${live.status === 'paused' ? 'paused' : ''}">
                    ${live.status === 'paused' 
                        ? '⏸ 퍼즈 중' 
                        : `현재 최고가: <strong style="color: #ff4655; font-size: 28px;">${live.highestBid || 0} P</strong><br>
                           <span style="font-size: 16px; color: #c8aa6e;">${highestBidder ? `👑 ${highestBidder.leaderName}` : '(입찰 없음)'}</span>`
                    }
                </div>
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
    }
};