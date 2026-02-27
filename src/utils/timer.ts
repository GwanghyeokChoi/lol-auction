import { ref, onValue } from "firebase/database";
import { db } from "../firebase";

let serverTimeOffset = 0;

export const TimerUtils = {
    initServerTimeOffset() {
        const offsetRef = ref(db, ".info/serverTimeOffset");
        onValue(offsetRef, (snap) => {
            serverTimeOffset = snap.val() || 0;
        });
    },

    getServerTime(): number {
        return Date.now() + serverTimeOffset;
    },

    getRemainingSeconds(endTime: number): number {
        const now = this.getServerTime();
        const diff = Math.ceil((endTime - now) / 1000);
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