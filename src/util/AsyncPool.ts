export class AsyncPool {
    private handlers: Map<number, {
        timeout: NodeJS.Timeout
        func: () => void
        fired: boolean
    }> = new Map();

    public addTimeout(key: number, callback: () => void, timeout: number) {
        const func = () => {
            const handler = this.handlers.get(key);
            if (handler && !handler.fired) {
                handler.fired = true;
                callback();
            }
        };

        const lastPart = this.handlers.get(key);
        if (lastPart) {
            clearTimeout(lastPart.timeout);
        }

        this.handlers.set(key, {
            timeout: setTimeout(func, timeout),
            fired: false, func
        });
    }

    public callEarly(key: number) {
        const handler = this.handlers.get(key);
        if (handler) {
            clearTimeout(handler.timeout);
            if (!handler?.fired) {
                handler.func();
            }
        }
    }

    public clear() {
        for (const [,handler] of this.handlers) {
            clearTimeout(handler.timeout);
        }

        this.handlers.clear();
    }
}