export interface Player {
    id: string;
    name: string;
    nickname: string;
    tier: string;
    mainPos: string;
    subPos: string;
    most: string[];
    status: 'waiting' | 'bidding' | 'sold' | 'passed';
}

export interface Team {
    id: string;
    leaderName: string;
    points: number;
    members: string[];
    pauseCount: number;
    online?: boolean; // 접속 상태 추가
}

export interface AuctionState {
    status: 'idle' | 'bidding' | 'paused' | 'cooldown';
    activePlayerId: string | null;
    highestBid: number;
    highestBidderId: string | null;
    currentTurnLeaderId: string | null;
    leaderOrder: string[];
    playerOrder: string[];
    endTime: number;
    pauseEndTime?: number;
    nextAuctionTime: number;
    initialPoints: number;
    remainingAuctionTime?: number;
    pauseLimitTime?: number;
    pausedBy?: string | null;
}