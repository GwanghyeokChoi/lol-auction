import Papa from 'papaparse';
import type { Player, Team } from '../types';

export const CSVService = {
    // 선수 데이터 파싱 (상세 정보 포함)
    parsePlayers(file: File): Promise<Record<string, Player>> {
        return new Promise((resolve) => {
            Papa.parse(file, {
                header: false,
                skipEmptyLines: true,
                complete: (res) => {
                    const players: Record<string, Player> = {};
                    res.data.forEach((row: any, i) => {
                        // 이름,닉네임,최고티어,현재티어,주포지션,부포지션,모스트1,모스트2,모스트3
                        if (row.length < 5) return; // 최소한 주포지션까지는 있어야 함
                        const id = `p_${i}`;
                        players[id] = {
                            id, 
                            name: row[0]?.trim(), 
                            nickname: row[1]?.trim(), 
                            highTier: row[2]?.trim(),
                            currentTier: row[3]?.trim(),
                            mainPos: row[4]?.trim(), 
                            subPos: row[5]?.trim(),
                            most: [row[6], row[7], row[8]].filter(v => v && v.trim() !== ''),
                            status: 'waiting'
                        };
                    });
                    resolve(players);
                }
            });
        });
    },

    // 최종 결과 내보내기
    exportResults(teams: Record<string, Team>, players: Record<string, Player>) {
        const rows = Object.values(teams).map(t => ({
            팀장: t.leaderName,
            잔여포인트: t.points,
            팀원: (t.members || []).map(mId => players[mId].name).join(', ')
        }));
        const csv = Papa.unparse(rows);
        const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'auction_result.csv'; a.click();
    }
};