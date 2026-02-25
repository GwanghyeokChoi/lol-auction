import Papa from 'papaparse';
import type { Player } from '../types';

export const parsePlayerCSV = (file: File): Promise<Record<string, Player>> => {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: false,
            skipEmptyLines: true,
            complete: (results) => {
                const players: Record<string, Player> = {};

                results.data.forEach((row: any, index: number) => {
                    const name = row[0] ? row[0].trim() : `선수${index}`;
                    const nickname = row[1] ? row[1].trim() : '';
                    const tier = row[2] ? row[2].trim() : "Unranked";
                    
                    const playerId = `p${index}`;
                    players[playerId] = {
                        id: playerId,
                        name: name,
                        nickname: nickname,
                        tier: tier,
                        mainPos: row[3] || '',
                        subPos: row[4] || '',
                        most: [],
                        status: 'waiting'
                    };
                });
                resolve(players);
            },
            error: (error) => reject(error)
        });
    });
};