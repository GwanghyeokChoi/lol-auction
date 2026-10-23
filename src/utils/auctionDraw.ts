import type { Player } from "../types";

/*
 * 경매 다음 경매자 추첨 순수 로직.
 * Firebase를 전혀 참조하지 않는다 — auctionService.ts가 DB 읽기 결과를 그대로 넘겨 호출하고,
 * 단위 테스트에서도 이 모듈만 import해서 실제 추첨 로직을 그대로 검증할 수 있다.
 */

// crypto.getRandomValues 기반 모듈로 편향 없는 균등 정수 추첨 [0, maxExclusive).
// Math.random() 대신 reject-sampling으로 2^32 구간을 maxExclusive로 나눈 나머지 구간을 버린다.
export function secureRandomInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error("maxExclusive는 1 이상의 정수여야 합니다.");
    }

    const cryptoObj = globalThis.crypto;
    const UINT32_RANGE = 0x100000000; // 2^32
    const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;

    const buf = new Uint32Array(1);
    let x: number;
    do {
        cryptoObj.getRandomValues(buf);
        x = buf[0];
    } while (x >= limit); // 편향 구간 재추첨

    return x % maxExclusive;
}

export function pickUniformRandom<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("빈 배열에서는 뽑을 수 없습니다.");
    return arr[secureRandomInt(arr.length)];
}

// 한 번도 경매에 나오지 않은(= playerOrder 이력에 없는) 대기 중인 인원 풀.
export function getFreshWaitingPool(
    players: Record<string, Player>,
    playerOrder: readonly string[],
    excludeId: string | null
): string[] {
    const orderSet = new Set(playerOrder);
    return Object.keys(players).filter(id =>
        id !== excludeId && players[id]?.status === 'waiting' && !orderSet.has(id)
    );
}

/*
 * 유찰자 재경매: excludeId(현재/방금 끝난 사람) 바로 다음 순번을, playerOrder 이력 인덱스를
 * 커서 삼아 찾는다. 한 바퀴를 다 돌면(=excludeId 이후로 더 이상 passed가 없으면) 맨 앞 유찰자로
 * wrap한다. 새 DB 필드 없이 playerOrder 안에서의 위치만으로 계산한다.
 *
 * 유찰자가 "자기 자신 1명"뿐인 경우는 두 갈래로 나뉜다.
 * - excludeId가 null이거나 자기 자신이 아니면: 그 사람을 그대로 반환(= 지금 당장 활성화할 대상
 *   결정 등, 이미 확정된 상태 기준이라 안전).
 * - excludeId가 바로 그 유일한 유찰자 자신이면: "이번 경매가 끝나면 또 유찰될지, 이번엔 낙찰될지"는
 *   아직 모르는 상태이므로 여기서 미리 단정하지 않고 null을 반환한다. 이 null은 nextPlayer()가
 *   다음 번 호출 시 live.nextPlayerId 폴백(즉석 재결정)으로 처리하므로, 실제 결과가 반영된 뒤에야
 *   "또 유찰됐으니 반복" 또는 "낙찰됐으니 종료"가 정확히 결정된다. 미리 자기 자신으로 단정해버리면
 *   이번 판에 낙찰되는 경우 중앙 "다음" 표시가 이미 팔린 사람을 가리키는 오류가 생긴다.
 */
export function getNextPassedInOrder(
    players: Record<string, Player>,
    playerOrder: readonly string[],
    excludeId: string | null
): string | null {
    const n = playerOrder.length;
    if (n === 0) return null;

    // 자기 자신(excludeId) 포함, 현재 passed 상태인 전원 (이력 순서 그대로)
    const allPassed = playerOrder.filter(id => players[id]?.status === 'passed');
    if (allPassed.length === 0) return null;

    if (allPassed.length === 1) {
        return allPassed[0] !== excludeId ? allPassed[0] : null;
    }

    // 2명 이상이면 자기 자신은 후보에서 빼고, 이력 인덱스 기준으로 바로 다음 사람을 찾는다(wrap)
    const passedSet = new Set(allPassed.filter(id => id !== excludeId));
    const startIndex = excludeId !== null ? playerOrder.indexOf(excludeId) : -1;

    for (let offset = 1; offset <= n; offset++) {
        const candidate = playerOrder[(startIndex + offset + n) % n];
        if (passedSet.has(candidate)) return candidate;
    }
    return null; // 이론상 도달하지 않음 (allPassed가 비어있지 않다면 반드시 찾는다)
}

// 재경매 "한 바퀴"의 시작 지점인지 판별 (로그를 바퀴마다 남기기 위한 용도).
// candidateId의 이력 인덱스가 excludeId의 이력 인덱스보다 뒤가 아니라면(wrap 포함, 자기 자신
// 반복 포함) 새 바퀴가 시작된 것으로 본다. getNextPassedInOrder가 실제로 고른 결과에 대해서만
// 호출해야 의미가 있다(freshPool에서 뽑힌 경우에는 적용하지 않는다).
export function isReauctionLapStart(
    playerOrder: readonly string[],
    excludeId: string | null,
    candidateId: string
): boolean {
    const startIndex = excludeId !== null ? playerOrder.indexOf(excludeId) : -1;
    const candidateIndex = playerOrder.indexOf(candidateId);
    return candidateIndex <= startIndex;
}

// 다음 경매자 후보 1명 결정.
// 1) 한 번도 안 나온 대기 인원이 있으면 그중 균등 랜덤 추첨.
// 2) 없으면 유찰자 재경매 큐에서 excludeId 바로 다음 순번(이력 인덱스 기준, wrap 포함)을 반환.
// 3) 둘 다 없으면 null (더 이상 경매할 인원 없음).
export function decideNextCandidate(
    players: Record<string, Player>,
    playerOrder: readonly string[],
    excludeId: string | null
): string | null {
    const freshPool = getFreshWaitingPool(players, playerOrder, excludeId);
    if (freshPool.length > 0) return pickUniformRandom(freshPool);

    return getNextPassedInOrder(players, playerOrder, excludeId);
}
