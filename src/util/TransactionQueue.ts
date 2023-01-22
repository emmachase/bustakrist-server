
const queue: (() => void)[] = [];

export function queueTransaction<T>(txFun: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        queue.push(
            () => {
                txFun().then((value) => {
                    resolve(value);
                }).catch((value) => {
                    reject(value);
                }).finally(() => {
                    queue.shift();

                    if (queue.length > 0) {
                        queue[0]();
                    }
                });
            }
        );

        if (queue.length === 1) {
            // Kickstart the queue
            queue[0]();
        }
    });
}
