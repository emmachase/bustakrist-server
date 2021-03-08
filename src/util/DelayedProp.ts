export class DelayedProp<T> {
    private queue: ((x: T) => void)[] = [];

    private initalized: boolean = false;
    private _value?: T = undefined;
    public setValue(x: T) {
        this._value = x;

        if (!this.initalized) {
            for (const cb of this.queue) {
                cb(x);
            }

            this.queue = [];
        }

        this.initalized = true;
    }

    public async getValue(): Promise<T> {
        if (this.initalized) {
            return this._value!;
        }

        return await new Promise(resolve => {
            this.queue.push((x: T) => {
                resolve(x);
            })
        })
    }

    public reset() {
        this.initalized = false;
    }
}
