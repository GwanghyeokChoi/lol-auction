import { ref, get, update, push, runTransaction } from "firebase/database";
import { db } from "../firebase";
import { TimerUtils } from "../utils/timer";
import { escapeHtml } from "../utils/sanitize";
import { decideNextCandidate, isReauctionLapStart } from "../utils/auctionDraw";
import type { AuctionState } from "../types";

export const AuctionService = {
    // 쿨타임 종료 -> 다음 선수 호출. 방장(team_1) 클라이언트가 1초 폴링으로 호출하지만,
    // 팀장 역할로 같은 방을 여러 탭에서 열면 두 탭 모두 team_1일 수 있어 동시에 호출될 수 있다.
    // live 노드에 한해 runTransaction으로 묶어 "상태 전이 + 다음 경매자 추첨"이 정확히 한 번만
    // 커밋되도록 보장한다 (status가 이미 'cooldown'이 아니게 되면 다른 호출이 먼저 처리한 것이므로 중단).
    async nextPlayer(roomId: string) {
        const snap = await get(ref(db, `rooms/${roomId}`));
        const data = snap.val();
        const teams = data.teams;
        const players = data.players;
        const originalPlayerOrder: string[] = data.live.playerOrder || [];

        // 1. 모든 팀이 꽉 찼는지 확인 (팀당 4명)
        const allTeamsFull = Object.values(teams).every((t: any) => (t.members?.length || 0) >= 4);
        if (allTeamsFull) {
            const result = await runTransaction(ref(db, `rooms/${roomId}/live`), (live) => {
                if (!live || live.status === 'idle') return; // 이미 다른 호출이 종료 처리함 -> 중단
                live.status = 'idle';
                return live;
            });

            if (result.committed) {
                const logKey = push(ref(db, `rooms/${roomId}/logs`)).key;
                await update(ref(db, `rooms/${roomId}/logs/${logKey}`), {
                    msg: `🎉 <strong>모든 팀 구성이 완료되었습니다! 경매를 종료합니다.</strong>`,
                    timestamp: TimerUtils.getServerTime()
                });
                alert("모든 팀 구성이 완료되어 경매가 종료되었습니다!");
            }
            return;
        }

        // 2. 상태 전이(cooldown -> bidding/idle) + 다음 경매자 추첨을 하나의 트랜잭션으로 처리.
        // previousActivePlayerId/isReauctionPick은 트랜잭션 콜백이 재시도될 때마다 다시 대입되므로,
        // 최종적으로 커밋에 성공한 시도의 값만 아래에서 유효하게 쓰인다.
        let previousActivePlayerId: string | null = null;
        let isReauctionPick = false;

        const result = await runTransaction(ref(db, `rooms/${roomId}/live`), (live: AuctionState | null) => {
            if (!live || live.status !== 'cooldown') return; // 다른 호출이 이미 처리함 -> 중단

            previousActivePlayerId = live.activePlayerId ?? null;

            // live.nextPlayerId가 이미 예약되어 있으면 그대로 쓰고, 없으면(최초 호출/구버전 방 폴백) 즉석 추첨
            const currentId = live.nextPlayerId || decideNextCandidate(players, originalPlayerOrder, null);

            if (!currentId) {
                live.status = 'idle';
                live.nextPlayerId = null;
                return live;
            }

            // 이미 playerOrder 이력에 있던 사람을 다시 꺼내는 것 = 재경매 픽
            // ("한 번도 안 나온 대기 인원" 풀이 소진되어 유찰자 재경매로 넘어간 상태)
            isReauctionPick = originalPlayerOrder.includes(currentId);
            const playerOrder = isReauctionPick ? originalPlayerOrder : [...originalPlayerOrder, currentId];
            const newNextId = decideNextCandidate(players, playerOrder, currentId);

            live.status = 'bidding';
            live.activePlayerId = currentId;
            live.nextPlayerId = newNextId;
            live.playerOrder = playerOrder;
            live.highestBid = 0;
            live.highestBidderId = null;
            live.endTime = TimerUtils.getServerTime() + 15000; // 기본 15초 제공

            return live;
        });

        if (!result.committed || !result.snapshot.exists()) return; // 다른 호출이 선점 -> 조용히 종료

        const committedLive: AuctionState = result.snapshot.val();

        if (committedLive.status === 'idle') {
            return alert("더 이상 경매할 선수가 없습니다. (팀 미완성)");
        }

        const decidedCurrentId = committedLive.activePlayerId!;
        await update(ref(db, `rooms/${roomId}/players/${decidedCurrentId}`), { status: 'bidding' });

        // 재경매 픽이면서 그중에서도 "한 바퀴가 새로 시작되는 지점"일 때만 안내 로그를 남긴다.
        // (재구조화 이전 코드와 동일하게 바퀴마다 1회 — 유찰자가 1명뿐이면 매번 로그가 찍히는 것도 동일)
        if (isReauctionPick && isReauctionLapStart(committedLive.playerOrder, previousActivePlayerId, decidedCurrentId)) {
            const logKey = push(ref(db, `rooms/${roomId}/logs`)).key;
            await update(ref(db, `rooms/${roomId}/logs/${logKey}`), {
                msg: `🔄 <strong>대기 선수가 없어 유찰된 선수들의 경매를 다시 시작합니다.</strong>`,
                timestamp: TimerUtils.getServerTime()
            });
        }
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
        const activePlayer = data.players[live.activePlayerId!];
        const team = data.teams[teamId];
        const teamPoints = team.points;
        const currentMembersCount = team.members?.length || 0;

        // 중복 입찰 방지
        if (live.highestBidderId === teamId && nextBid >= currentBid) {
            return alert("이미 최고 입찰자입니다. 연속으로 입찰할 수 없습니다.");
        }

        // 유효성 검사
        if (currentMembersCount >= 4) return alert("팀원이 가득 찼습니다 (최대 5인).");
        if (nextBid < 0) return alert("0 포인트 미만으로 입찰할 수 없습니다.");
        
        if (nextBid < currentBid) {
            if (live.highestBidderId !== teamId) {
                return alert(`현재 최고가(${currentBid}P)보다 높게 입찰해야 합니다.`);
            }
        } else if (nextBid <= currentBid && live.highestBidderId !== teamId) {
             return alert(`현재 최고가(${currentBid}P)보다 높게 입찰해야 합니다.`);
        }

        // 포인트 체크 (남은 팀원 수 고려)
        const remainingSlotsAfterBid = 4 - currentMembersCount - 1; 
        const remainingPoints = teamPoints - nextBid;

        if (remainingPoints < remainingSlotsAfterBid) {
             return alert(`남은 팀원 수(${remainingSlotsAfterBid}명)만큼의 최소 포인트(${remainingSlotsAfterBid}P)를 남겨야 합니다.\n(현재 보유: ${teamPoints}P, 입찰 시 잔액: ${remainingPoints}P)`);
        }

        // 입찰 반영 및 타이머 리셋 (15초로 변경)
        const updates: any = {};
        updates[`rooms/${roomId}/live/highestBid`] = nextBid;
        updates[`rooms/${roomId}/live/highestBidderId`] = teamId;
        updates[`rooms/${roomId}/live/endTime`] = TimerUtils.getServerTime() + 15000;

        // 로그 기록
        const logKey = push(ref(db, `rooms/${roomId}/logs`)).key;
        const actionText = nextBid < currentBid ? "정정" : "입찰";
        updates[`rooms/${roomId}/logs/${logKey}`] = {
            msg: `<strong>${escapeHtml(data.teams[teamId].leaderName)}</strong>님이 <strong>${escapeHtml(activePlayer.name)}</strong>에게 <span class="amt" style="font-size:1.1em">${nextBid}P</span> ${actionText}!`,
            timestamp: TimerUtils.getServerTime()
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

        const remainingAuctionTime = live.endTime - TimerUtils.getServerTime();
        
        const updates: any = {};
        updates[`rooms/${roomId}/live/status`] = 'paused';
        updates[`rooms/${roomId}/live/remainingAuctionTime`] = remainingAuctionTime; 
        updates[`rooms/${roomId}/live/pauseLimitTime`] = TimerUtils.getServerTime() + 120000; 
        updates[`rooms/${roomId}/live/pausedBy`] = teamId; 
        updates[`rooms/${roomId}/teams/${teamId}/pauseCount`] = team.pauseCount - 1;

        const logKey = push(ref(db, `rooms/${roomId}/logs`)).key;
        updates[`rooms/${roomId}/logs/${logKey}`] = {
            msg: `⏸ <strong>${escapeHtml(team.leaderName)}</strong>님이 퍼즈를 요청했습니다. (2분 제한)`,
            timestamp: TimerUtils.getServerTime()
        };

        await update(ref(db), updates);
    },

    // 경매 재개 (5초 대기 후 시작)
    async resumeAuction(roomId: string, requestorId?: string) {
        const snap = await get(ref(db, `rooms/${roomId}/live`));
        const live = snap.val();

        if (live.status !== 'paused') return;

        if (requestorId && requestorId !== 'team_1' && live.pausedBy !== requestorId) {
            return alert("본인이 요청한 퍼즈만 해제할 수 있습니다.");
        }

        const updates: any = {};
        updates[`rooms/${roomId}/live/status`] = 'resuming'; // 재개 대기 상태
        updates[`rooms/${roomId}/live/nextAuctionTime`] = TimerUtils.getServerTime() + 5000; // 5초 후 재개
        updates[`rooms/${roomId}/live/pausedBy`] = null;
        updates[`rooms/${roomId}/live/pauseLimitTime`] = null;

        const logKey = push(ref(db, `rooms/${roomId}/logs`)).key;
        updates[`rooms/${roomId}/logs/${logKey}`] = {
            msg: `▶ 퍼즈가 해제되었습니다. 5초 후 경매가 재개됩니다.`,
            timestamp: TimerUtils.getServerTime()
        };

        await update(ref(db), updates);
    },

    // 재개 대기 후 실제 경매 시작 (15초 부여)
    async startBidding(roomId: string) {
        await update(ref(db, `rooms/${roomId}/live`), {
            status: 'bidding',
            endTime: TimerUtils.getServerTime() + 15000 // 15초 리셋
        });
    },

    // 낙찰 또는 유찰 처리
    async finalize(roomId: string) {
        const snap = await get(ref(db, `rooms/${roomId}`));
        const data = snap.val();
        const live = data.live;
        const activePlayer = data.players[live.activePlayerId!];
        
        if (live.status === 'cooldown') return;

        const updates: any = {};
        let resultMsg = "";

        if (live.highestBidderId) {
            updates[`rooms/${roomId}/players/${live.activePlayerId}/status`] = 'sold';
            // 낙찰가 저장
            updates[`rooms/${roomId}/players/${live.activePlayerId}/soldPrice`] = live.highestBid;

            const winner = data.teams[live.highestBidderId];
            updates[`rooms/${roomId}/teams/${live.highestBidderId}/points`] = winner.points - live.highestBid;
            
            const currentMembers = winner.members || [];
            updates[`rooms/${roomId}/teams/${live.highestBidderId}/members`] = [...currentMembers, live.activePlayerId];
            
            resultMsg = `🎉 <strong>${escapeHtml(activePlayer.name)}</strong> -> <strong>${escapeHtml(winner.leaderName)}</strong>팀 낙찰! (<span class="amt">${live.highestBid}P</span>)`;
        } else {
            updates[`rooms/${roomId}/players/${live.activePlayerId}/status`] = 'passed';
            resultMsg = `❌ <strong>${escapeHtml(activePlayer.name)}</strong> 유찰되었습니다.`;
        }

        const logKey = push(ref(db, `rooms/${roomId}/logs`)).key;
        updates[`rooms/${roomId}/logs/${logKey}`] = {
            msg: resultMsg,
            timestamp: TimerUtils.getServerTime()
        };

        updates[`rooms/${roomId}/live/status`] = 'cooldown';
        updates[`rooms/${roomId}/live/nextAuctionTime`] = TimerUtils.getServerTime() + 5000;
        // 중앙 스테이지 좌측 "직전 경매자" 카드가 nextPlayer()로 activePlayerId가 덮어써진 뒤에도
        // 이번 결과를 계속 보여줄 수 있도록 별도 필드에 고정 저장
        updates[`rooms/${roomId}/live/previousPlayerId`] = live.activePlayerId;
        await update(ref(db), updates);
    }
};