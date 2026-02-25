import './styles/auction.css';
import { db } from './firebase';
import { ref, onValue, onChildAdded } from 'firebase/database';
import { AuctionService } from './services/auctionService';
import { RoomService } from './services/roomService';
import { Renderer } from './ui/renderer';
import { CSVService } from './services/csvService';

const urlParams = new URLSearchParams(window.location.search);
const currentRoomId = urlParams.get('id');
const userRole = urlParams.get('role') || 'viewer';

let latestData: any = null;

window.addEventListener('DOMContentLoaded', () => {
    const setupScreen = document.getElementById('setup-screen') as HTMLElement;
    const modalStep1 = document.getElementById('modal-step-1') as HTMLElement;
    const modalStep2 = document.getElementById('modal-step-2') as HTMLElement;
    const auctionContainer = document.querySelector('.auction-container') as HTMLElement;
    const leaderInputList = document.getElementById('leader-input-list') as HTMLElement;
    const linkArea = document.getElementById('generated-links-area') as HTMLElement;

    // --- [방 생성 UI 제어] ---
    const reIndexLeaders = () => {
        const rows = leaderInputList.querySelectorAll('.leader-row');
        rows.forEach((row, idx) => {
            const currentIdx = idx + 1;
            const input = row.querySelector('.leader-name-input') as HTMLInputElement;
            input.placeholder = currentIdx === 1 ? `팀장 1 이름 (방장)` : `팀장 ${currentIdx} 이름`;
        });
    };

    document.getElementById('btn-add-leader')?.addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'leader-row';
        row.innerHTML = `
            <input type="text" class="leader-name-input">
            <input type="number" class="leader-point-input" value="1000" placeholder="P">
            <button type="button" class="btn-remove-leader">-</button>
        `;
        row.querySelector('.btn-remove-leader')?.addEventListener('click', () => {
            row.remove();
            reIndexLeaders();
        });
        leaderInputList.appendChild(row);
        reIndexLeaders();
    });

    document.getElementById('btn-generate-links')?.addEventListener('click', async () => {
        const rows = leaderInputList.querySelectorAll('.leader-row');
        const names: { name: string, points: number }[] = [];
        
        rows.forEach(row => {
            const nameInput = row.querySelector('.leader-name-input') as HTMLInputElement;
            const pointInput = row.querySelector('.leader-point-input') as HTMLInputElement;
            const name = nameInput.value.trim();
            if (name) {
                names.push({ 
                    name, 
                    points: parseInt(pointInput.value) || 1000 
                });
            }
        });

        if (names.length < 2) return alert("팀장을 2명 이상 입력하세요.");
        const roomId = "ROOM_" + Math.random().toString(36).substring(2, 7).toUpperCase();
        const baseUrl = window.location.origin + window.location.pathname;

        const teams: any = {};
        let linksHtml = "";
        
        const viewerLink = `${baseUrl}?id=${roomId}&role=viewer`;
        linksHtml += `
            <div class="link-label">👀 관전자 링크</div>
            <div class="link-row">
                <input type="text" value="${viewerLink}" readonly>
                <button class="btn-copy" data-link="${viewerLink}">복사</button>
            </div>
            <hr style="border: 0; border-top: 1px solid #333; margin: 10px 0;">
        `;

        names.forEach((item, i) => {
            const tid = `team_${i + 1}`;
            teams[tid] = { id: tid, leaderName: item.name, points: item.points, members: [], pauseCount: 2 };
            const tLink = `${baseUrl}?id=${roomId}&role=${tid}`;
            linksHtml += `
                <div class="link-label">${i === 0 ? '👑 (방장) ' : ''}${item.name} (${item.points}P)</div>
                <div class="link-row">
                    <input type="text" value="${tLink}" readonly>
                    <button class="btn-copy" data-link="${tLink}">복사</button>
                </div>`;
        });

        await RoomService.createRoom(roomId, teams, names[0].points);

        linkArea.innerHTML = linksHtml;
        modalStep1.classList.add('dimmed');
        modalStep2.style.display = 'block';

        modalStep2.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                navigator.clipboard.writeText(target.getAttribute('data-link') || '');
                target.innerText = "완료!";
                setTimeout(() => target.innerText = "복사", 1000);
            });
        });
    });

    document.getElementById('btn-close-result')?.addEventListener('click', () => {
        modalStep2.style.display = 'none';
        modalStep1.classList.remove('dimmed');
    });

    document.getElementById('btn-enter-as-admin')?.addEventListener('click', () => {
        const firstLink = modalStep2.querySelectorAll('input')[1]?.value;
        if (firstLink) window.location.href = firstLink;
    });

    // --- [실시간 경매 로직] ---
    if (currentRoomId) {
        setupScreen.style.display = 'none';
        auctionContainer.style.display = 'grid';

        if (userRole !== 'viewer') {
            RoomService.connectToRoom(currentRoomId, userRole);
        }

        if (userRole === 'viewer') {
            const biddingControls = document.getElementById('bidding-controls');
            if (biddingControls) biddingControls.style.display = 'none';
            
            const adminControls = document.getElementById('admin-controls');
            if (adminControls) adminControls.style.display = 'none';
        }

        onChildAdded(ref(db, `rooms/${currentRoomId}/logs`), (snap) => {
            Renderer.renderLog(snap.val());
        });

        onValue(ref(db, `rooms/${currentRoomId}`), (snap) => {
            const data = snap.val();
            if (!data) return;
            latestData = data;

            Renderer.renderPlayerList(data.players || {}, data.live.playerOrder || []);
            Renderer.renderStage(data.live, data.players || {}, data.teams || {});
            Renderer.renderTeams(data.teams || {}, userRole);
            Renderer.renderStats(data.players || {});

            const adminZone = document.getElementById('admin-controls');
            const btnUpload = document.getElementById('btn-upload-csv');
            const btnStart = document.getElementById('btn-start-auction');
            const btnDownload = document.getElementById('btn-download-result');
            const resumeBtn = document.getElementById('btn-resume-auction');
            const pauseBtn = document.getElementById('btn-pause');

            if (userRole === 'team_1' && adminZone) {
                adminZone.style.display = 'block';

                const allTeamsFull = Object.values(data.teams).every((t: any) => (t.members?.length || 0) >= 4);

                if (allTeamsFull) {
                    if (btnUpload) btnUpload.style.display = 'none';
                    if (btnStart) btnStart.style.display = 'none';
                    if (btnDownload) btnDownload.style.display = 'inline-block';
                } else if (data.live.status !== 'idle') {
                    if (btnUpload) btnUpload.style.display = 'none';
                    if (btnStart) btnStart.style.display = 'none';
                    if (btnDownload) btnDownload.style.display = 'none';
                } else {
                    if (btnUpload) btnUpload.style.display = 'inline-block';
                    if (btnStart) btnStart.style.display = 'inline-block';
                    if (btnDownload) btnDownload.style.display = 'none';
                }
            }

            if (data.live.status === 'paused') {
                if (pauseBtn) pauseBtn.style.display = 'none';
                if (resumeBtn) {
                    if (userRole === 'team_1' || userRole === data.live.pausedBy) {
                        resumeBtn.style.display = 'inline-block';
                    } else {
                        resumeBtn.style.display = 'none';
                    }
                }
            } else {
                if (pauseBtn) pauseBtn.style.display = 'inline-block';
                if (resumeBtn) resumeBtn.style.display = 'none';
            }
        });

        // 타이머 UI 갱신 (0.1초마다)
        setInterval(() => {
            if (!latestData) return;
            const live = latestData.live;
            const timerEl = document.getElementById('timer');
            if (!timerEl) return;

            if (live.status === 'idle') {
                // 모든 팀이 꽉 찼는지 확인하여 종료 문구 표시
                const allTeamsFull = Object.values(latestData.teams).every((t: any) => (t.members?.length || 0) >= 4);
                if (allTeamsFull) {
                    timerEl.innerText = "END";
                    timerEl.style.color = "#c8aa6e";
                } else {
                    timerEl.innerText = "Ready";
                    timerEl.style.color = "#fff";
                }
            } else if (live.status === 'paused') {
                const diff = Math.ceil((live.pauseLimitTime - Date.now()) / 1000);
                timerEl.innerText = diff > 0 ? `PAUSE ${diff}s` : "PAUSE 0s";
                timerEl.style.color = "#ffff00";
            } else if (live.status === 'resuming') {
                const diff = Math.ceil((live.nextAuctionTime - Date.now()) / 1000);
                timerEl.innerText = diff > 0 ? `RESUME ${diff}s` : "GO!";
                timerEl.style.color = "#3fb950";
            } else {
                const target = live.status === 'bidding' ? live.endTime : live.nextAuctionTime;
                const diff = Math.ceil((target - Date.now()) / 1000);
                
                if (diff <= 0) {
                    timerEl.innerText = "0";
                    timerEl.style.color = "#ff4655";
                } else {
                    timerEl.innerText = diff.toString();
                    timerEl.style.color = (live.status === 'bidding' && diff <= 5) ? "#ff4655" : "#fff";
                }
            }
        }, 100);

        // 방장 전용 상태 체크 (1초마다)
        if (userRole === 'team_1') {
            setInterval(() => {
                if (!latestData) return;
                const live = latestData.live;
                const now = Date.now();

                if (live.status === 'cooldown' && now > live.nextAuctionTime) {
                    AuctionService.nextPlayer(currentRoomId);
                }
                
                if (live.status === 'bidding' && now > live.endTime) {
                    AuctionService.finalize(currentRoomId);
                }

                if (live.status === 'paused' && now > live.pauseLimitTime) {
                    AuctionService.resumeAuction(currentRoomId, 'team_1');
                }

                // 재개 대기 종료 -> 경매 시작
                if (live.status === 'resuming' && now > live.nextAuctionTime) {
                    AuctionService.startBidding(currentRoomId);
                }
            }, 1000);
        }
    }

    // 버튼 바인딩
    document.getElementById('btn-start-auction')?.addEventListener('click', () => {
        if (userRole === 'team_1') RoomService.startAuctionProcess(currentRoomId!);
    });

    document.querySelectorAll('.btn-bid').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const amt = parseInt((e.target as HTMLElement).dataset.amount || "0");
            AuctionService.placeBid(currentRoomId!, userRole, amt);
        });
    });

    const customBidInput = document.getElementById('custom-bid-input') as HTMLInputElement;
    const btnCustomBid = document.getElementById('btn-custom-bid');

    const handleCustomBid = () => {
        const val = parseInt(customBidInput.value);
        if (isNaN(val) || val < 0) return alert("올바른 금액을 입력하세요.");
        AuctionService.placeTargetBid(currentRoomId!, userRole, val);
        customBidInput.value = "";
    };

    btnCustomBid?.addEventListener('click', handleCustomBid);
    customBidInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleCustomBid();
    });

    document.getElementById('btn-pause')?.addEventListener('click', () => {
        AuctionService.pauseAuction(currentRoomId!, userRole);
    });

    document.getElementById('btn-resume-auction')?.addEventListener('click', () => {
        AuctionService.resumeAuction(currentRoomId!, userRole);
    });

    document.getElementById('btn-download-result')?.addEventListener('click', () => {
        if (!latestData) return;
        CSVService.exportResults(latestData.teams, latestData.players);
    });

    document.getElementById('btn-upload-csv')?.addEventListener('click', () => {
        document.getElementById('csv-upload')?.click();
    });

    document.getElementById('csv-upload')?.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        
        try {
            const players = await CSVService.parsePlayers(file);
            await RoomService.registerPlayers(currentRoomId!, players);
            alert(`선수 ${Object.keys(players).length}명 등록 완료!`);
        } catch (err) {
            alert("CSV 파싱 실패");
        }
    });

    document.getElementById('btn-close-team-modal')?.addEventListener('click', () => {
        document.getElementById('team-detail-modal')!.style.display = 'none';
    });
    document.getElementById('btn-close-player-modal')?.addEventListener('click', () => {
        document.getElementById('player-info-modal')!.style.display = 'none';
    });

    document.getElementById('team-list')?.addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest('.team-card');
        if (!card || !latestData) return;
        const teamId = card.getAttribute('data-id');
        if (!teamId) return;

        const team = latestData.teams[teamId];
        const players = latestData.players;
        const members = team.members || [];

        const modal = document.getElementById('team-detail-modal');
        const title = document.getElementById('team-modal-title');
        const content = document.getElementById('team-modal-members');

        if (modal && title && content) {
            title.innerText = `${team.leaderName} 팀 정보`;
            content.innerHTML = members.length > 0 
                ? members.map((pid: string) => {
                    const p = players[pid];
                    return `<div class="player-card sold">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <strong>${p.name}</strong> 
                            <small style="background:#333; padding:2px 6px; border-radius:4px;">${p.tier}</small>
                        </div>
                        <div style="font-size:12px; color:#aaa; margin-top:6px; line-height:1.4;">
                            <div>포지션: ${p.mainPos} ${p.subPos ? `/ ${p.subPos}` : ''}</div>
                            <div>Most: ${p.most ? p.most.join(', ') : '-'}</div>
                        </div>
                    </div>`;
                }).join('')
                : '<p style="text-align:center; color:#888;">아직 낙찰된 선수가 없습니다.</p>';
            
            modal.style.display = 'flex';
        }
    });

    document.getElementById('player-list')?.addEventListener('click', (e) => {
        const card = (e.target as HTMLElement).closest('.player-card');
        if (!card || !latestData) return;
        const playerId = card.getAttribute('data-id');
        if (!playerId) return;

        const p = latestData.players[playerId];
        const isStarted = latestData.live.status !== 'idle';

        const modal = document.getElementById('player-info-modal');
        const name = document.getElementById('player-modal-name');
        const detail = document.getElementById('player-modal-detail');

        if (modal && name && detail) {
            name.innerText = `${p.name} (${p.nickname})`;
            
            let statusText = '';
            let statusColor = '#fff';

            if (p.status === 'sold') {
                const teams = latestData.teams;
                let soldTeamName = '알 수 없음';
                for (const tid in teams) {
                    if (teams[tid].members && teams[tid].members.includes(playerId)) {
                        soldTeamName = teams[tid].leaderName;
                        break;
                    }
                }
                statusText = `낙찰됨 - ${soldTeamName} 팀`;
                statusColor = '#c8aa6e';
            } else if (p.status === 'passed') {
                statusText = '유찰됨';
                statusColor = '#ff4655';
            } else if (p.status === 'bidding') {
                statusText = '현재 경매 진행 중 🔥';
                statusColor = '#00bcff';
            } else {
                statusText = '경매 대기 중';
                statusColor = '#888';
            }

            let infoHtml = `
                <div style="margin-bottom:15px; text-align:center; font-size:16px; font-weight:bold; color:${statusColor}; border:1px solid ${statusColor}; padding:8px; border-radius:4px;">
                    ${statusText}
                </div>
                <div style="margin-bottom:10px;"><strong>티어:</strong> ${p.tier}</div>
                <div style="margin-bottom:10px;"><strong>주 포지션:</strong> ${p.mainPos}</div>
            `;

            if (isStarted) {
                infoHtml += `
                    <div style="margin-bottom:10px;"><strong>부 포지션:</strong> ${p.subPos}</div>
                    <div><strong>Most:</strong> ${p.most.join(', ')}</div>
                `;
            } else {
                infoHtml += `<div style="color:#888; margin-top:20px; text-align:center;">🔒 경매가 시작되면 상세 정보가 공개됩니다.</div>`;
            }

            detail.innerHTML = infoHtml;
            modal.style.display = 'flex';
        }
    });
});