export interface Player {
    id: string;
    name: string;
    nickname: string;
    highTier: string;    // 최고 티어
    currentTier: string; // 현재 티어
    mainPos: string;
    subPos: string;
    most: string[];
    status: 'waiting' | 'bidding' | 'sold' | 'passed';
    soldPrice?: number;  // 낙찰가 (추가)
    // 좌측 PLAYERS 목록 정렬 전용 등록 순번. 경매 추첨 순서(live.playerOrder/nextPlayerId)와
    // 무관하게 항상 같은 행 위치를 보장하기 위한 값 (CSV는 행 순서, 수동 등록은 등록 시점 순서).
    // 구버전 방(필드 없음)은 렌더러에서 id 문자열 비교로 폴백한다.
    regOrder?: number;
}

export interface Team {
    id: string;
    leaderName: string;
    points: number;
    members: string[];
    pauseCount: number;
    online?: boolean;
}

export interface AuctionState {
    status: 'idle' | 'bidding' | 'paused' | 'cooldown' | 'resuming';
    activePlayerId: string | null;
    // 직전에 낙찰/유찰로 끝난 선수 id (중앙 스테이지 좌측 "직전 경매자" 카드 표시용).
    // finalize()에서 매번 activePlayerId를 그대로 복사해 저장하며, nextPlayer()가
    // activePlayerId를 다음 선수로 덮어써도 이 값은 별도로 유지된다.
    previousPlayerId?: string | null;
    // 다음에 경매에 나올 선수 id. 현재 선수가 활성화되는 바로 그 순간(nextPlayer())에
    // 이미 결정되어 저장되며, 현재 경매가 끝날 때까지 바뀌지 않는다.
    nextPlayerId?: string | null;
    highestBid: number;
    highestBidderId: string | null;
    currentTurnLeaderId: string | null;
    leaderOrder: string[];
    // 경매에 오른 순서의 append-only 이력. 아직 한 번도 나오지 않은 인원은 절대 포함되지 않는다.
    playerOrder: string[];
    endTime: number;
    pauseEndTime?: number;
    nextAuctionTime: number;
    initialPoints: number;
    remainingAuctionTime?: number;
    pauseLimitTime?: number;
    pausedBy?: string | null;
}