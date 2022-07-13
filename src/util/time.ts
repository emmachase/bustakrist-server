import { loggedSetTimeout } from "./timeout";

export const MS = 1;
export const SECOND = 1000 * MS;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function sleepFor(ms: number, context?: any): Promise<void> {
    return new Promise(r => 
        loggedSetTimeout(() => r(), ms, context)
    );
}
