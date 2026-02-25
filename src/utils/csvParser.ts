import Papa from 'papaparse';
import type { Player } from '../types';

export const parsePlayerCSV = (file: File): Promise<Record<string, Player>> => {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: false,        // 헤더(제목 줄)가 없으므로 false
            skipEmptyLines: true, // 빈 줄은 건너뜀
            complete: (results) => {
                const players: Record<string, Player> = {};

                results.data.forEach((row: any, index: number) => {
                    // row[1]은 소환사명 (예: 디바라밥#KR1)
                    // row[2]는 티어 (예: 에메랄드1)
                    const name = row[1] ? row[1].trim() : `선수${index}`;
                    const tier = row[2] ? row[2].trim() : "Unranked";

                    const playerId = `p${index}`;
                    players[playerId] = {
                        id: playerId,
                        name: name,
                        tier: tier,
                        isSold: false
                    };
                });
                resolve(players);
            },
            error: (error) => reject(error)
        });
    });
};