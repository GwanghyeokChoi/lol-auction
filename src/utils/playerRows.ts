import type { Player } from '../types';

// 참가자 수동 등록 표의 한 행에서 읽어온 원시 입력값 (DOM에 의존하지 않는 순수 데이터)
export interface PlayerRowInput {
    name: string;
    nickname: string;
    highTier: string;
    currentTier: string;
    mainPos: string;
    subPos: string;
    mostStr: string;
}

export interface BuildPlayersResult {
    players: Record<string, Player>;
    errors: string[];
}

const isRowEmpty = (row: PlayerRowInput): boolean =>
    !row.name && !row.nickname && !row.highTier && !row.currentTier && !row.mainPos && !row.subPos && !row.mostStr;

/*
 * 참가자 일괄 등록 표의 각 행을 검증하고 Player 객체로 변환한다.
 * - 완전히 빈 행: 조용히 무시 (에러 없음, 결과에도 포함 안 됨)
 * - 일부만 채운 행: 필수값(이름/닉네임/최고티어/현재티어/주포지션 - 기존 단일 등록 폼과 동일한 필수 기준) 누락 시 에러 메시지 생성
 * - 전부 채운 행: Player 객체로 변환
 *
 * idPrefix로 호출 시점(Date.now())을 주입받아, 같은 밀리초 내 여러 행이 처리돼도
 * 행 인덱스가 섞여 id가 충돌하지 않게 한다.
 *
 * regOrderStart: 좌측 PLAYERS 목록 정렬용 regOrder의 시작값. 실제로 Player 객체가 만들어지는
 * 행에만 순서대로 부여한다(빈 행/에러 행은 건너뛰어도 번호를 소비하지 않음). 기존 참가자와
 * 겹치지 않도록 호출자가 "현재 최대 regOrder + 1"을 넘겨준다(단건 수정처럼 번호가 안 쓰이는
 * 호출은 기본값 0을 그대로 둬도 무방).
 */
export function buildPlayersFromRows(rows: PlayerRowInput[], idPrefix: number, regOrderStart = 0): BuildPlayersResult {
    const players: Record<string, Player> = {};
    const errors: string[] = [];
    let regOrder = regOrderStart;

    rows.forEach((row, idx) => {
        if (isRowEmpty(row)) return;

        if (!row.name || !row.nickname || !row.highTier || !row.currentTier || !row.mainPos) {
            const missing = [
                !row.name && '이름',
                !row.nickname && '닉네임',
                !row.highTier && '최고 티어',
                !row.currentTier && '현재 티어',
                !row.mainPos && '주 포지션',
            ].filter(Boolean).join(', ');
            errors.push(`${idx + 1}번째 행: ${missing} 항목이 비어있습니다.`);
            return;
        }

        const most = row.mostStr.split(',').map((s) => s.trim()).filter(Boolean);
        const newId = `p_${idPrefix}_${idx}_${Math.floor(Math.random() * 1000)}`;
        players[newId] = {
            id: newId,
            name: row.name,
            nickname: row.nickname,
            highTier: row.highTier,
            currentTier: row.currentTier,
            mainPos: row.mainPos,
            subPos: row.subPos,
            most,
            status: 'waiting',
            regOrder: regOrder++,
        };
    });

    return { players, errors };
}
