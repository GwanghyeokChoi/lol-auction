import './styles/auction.css';
import { db } from './firebase';
import { ref, onValue, onChildAdded, update } from 'firebase/database';
import { AuctionService } from './services/auctionService';
import { RoomService } from './services/roomService';
import { Renderer } from './ui/renderer';
import { CSVService } from './services/csvService';
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from './constants/terms';
import { HELP_CONTENT, UPDATE_LOG, LATEST_PATCH_VERSION } from './constants/content';
import { TimerUtils } from './utils/timer';
import { escapeHtml } from './utils/sanitize';
import { buildPlayersFromRows, type PlayerRowInput } from './utils/playerRows';

const urlParams = new URLSearchParams(window.location.search);
const currentRoomId = urlParams.get('id');
const userRole = urlParams.get('role') || 'viewer';

// 최신 데이터 상태 저장용 (타이머 트리거를 위해)
let latestData: any = null;
// 선수 상세 정보 모달에서 "참가자 정보 수정"을 눌렀을 때 어떤 선수를 수정 중인지 추적
let currentInfoPlayerId: string | null = null;

// 서버 시간 오프셋 초기화
TimerUtils.initServerTimeOffset();

window.addEventListener('DOMContentLoaded', () => {
    const landingScreen = document.getElementById('landing-screen') as HTMLElement;
    const setupScreen = document.getElementById('setup-screen') as HTMLElement;
    const modalStep1 = document.getElementById('modal-step-1') as HTMLElement;
    const modalStep2 = document.getElementById('modal-step-2') as HTMLElement;
    const auctionContainer = document.querySelector('.auction-container') as HTMLElement;
    const leaderInputList = document.getElementById('leader-input-list') as HTMLElement;
    const linkArea = document.getElementById('generated-links-area') as HTMLElement;

    // --- [초기 화면 제어] ---
    if (currentRoomId) {
        // 방에 입장한 경우: 랜딩/설정 숨기고 경매장 표시
        if (landingScreen) landingScreen.style.display = 'none';
        if (setupScreen) setupScreen.style.display = 'none';
        auctionContainer.style.display = 'grid';
    } else {
        // 메인 접속: 랜딩 페이지 표시
        if (landingScreen) landingScreen.style.display = 'flex';
        if (setupScreen) setupScreen.style.display = 'none';
        auctionContainer.style.display = 'none';
    }

    // --- [Header Events] ---
    document.getElementById('site-logo')?.addEventListener('click', () => {
        // SPA 방식 화면 전환 (새로고침 방지)
        if (landingScreen) landingScreen.style.display = 'flex';
        if (setupScreen) setupScreen.style.display = 'none';
        if (auctionContainer) auctionContainer.style.display = 'none';
        
        // URL 파라미터 제거 (메인 URL로 변경)
        const newUrl = window.location.origin + window.location.pathname;
        window.history.pushState({ path: newUrl }, '', newUrl);
    });

    const helpModal = document.getElementById('help-modal');
    const helpContent = document.getElementById('help-content');
    document.getElementById('btn-open-help')?.addEventListener('click', () => {
        if (helpModal && helpContent) {
            helpContent.innerHTML = HELP_CONTENT;
            helpModal.style.display = 'flex';
        }
    });
    document.getElementById('btn-close-help')?.addEventListener('click', () => {
        if (helpModal) helpModal.style.display = 'none';
    });

    // --- [패치노트 모달: 수동 열기 + 신규 버전 자동 노출] ---
    const LAST_SEEN_PATCH_KEY = 'lastSeenPatchVersion';
    const updateModal = document.getElementById('update-modal');
    const updateContent = document.getElementById('update-content');

    const openUpdateModal = () => {
        if (updateModal && updateContent) {
            updateContent.innerHTML = UPDATE_LOG;
            updateModal.style.display = 'flex';
        }
    };
    // 모달을 닫거나(X) 확인한 시점의 최신 버전을 저장 -> 그 버전에 대해서는 다시 자동으로 뜨지 않음
    const markPatchNoteAsSeen = () => {
        localStorage.setItem(LAST_SEEN_PATCH_KEY, LATEST_PATCH_VERSION);
    };

    document.getElementById('btn-open-update')?.addEventListener('click', openUpdateModal);
    document.getElementById('btn-close-update')?.addEventListener('click', () => {
        if (updateModal) updateModal.style.display = 'none';
        markPatchNoteAsSeen();
    });

    // 메인(랜딩) 페이지 접속 시, 아직 확인하지 않은 새 버전의 패치노트가 있으면 자동으로 띄운다.
    // 경매방에 직접 링크로 입장한 경우(currentRoomId 있음)는 진행 중인 화면을 가리지 않도록 대상에서 제외.
    if (!currentRoomId && localStorage.getItem(LAST_SEEN_PATCH_KEY) !== LATEST_PATCH_VERSION) {
        openUpdateModal();
    }

    // --- [Landing Page Events] ---
    document.getElementById('btn-go-setup')?.addEventListener('click', () => {
        if (landingScreen) landingScreen.style.display = 'none';
        if (setupScreen) setupScreen.style.display = 'flex';
    });


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
        
        // 관전자 링크 추가
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
                <div class="link-label">${i === 0 ? '👑 (방장) ' : ''}${escapeHtml(item.name)} (${item.points}P)</div>
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
        const firstLink = modalStep2.querySelectorAll('input')[1]?.value; // 0번은 관전자 링크일 수 있으므로 확인 필요하지만, 보통 방장이 첫번째 팀장
        if (firstLink) window.open(firstLink, '_blank'); // 새 탭으로 열기
    });

    // --- [실시간 경매 로직] ---
    if (currentRoomId) {
        // 접속 상태 알림 시작 (팀장인 경우만)
        if (userRole !== 'viewer') {
            RoomService.connectToRoom(currentRoomId, userRole);
        }

        // 관전자 모드 처리
        if (userRole === 'viewer') {
            const biddingControls = document.getElementById('bidding-controls');
            if (biddingControls) biddingControls.style.display = 'none';
            
            const adminControls = document.getElementById('admin-controls');
            if (adminControls) adminControls.style.display = 'none';
            
            // control-panel 자체를 숨겨서 log-container가 확장되도록 함
            const controlPanel = document.getElementById('control-panel-container');
            if (controlPanel) controlPanel.style.display = 'none';
            
            // 로그 컨테이너의 우측 보더 제거 (스타일 조정)
            const logContainer = document.getElementById('auction-logs');
            if (logContainer) logContainer.style.borderRight = 'none';
        }

        // 로그 구독
        onChildAdded(ref(db, `rooms/${currentRoomId}/logs`), (snap) => {
            Renderer.renderLog(snap.val());
        });

        onValue(ref(db, `rooms/${currentRoomId}`), (snap) => {
            const data = snap.val();
            if (!data) return;
            latestData = data; // 최신 데이터 저장

            // Renderer 호출
            Renderer.renderPlayerList(data.players || {}, data.live.playerOrder || [], userRole, data.live.status);
            Renderer.renderStage(data.live, data.players || {}, data.teams || {});
            Renderer.renderTeams(data.teams || {}, userRole);
            Renderer.renderStats(data.players || {});

            const adminZone = document.getElementById('admin-controls');
            const btnUpload = document.getElementById('btn-upload-csv');
            const btnStart = document.getElementById('btn-start-auction');
            // 다운로드 버튼은 admin-controls에서 제거하고 bidding-controls 내부로 이동했으므로 주석 처리 또는 무시
            // const btnDownload = document.getElementById('btn-download-result'); 
            const resumeBtn = document.getElementById('btn-resume-auction');
            const pauseBtn = document.getElementById('btn-pause');
            
            // 새로운 위치의 다운로드 버튼
            const downloadBtnNew = document.getElementById('btn-download-result');

            // 방장 전용 참가자 수동 추가 버튼 표시
            const addPlayerZone = document.getElementById('admin-add-player-zone');
            if (userRole === 'team_1' && addPlayerZone) {
                // 경매 시작 전(idle)에만 수동 추가 허용
                if (data.live.status === 'idle') {
                    addPlayerZone.style.display = 'block';
                } else {
                    addPlayerZone.style.display = 'none';
                }
            }

            // 모든 팀이 꽉 찼는지 확인 (경매 종료 여부)
            const allTeamsFull = Object.values(data.teams).every((t: any) => (t.members?.length || 0) >= 4);

            if (allTeamsFull) {
                // --- [경매 종료 상태] ---
                // 1. 퍼즈/재개 버튼 숨김
                if (pauseBtn) pauseBtn.style.display = 'none';
                if (resumeBtn) resumeBtn.style.display = 'none';

                // 2. 결과 다운로드 버튼 표시 (방장만)
                if (userRole === 'team_1') {
                    if (downloadBtnNew) downloadBtnNew.style.display = 'block'; // block으로 넓게 표시
                    if (adminZone) adminZone.style.display = 'none'; // admin-controls 완전 숨김
                } else {
                    if (downloadBtnNew) downloadBtnNew.style.display = 'none';
                }
            } else {
                // --- [경매 진행 중 또는 대기 중] ---
                // 1. 결과 다운로드 버튼 숨김
                if (downloadBtnNew) downloadBtnNew.style.display = 'none';

                // 2. 방장 컨트롤 (업로드/시작)
                if (userRole === 'team_1' && adminZone) {
                    if (data.live.status !== 'idle') {
                        // 진행 중 -> 숨김
                        adminZone.style.display = 'none';
                    } else {
                        // 대기 중 -> 보임
                        adminZone.style.display = 'block';
                        if (btnUpload) btnUpload.style.display = 'inline-block';
                        if (btnStart) btnStart.style.display = 'inline-block';
                    }
                }

                // 3. 퍼즈/재개 버튼 표시 로직
                if (data.live.status === 'paused') {
                    if (pauseBtn) pauseBtn.style.display = 'none';
                    if (resumeBtn) {
                        // 퍼즈 건 본인만 표시
                        if (userRole === data.live.pausedBy) {
                            resumeBtn.style.display = 'inline-block';
                        } else {
                            resumeBtn.style.display = 'none';
                        }
                    }
                } else {
                    if (pauseBtn) pauseBtn.style.display = 'inline-block';
                    if (resumeBtn) resumeBtn.style.display = 'none';
                }
            }
        });

        // 타이머 UI 갱신 (0.1초마다)
        setInterval(() => {
            if (!latestData) return;
            const live = latestData.live;
            const timerEl = document.getElementById('timer');
            if (!timerEl) return;
            
            const now = TimerUtils.getServerTime(); // 서버 시간 사용

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
                const diff = Math.ceil((live.pauseLimitTime - now) / 1000);
                timerEl.innerText = diff > 0 ? `PAUSE ${diff}s` : "PAUSE 0s";
                timerEl.style.color = "#ffff00";
            } else if (live.status === 'resuming') {
                const diff = Math.ceil((live.nextAuctionTime - now) / 1000);
                timerEl.innerText = diff > 0 ? `RESUME ${diff}s` : "GO!";
                timerEl.style.color = "#3fb950";
            } else {
                const target = live.status === 'bidding' ? live.endTime : live.nextAuctionTime;
                const diff = Math.ceil((target - now) / 1000);
                
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
                const now = TimerUtils.getServerTime(); // 서버 시간 사용

                // 1. 쿨타임 종료 -> 다음 선수 호출
                if (live.status === 'cooldown' && now > live.nextAuctionTime) {
                    AuctionService.nextPlayer(currentRoomId);
                }
                
                // 2. 입찰 시간 종료 -> 낙찰/유찰 처리
                if (live.status === 'bidding' && now > live.endTime) {
                    AuctionService.finalize(currentRoomId);
                }

                // 3. 퍼즈 시간 종료 -> 강제 재개
                if (live.status === 'paused' && now > live.pauseLimitTime) {
                    AuctionService.resumeAuction(currentRoomId); // requestorId 없이 호출 (시스템 강제 재개)
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

    // 빠른 입찰 버튼
    document.querySelectorAll('.btn-bid').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const amt = parseInt((e.target as HTMLElement).dataset.amount || "0");
            AuctionService.placeBid(currentRoomId!, userRole, amt);
        });
    });

    // 직접 입찰 버튼
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

    // 퍼즈 버튼
    document.getElementById('btn-pause')?.addEventListener('click', () => {
        AuctionService.pauseAuction(currentRoomId!, userRole);
    });

    // 재개 버튼
    document.getElementById('btn-resume-auction')?.addEventListener('click', () => {
        AuctionService.resumeAuction(currentRoomId!, userRole);
    });

    // 결과 다운로드 버튼
    document.getElementById('btn-download-result')?.addEventListener('click', () => {
        if (!latestData) return;
        CSVService.exportResults(latestData.teams, latestData.players);
    });

    // CSV 업로드
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

    // --- [수동 참가자 일괄 등록 로직] ---
    // 참가자 1명당 한 행(row)인 표 형태. leader-row(+팀장 추가/-삭제)와 동일한 UX 패턴을 재사용한다.
    const addPlayerModal = document.getElementById('add-player-modal');
    const addPlayerRowsContainer = document.getElementById('add-player-rows') as HTMLElement;
    const INITIAL_PLAYER_ROWS = 4;

    // 한 행을 생성. "+참가자 추가" 클릭 시와 모달 초기화(최초 진입/등록 성공 후) 시 동일하게 사용한다.
    const createPlayerRow = (): HTMLDivElement => {
        const row = document.createElement('div');
        row.className = 'player-row';
        row.innerHTML = `
            <input type="text" class="p-name-input bid-input" placeholder="이름">
            <input type="text" class="p-nick-input bid-input" placeholder="닉네임">
            <div class="searchable-select-container">
                <input type="text" class="p-hightier-input searchable-select-input bid-input" placeholder="티어 검색">
                <div class="tier-dropdown-list-container"><ul class="tier-dropdown-list"></ul></div>
            </div>
            <div class="searchable-select-container">
                <input type="text" class="p-currtier-input searchable-select-input bid-input" placeholder="티어 검색">
                <div class="tier-dropdown-list-container"><ul class="tier-dropdown-list"></ul></div>
            </div>
            <select class="p-mainpos-select bid-input">
                <option value="" selected>선택</option>
            </select>
            <select class="p-subpos-select bid-input">
                <option value="">없음</option>
            </select>
            <input type="text" class="p-most-input bid-input" placeholder="아리, 제드, 르블랑">
            <button type="button" class="btn-remove-leader">-</button>
        `;

        const highTierInput = row.querySelector('.p-hightier-input') as HTMLInputElement;
        const currTierInput = row.querySelector('.p-currtier-input') as HTMLInputElement;
        Renderer.attachTierAutocomplete(highTierInput);
        Renderer.attachTierAutocomplete(currTierInput);
        Renderer.populatePositionOptions(row.querySelector('.p-mainpos-select') as HTMLSelectElement);
        Renderer.populatePositionOptions(row.querySelector('.p-subpos-select') as HTMLSelectElement);

        row.querySelector('.btn-remove-leader')?.addEventListener('click', () => {
            // 티어 드롭다운은 document.body로 포탈되어 있어 행 삭제만으로는 함께 제거되지 않으므로 먼저 정리
            Renderer.detachTierAutocomplete(highTierInput);
            Renderer.detachTierAutocomplete(currTierInput);
            row.remove();
        });

        return row;
    };

    // 표를 초기 빈 행 상태로 되돌림 (모달 최초 진입 시 / 일괄 등록 성공 후 다음 사용을 위해)
    const resetPlayerRows = () => {
        // innerHTML 초기화만으로는 document.body로 포탈된 드롭다운이 정리되지 않으므로 먼저 각 행의 것을 해제
        addPlayerRowsContainer.querySelectorAll('.p-hightier-input, .p-currtier-input').forEach((input) => {
            Renderer.detachTierAutocomplete(input as HTMLInputElement);
        });
        addPlayerRowsContainer.innerHTML = '';
        for (let i = 0; i < INITIAL_PLAYER_ROWS; i++) {
            addPlayerRowsContainer.appendChild(createPlayerRow());
        }
    };
    resetPlayerRows();

    document.getElementById('btn-add-player-row')?.addEventListener('click', () => {
        addPlayerRowsContainer.appendChild(createPlayerRow());
    });

    document.getElementById('btn-open-add-player')?.addEventListener('click', () => {
        if (addPlayerModal) addPlayerModal.style.display = 'flex';
    });

    document.getElementById('btn-close-add-player')?.addEventListener('click', () => {
        if (addPlayerModal) addPlayerModal.style.display = 'none';
    });

    document.getElementById('btn-submit-add-player')?.addEventListener('click', async () => {
        if (!latestData || !currentRoomId) return;

        // DOM에서 각 행의 원시 입력값만 읽어오고, 검증/변환은 순수 함수(buildPlayersFromRows)에 위임
        const rowInputs: PlayerRowInput[] = Array.from(addPlayerRowsContainer.querySelectorAll('.player-row')).map((row) => ({
            name: (row.querySelector('.p-name-input') as HTMLInputElement).value.trim(),
            nickname: (row.querySelector('.p-nick-input') as HTMLInputElement).value.trim(),
            highTier: (row.querySelector('.p-hightier-input') as HTMLInputElement).value.trim(),
            currentTier: (row.querySelector('.p-currtier-input') as HTMLInputElement).value.trim(),
            mainPos: (row.querySelector('.p-mainpos-select') as HTMLSelectElement).value.trim(),
            subPos: (row.querySelector('.p-subpos-select') as HTMLSelectElement).value.trim(),
            mostStr: (row.querySelector('.p-most-input') as HTMLInputElement).value.trim(),
        }));

        const { players: newPlayers, errors } = buildPlayersFromRows(rowInputs, Date.now());

        if (errors.length > 0) {
            return alert(errors.join('\n'));
        }
        if (Object.keys(newPlayers).length === 0) {
            return alert('등록할 참가자 정보를 입력해주세요.');
        }

        try {
            // 기존 선수 목록 + 새로 등록할 선수들을 한 번에 반영
            const currentPlayers = { ...(latestData.players || {}), ...newPlayers };
            await RoomService.registerPlayers(currentRoomId, currentPlayers);

            // 모달 닫기 및 표 초기화
            if (addPlayerModal) addPlayerModal.style.display = 'none';
            resetPlayerRows();
            alert(`참가자 ${Object.keys(newPlayers).length}명이 추가되었습니다.`);
        } catch (error) {
            console.error(error);
            alert('참가자 추가에 실패했습니다.');
        }
    });

    // --- [참가자 삭제 위임] ---
    // Renderer에서 렌더링 시 삭제 버튼을 추가하고 여기서 처리합니다.
    document.getElementById('player-list')?.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;

        // 삭제 버튼 클릭 시
        if (target.classList.contains('btn-delete-player')) {
            e.stopPropagation(); // 모달 뜨는 것 방지

            if (userRole !== 'team_1' || latestData?.live?.status !== 'idle') {
                return alert("경매 대기 중에만 방장이 삭제할 수 있습니다.");
            }

            const playerId = target.getAttribute('data-id');
            if (!playerId || !currentRoomId || !latestData) return;

            if (confirm("정말 이 참가자를 삭제하시겠습니까?")) {
                try {
                    // Firebase에서 특정 필드 삭제는 null을 업데이트하거나 remove 함수 사용
                    // 여기서는 update를 사용하여 여러 경로 동시 처리
                    const updates: any = {};
                    updates[`rooms/${currentRoomId}/players/${playerId}`] = null;

                    // playerOrder에서도 제거해야 함 (대기 상태이므로 Order가 비어있을 수도 있지만 안전을 위해)
                    const currentOrder = latestData.live.playerOrder || [];
                    const newOrder = currentOrder.filter((id: string) => id !== playerId);
                    updates[`rooms/${currentRoomId}/live/playerOrder`] = newOrder;

                    await update(ref(db), updates);
                } catch (error) {
                    console.error("Delete player error:", error);
                    alert("삭제 실패");
                }
            }
            return; // 삭제 로직 탔으면 종료
        }

        // --- 기존 호버 툴팁 / 클릭 모달 로직 ---
        const card = target.closest('.player-card');
        if (!card || !latestData) return;
        const playerId = card.getAttribute('data-id');
        if (!playerId) return;

        const p = latestData.players[playerId];
        // idle = 경매 시작 전(방금 생성) 또는 모든 팀 정원이 차서 완전히 종료된 이후 두 경우 모두 해당.
        // "참가자 수동 등록" 버튼(admin-add-player-zone)이 노출 여부를 판단할 때 쓰는 것과 동일한 기준을 재사용.
        const isStarted = latestData.live.status !== 'idle';

        const modal = document.getElementById('player-info-modal');
        const name = document.getElementById('player-modal-name');
        const detail = document.getElementById('player-modal-detail');
        const adminZone = document.getElementById('player-modal-admin-zone');
        const adminNotice = document.getElementById('player-modal-admin-notice');
        const editBtn = document.getElementById('btn-open-edit-player') as HTMLButtonElement | null;

        if (modal && name && detail) {
            currentInfoPlayerId = playerId;
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
                statusText = `낙찰됨 - ${escapeHtml(soldTeamName)} 팀`;
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

            // 역할/경매 진행 상태와 무관하게 모든 필드를 항상 동일하게 표시 (정보를 가리는 처리 없음)
            const highTierColor = Renderer.getTierColor(p.highTier);
            const currentTierColor = Renderer.getTierColor(p.currentTier);
            const infoHtml = `
                <div style="margin-bottom:15px; text-align:center; font-size:16px; font-weight:bold; color:${statusColor}; border:1px solid ${statusColor}; padding:8px; border-radius:4px;">
                    ${statusText}
                </div>
                <div style="margin-bottom:10px;"><strong>최고 티어:</strong> <span style="color:${highTierColor};">${escapeHtml(p.highTier)}</span></div>
                <div style="margin-bottom:10px;"><strong>현재 티어:</strong> <span style="color:${currentTierColor};">${escapeHtml(p.currentTier)}</span></div>
                <div style="margin-bottom:10px;"><strong>주 포지션:</strong> ${escapeHtml(p.mainPos)}</div>
                <div style="margin-bottom:10px;"><strong>부 포지션:</strong> ${escapeHtml(p.subPos)}</div>
                <div><strong>Most:</strong> ${p.most && p.most.length > 0 ? p.most.map(escapeHtml).join(', ') : '-'}</div>
            `;
            detail.innerHTML = infoHtml;

            // 방장 전용 정보 수정 영역: 경매 시작 전에만 버튼 노출, 시작 후에는 잠금 안내로 전환
            if (adminZone && adminNotice && editBtn) {
                if (userRole === 'team_1') {
                    adminZone.style.display = 'block';
                    if (!isStarted) {
                        adminNotice.textContent = '경매 시작 전에는 정보를 수정할 수 있습니다.';
                        editBtn.style.display = 'inline-block';
                    } else {
                        adminNotice.textContent = '🔒 경매가 시작되면 정보를 수정할 수 없습니다.';
                        editBtn.style.display = 'none';
                    }
                } else {
                    adminZone.style.display = 'none';
                }
            }

            modal.style.display = 'flex';
        }
    });

    // --- [모달 이벤트 핸들러] ---
    document.getElementById('btn-close-team-modal')?.addEventListener('click', () => {
        document.getElementById('team-detail-modal')!.style.display = 'none';
    });
    document.getElementById('btn-close-player-modal')?.addEventListener('click', () => {
        document.getElementById('player-info-modal')!.style.display = 'none';
    });

    // --- [참가자 정보 수정 모달] ---
    // 필드 구성/검증은 참가자 등록(단건·일괄)과 동일한 buildPlayersFromRows를 재사용한다.
    const editPlayerModal = document.getElementById('edit-player-modal');
    const editNameInput = document.getElementById('edit-p-name') as HTMLInputElement;
    const editNickInput = document.getElementById('edit-p-nick') as HTMLInputElement;
    const editHighTierInput = document.getElementById('edit-p-high-tier') as HTMLInputElement;
    const editCurrTierInput = document.getElementById('edit-p-curr-tier') as HTMLInputElement;
    const editMainPosSelect = document.getElementById('edit-p-main-pos') as HTMLSelectElement;
    const editSubPosSelect = document.getElementById('edit-p-sub-pos') as HTMLSelectElement;
    const editMostInput = document.getElementById('edit-p-most') as HTMLInputElement;

    // 이 모달의 티어 입력/포지션 select는 정적 요소이므로(행이 동적으로 생기지 않음) 최초 한 번만 연결
    Renderer.attachTierAutocomplete(editHighTierInput);
    Renderer.attachTierAutocomplete(editCurrTierInput);
    Renderer.populatePositionOptions(editMainPosSelect);
    Renderer.populatePositionOptions(editSubPosSelect);

    document.getElementById('btn-open-edit-player')?.addEventListener('click', () => {
        if (!currentInfoPlayerId || !latestData) return;
        const p = latestData.players[currentInfoPlayerId];
        if (!p) return;

        editNameInput.value = p.name || '';
        editNickInput.value = p.nickname || '';
        editHighTierInput.value = p.highTier || '';
        editCurrTierInput.value = p.currentTier || '';
        editMainPosSelect.value = p.mainPos || '';
        editSubPosSelect.value = p.subPos || '';
        editMostInput.value = (p.most || []).join(', ');

        document.getElementById('player-info-modal')!.style.display = 'none';
        if (editPlayerModal) editPlayerModal.style.display = 'flex';
    });

    document.getElementById('btn-close-edit-player')?.addEventListener('click', () => {
        if (editPlayerModal) editPlayerModal.style.display = 'none';
    });

    document.getElementById('btn-submit-edit-player')?.addEventListener('click', async () => {
        if (!currentRoomId || !currentInfoPlayerId) return;

        const rowInput: PlayerRowInput = {
            name: editNameInput.value.trim(),
            nickname: editNickInput.value.trim(),
            highTier: editHighTierInput.value.trim(),
            currentTier: editCurrTierInput.value.trim(),
            mainPos: editMainPosSelect.value.trim(),
            subPos: editSubPosSelect.value.trim(),
            mostStr: editMostInput.value.trim(),
        };

        const { players: built, errors } = buildPlayersFromRows([rowInput], Date.now());

        if (errors.length > 0) {
            // buildPlayersFromRows의 에러 메시지는 "N번째 행: ..." 형식이라 수정 폼(단일 항목)에는 행 번호가 불필요
            return alert(errors[0].replace(/^\d+번째 행: /, ''));
        }
        if (Object.keys(built).length === 0) {
            return alert('필수 항목(*표시)을 입력해주세요.');
        }

        const updatedFields = Object.values(built)[0];

        try {
            // status 등 다른 필드는 건드리지 않고 수정한 필드만 targeted update
            await RoomService.updatePlayer(currentRoomId, currentInfoPlayerId, {
                name: updatedFields.name,
                nickname: updatedFields.nickname,
                highTier: updatedFields.highTier,
                currentTier: updatedFields.currentTier,
                mainPos: updatedFields.mainPos,
                subPos: updatedFields.subPos,
                most: updatedFields.most,
            });

            if (editPlayerModal) editPlayerModal.style.display = 'none';
            alert('참가자 정보가 수정되었습니다.');
        } catch (error) {
            console.error(error);
            alert('참가자 정보 수정에 실패했습니다.');
        }
    });

    // 약관 모달
    const termsModal = document.getElementById('terms-modal');
    const termsTitle = document.getElementById('terms-title');
    const termsContent = document.getElementById('terms-content');

    document.getElementById('link-privacy')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (termsModal && termsTitle && termsContent) {
            termsTitle.innerText = "개인정보처리방침";
            termsContent.innerText = PRIVACY_POLICY;
            termsModal.style.display = 'flex';
        }
    });

    document.getElementById('link-terms')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (termsModal && termsTitle && termsContent) {
            termsTitle.innerText = "이용약관";
            termsContent.innerText = TERMS_OF_SERVICE;
            termsModal.style.display = 'flex';
        }
    });

    document.getElementById('btn-close-terms')?.addEventListener('click', () => {
        if (termsModal) termsModal.style.display = 'none';
    });

    // 팀 리스트 클릭 위임
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
                            <strong>${escapeHtml(p.name)}</strong>
                            <small style="background:#333; padding:2px 6px; border-radius:4px;">${escapeHtml(p.currentTier)}</small>
                        </div>
                        <div style="font-size:12px; color:#aaa; margin-top:6px; line-height:1.4;">
                            <div>포지션: ${escapeHtml(p.mainPos)} ${p.subPos ? `/ ${escapeHtml(p.subPos)}` : ''}</div>
                            <div>Most: ${p.most ? p.most.map(escapeHtml).join(', ') : '-'}</div>
                        </div>
                    </div>`;
                }).join('')
                : '<p style="text-align:center; color:#888;">아직 낙찰된 선수가 없습니다.</p>';
            
            modal.style.display = 'flex';
        }
    });

    // 선수 리스트 호버 툴팁 위임
    const hoverTooltip = document.getElementById('player-hover-tooltip');

    const showTooltip = (target: HTMLElement, e: MouseEvent) => {
        // 삭제 버튼 위에 있을 때는 툴팁 안 띄움
        if (target.classList.contains('btn-delete-player')) return;

        const card = target.closest('.player-card');
        if (!card || !latestData || !hoverTooltip) return;
        const playerId = card.getAttribute('data-id');
        if (!playerId) return;

        const p = latestData.players[playerId];
        hoverTooltip.innerHTML = Renderer.getTooltipHtml(p);
        
        const tooltipWidth = 250;
        const tooltipHeight = hoverTooltip.offsetHeight || 150;
        
        let left = e.clientX + 15;
        let top = e.clientY + 15;

        if (left + tooltipWidth > window.innerWidth) {
            left = e.clientX - tooltipWidth - 15;
        }
        if (top + tooltipHeight > window.innerHeight) {
            top = e.clientY - tooltipHeight - 15;
        }

        hoverTooltip.style.left = `${left}px`;
        hoverTooltip.style.top = `${top}px`;
        hoverTooltip.style.display = 'block';
    };

    const hideTooltip = () => {
        if (hoverTooltip) hoverTooltip.style.display = 'none';
    };

    const playerListEl = document.getElementById('player-list');
    playerListEl?.addEventListener('mouseover', (e) => {
        showTooltip(e.target as HTMLElement, e);
    });

    playerListEl?.addEventListener('mousemove', (e) => {
        if (hoverTooltip && hoverTooltip.style.display === 'block') {
            showTooltip(e.target as HTMLElement, e); // 위치 업데이트용 호출 재활용 가능
        }
    });

    playerListEl?.addEventListener('mouseout', () => {
        hideTooltip();
    });
});