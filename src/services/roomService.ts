import { ref, set, update, get, onDisconnect, onValue } from "firebase/database";
import { db } from "../firebase";
import { TimerUtils } from "../utils/timer";
import type { Player } from "../types";

export const RoomService = {
    // 1. 메인 화면에서 '링크 생성' 클릭 시 호출
    async createRoom(roomId: string, teams: any, initialPoints: number) {
        await set(ref(db, `rooms/${roomId}`), {
            info: { createdAt: Date.now(), status: 'waiting' },
            teams,
            live: {
                status: 'idle',
                activePlayerId: null,
                highestBid: 0,
                highestBidderId: null,
                initialPoints,
                playerOrder: [],
                leaderOrder: Object.keys(teams) // 초기 순서
            },
            players: {}
        });
    },

    // 2. 선수 명단 등록 (CSV 업로드) - 기존 명단 덮어쓰기
    async registerPlayers(roomId: string, players: Record<string, Player>) {
        await set(ref(db, `rooms/${roomId}/players`), players);
    },

    // 3. 방장이 '경매 시작' 버튼 클릭 시 랜덤 순서 확정
    async startAuctionProcess(roomId: string) {
        const snap = await get(ref(db, `rooms/${roomId}`));
        const data = snap.val();

        const playerIds = Object.keys(data.players || {});
        const leaderIds = Object.keys(data.teams || {});

        if (playerIds.length === 0) return alert("선수 명단(CSV)을 먼저 등록해주세요.");

        // 최소 인원 체크 (팀당 4명 필요)
        const requiredPlayers = leaderIds.length * 4;
        if (playerIds.length < requiredPlayers) {
            return alert(`선수가 부족합니다. 최소 ${requiredPlayers}명이 필요합니다. (현재 ${playerIds.length}명)`);
        }

        await update(ref(db, `rooms/${roomId}/live`), {
            playerOrder: TimerUtils.shuffle(playerIds), // 선수 랜덤 순서
            leaderOrder: TimerUtils.shuffle(leaderIds), // 팀장 입찰 순서
            status: 'idle'
        });

        // 첫 번째 선수 호출 준비
        this.triggerNextAuction(roomId);
    },

    async triggerNextAuction(roomId: string) {
        await update(ref(db, `rooms/${roomId}/live`), {
            status: 'cooldown',
            nextAuctionTime: Date.now() + 3000 // 최초 시작은 3초 대기
        });
    },

    // 4. 방 접속 상태 관리
    connectToRoom(roomId: string, teamId: string) {
        // viewer는 상태 관리 안 함 (필요하면 추가 가능)
        if (teamId === 'viewer') return;

        const connectedRef = ref(db, ".info/connected");
        const myStatusRef = ref(db, `rooms/${roomId}/teams/${teamId}/online`);

        onValue(connectedRef, (snap) => {
            if (snap.val() === true) {
                // 연결되면 online: true로 설정
                set(myStatusRef, true);
                // 연결 끊기면 online: false로 자동 변경 예약
                onDisconnect(myStatusRef).set(false);
            }
        });
    }
};