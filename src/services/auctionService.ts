import { ref, get, update, push } from "firebase/database";
import { db } from "../firebase";
import type { AuctionState } from "../types";

export const AuctionService = {
    async nextPlayer(roomId: string) {
        const snap = await get(ref(db, `rooms/${roomId}`));
        const data = snap.val();
        const live: AuctionState = data.live;

        // 대기 중인 다음 선수 찾기
        const nextId = live.playerOrder.find(id => data.players[id].status === 'waiting');
        if (!nextId) return alert("모든 경매가 종료되었습니다.");

        await update(ref(db, `rooms/${roomId}/live`), {
            status: 'bidding',
            activePlayerId: nextId,
            highestBid: 0,
            highestBidderId: null,
            endTime: Date.now() + 15000 // 기본 15초 제공
        });
        await update(ref(db, `rooms/${roomId}/players/${nextId}`), { status: 'bidding' });
    },

    // 실시간 경쟁 입찰 (증감액 기준)
    async placeBid(roomId: string, teamId: string, amount: number) {
        const snap = await get(ref(db, `rooms/${roomId}`));
        const data = snap.val();
        const live = data.live;

        if (live.status !== 'bidding') return; 
        
        const currentBid = live.highestBid || 0;
        const nextBid = currentBid + amount;

        await this._processBid(roomId, teamId, nextBid, data);
    },

    // 직접 입찰 (목표 금액 기준)
    async placeTargetBid(roomId: string, teamId: string, targetAmount: number) {
        const snap = await get(ref(db, `rooms/${roomId}`));
        const data = snap.val();
        const live = data.live;

        if (live.status !== 'bidding') return;

        await this._processBid(roomId, teamId, targetAmount, data);
    },

    // 내부 입찰 처리 로직
    async _processBid(roomId: string, teamId: string, nextBid: number, data: any) {
        const live = data.live;
        const currentBid = live.highestBid || 0;

        // 유효성 검사
        if (data.teams[teamId].members?.length >= 4) return alert("팀원이 가득 찼습니다 (최대 5인).");
        if (nextBid < 0) return alert("0 포인트 미만으로 입찰할 수 없습니다.");
        if (nextBid <= currentBid) return alert(`현재 최고가(${currentBid}P)보다 높게 입찰해야 합니다.`);
        if (data.teams[teamId].points < nextBid) return alert("포인트가 부족합니다.");

        // 입찰 반영 및 타이머 리셋 (10초)
        const updates: any = {};
        updates[`rooms/${roomId}/live/highestBid`] = nextBid;
        updates[`rooms/${roomId}/live/highestBidderId`] = teamId;
        updates[`rooms/${roomId}/live/endTime`] = Date.now() + 10000;

        // 로그 기록 (최종 금액 강조)
        const logKey = push(ref(db, `rooms/${roomId}/logs`)).key;
        updates[`rooms/${roomId}/logs/${logKey}`] = {
            msg: `<strong>${data.teams[teamId].leaderName}</strong>님이 <span class="amt" style="font-size:1.1em">${nextBid}P</span>에 입찰했습니다!`,
            timestamp: Date.now()
        };

        await update(ref(db), updates);
    },

    // 퍼즈 요청 (2분 제한)
    async pauseAuction(roomId: string, teamId: string) {
        const snap = await get(ref(db, `rooms/${roomId}`));
        const data = snap.val();
        const live = data.live;
        const team = data.teams[teamId];

        if (live.status !== 'bidding') return alert("경매 진행 중에만 퍼즈할 수 있습니다.");
        if (team.pauseCount <= 0) return alert("퍼즈 횟수를 모두 소진했습니다.");

        const remainingAuctionTime = live.endTime - Date.now();
        
        const updates: any = {};
        updates[`rooms/${roomId}/live/status`] = 'paused';
        updates[`rooms/${roomId}/live/remainingAuctionTime`] = remainingAuctionTime; // 경매 남은 시간 저장
        updates[`rooms/${roomId}/live/pauseLimitTime`] = Date.now() + 120000; // 퍼즈 종료 예정 시간 (2분 후)
        updates[`rooms/${roomId}/live/pausedBy`] = teamId; // 퍼즈 건 사람
        updates[`rooms/${roomId}/teams/${teamId}/pauseCount`] = team.pauseCount - 1;

        const logKey = push(ref(db, `rooms/${roomId}/logs`)).key;
        updates[`rooms/${roomId}/logs/${logKey}`] = {
            msg: `⏸ <strong>${team.leaderName}</strong>님이 퍼즈를 요청했습니다. (2분 제한)`,
            timestamp: Date.now()
        };

        await update(ref(db), updates);
    },

    // 경매 재개 (본인 또는 방장)
    async resumeAuction(roomId: string, requestorId?: string) {
        const snap = await get(ref(db, `rooms/${roomId}/live`));
        const live = snap.val();

        if (live.status !== 'paused') return;

        // 권한 체크 (방장 team_1은 무조건 가능, 그 외에는 본인이 건 퍼즈여야 함)
        if (requestorId && requestorId !== 'team_1' && live.pausedBy !== requestorId) {
            return alert("본인이 요청한 퍼즈만 해제할 수 있습니다.");
        }

        const updates: any = {};
        updates[`rooms/${roomId}/live/status`] = 'bidding';
        updates[`rooms/${roomId}/live/endTime`] = Date.now() + (live.remainingAuctionTime || 10000); // 저장된 시간만큼 연장
        updates[`rooms/${roomId}/live/pausedBy`] = null;
        updates[`rooms/${roomId}/live/pauseLimitTime`] = null;

        const logKey = push(ref(db, `rooms/${roomId}/logs`)).key;
        updates[`rooms/${roomId}/logs/${logKey}`] = {
            msg: `▶ 경매가 재개되었습니다.`,
            timestamp: Date.now()
        };

        await update(ref(db), updates);
    },

    // 낙찰 또는 유찰 처리
    async finalize(roomId: string) {
        const snap = await get(ref(db, `rooms/${roomId}`));
        const data = snap.val();
        const live = data.live;
        
        // 이미 처리되었거나 쿨타임이면 중복 실행 방지
        if (live.status === 'cooldown') return;

        const updates: any = {};
        let resultMsg = "";

        if (live.highestBidderId) {
            // 낙찰
            updates[`rooms/${roomId}/players/${live.activePlayerId}/status`] = 'sold';
            const winner = data.teams[live.highestBidderId];
            updates[`rooms/${roomId}/teams/${live.highestBidderId}/points`] = winner.points - live.highestBid;
            
            const currentMembers = winner.members || [];
            updates[`rooms/${roomId}/teams/${live.highestBidderId}/members`] = [...currentMembers, live.activePlayerId];
            
            resultMsg = `🎉 <strong>${winner.leaderName}</strong>팀 낙찰! (<span class="amt">${live.highestBid}P</span>)`;
        } else {
            // 유찰
            updates[`rooms/${roomId}/players/${live.activePlayerId}/status`] = 'passed';
            resultMsg = `❌ 유찰되었습니다.`;
        }

        // 결과 로그
        const logKey = push(ref(db, `rooms/${roomId}/logs`)).key;
        updates[`rooms/${roomId}/logs/${logKey}`] = {
            msg: resultMsg,
            timestamp: Date.now()
        };

        // 다음 단계 준비 (쿨타임)
        updates[`rooms/${roomId}/live/status`] = 'cooldown';
        updates[`rooms/${roomId}/live/nextAuctionTime`] = Date.now() + 5000; // 5초 대기
        await update(ref(db), updates);
    }
};