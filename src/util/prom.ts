export interface Deferred<T> extends Promise<T> {
    resolve(value: T): void;
    reject(reason: any): void;
}

export function deferred<T>(): Deferred<T> {
    const v = new Promise<T>(() => {}) as Deferred<T>;
    (v as any).name = "Deferred";
    return v;
}

export function deadline<T>(p: Promise<T>, ms: number): Promise<T> {
    const rp = deferred<never>();
    const timer = setTimeout(() => {
        rp.reject("Deadline exceeded");
    }, ms);

    return Promise.race([p, rp]).finally(() => {
        clearTimeout(timer);
    });
}
