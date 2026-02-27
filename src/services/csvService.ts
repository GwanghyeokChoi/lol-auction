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

    // 최종 결과 내보내기 (새로운 포맷)
    exportResults(teams: Record<string, Team>, players: Record<string, Player>) {
        let csvContent = "";
        const headers = ["이름", "닉네임", "최고티어", "현재티어", "주포지션", "부포지션", "모스트1", "모스트2", "모스트3", "입찰포인트"];

        Object.values(teams).forEach((team, index) => {
            // 팀 정보 행
            csvContent += `"${index + 1}팀 ${team.leaderName}", "남은 포인트: ${team.points}"\n`;

            // 헤더 행
            csvContent += headers.join(',') + '\n';

            // 팀원 정보 행
            if (team.members && team.members.length > 0) {
                team.members.forEach(memberId => {
                    const p = players[memberId];
                    if (p) {
                        const most = p.most || [];
                        const row = [
                            p.name,
                            p.nickname,
                            p.highTier,
                            p.currentTier,
                            p.mainPos,
                            p.subPos,
                            most[0] || '',
                            most[1] || '',
                            most[2] || '',
                            p.soldPrice || 0
                        ];
                        // 각 필드를 ""로 감싸서 쉼표 문제 방지
                        csvContent += row.map(field => `"${field}"`).join(',') + '\n';
                    }
                });
            } else {
                csvContent += "낙찰된 팀원 없음\n";
            }

            // 팀 사이에 빈 줄 추가
            csvContent += '\n';
        });

        const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'auction_result.csv'; a.click();
    }
};