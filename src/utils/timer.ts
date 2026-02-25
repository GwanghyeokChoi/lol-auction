export const TimerUtils = {
    getRemainingSeconds(endTime: number): number {
        const diff = Math.ceil((endTime - Date.now()) / 1000);
        return diff <= 0 ? 0 : diff;
    },

    shuffle<T>(array: T[]): T[] {
        const newArr = [...array];
        for (let i = newArr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
        }
        return newArr;
    }
};