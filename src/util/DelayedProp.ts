export class DelayedProp<T> {
    private queue: ((x: T) => void)[] = [];

    private initialized: boolean = false;
    private _value?: T = undefined;
    public setValue(x: T) {
        this._value = x;

        if (!this.initialized) {
            for (const cb of this.queue) {
                cb(x);
            }

            this.queue = [];
        }

        this.initialized = true;
    }

    public async getValue(): Promise<T> {
        if (this.initialized) {
            return this._value!;
        }

        return await new Promise(resolve => {
            this.queue.push((x: T) => {
                resolve(x);
            })
        })
    }

    public reset() {
        this.initialized = false;
    }
}
