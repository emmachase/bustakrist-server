export function loggedSetTimeout(cb: () => void, ms: number, context?: any): NodeJS.Timeout {
    // Check if ms is larger than 32 bit signed integer
    if (ms > 0x7fffffff) {
        throw new Error(`Timeout of ${ms} too big (context: ${JSON.stringify(context)})`);
    }

    return setTimeout(cb, ms);
}
