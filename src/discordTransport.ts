import Transport, { TransportStreamOptions } from 'winston-transport';
import request from 'superagent';

/**
 * Options for Discord transport for winston
 */
interface DiscordTransportOptions extends TransportStreamOptions {
    /** Webhook obtained from Discord */
    webhook: string;
    /** Meta data to be included inside Discord Message */
    defaultMeta: any;
}

/**
 * Nextabit's Discord Transport for winston
 */
export default class DiscordTransport extends Transport {
    /** Webhook obtained from Discord */
    private webhook: string;

    /** Discord webhook id */
    private id: string;

    /** Discord webhook token */
    private token: string;

    /** Initialization promise resolved after retrieving discord id and token */
    private initialized: Promise<void>;

    constructor(opts: DiscordTransportOptions) {
        super(opts);
        this.webhook = opts.webhook;
        this.initialize();
    }

    /** Helper function to retrieve url */
    private getUrl = () => {
        return `https://discordapp.com/api/v6/webhooks/${this.id}/${this.token}`;
    }

    /**
     * Initialize the transport to fetch Discord id and token
     */
    private initialize = () => {
        this.initialized = new Promise((resolve, reject) => {
            const opts = {
                url: this.webhook,
                method: 'GET',
                json: true
            };
            request
                .get(opts.url)
                .set('accept', 'json')
                .then(response => {
                    this.id = response.body.id;
                    this.token = response.body.token;
                    resolve();
                }).catch(err => {
                    console.error(`Could not connect to Discord Webhook at ${this.webhook}`);
                    reject(err);
                });
        });
    }

    /**
     * Function exposed to winston to be called when logging messages
     * @param info Log message from winston
     * @param callback Callback to winston to complete the log
     */
    log(info: any, callback: { (): void }) {
        if (info.discord !== false) {
            setImmediate(() => {
                this.initialized.then(() => {
                    this.sendToDiscord(info);
                }).catch(err => {
                    console.log('Error sending message to discord', err);
                });
            });
        }

        callback();
    }

    /**
     * Sends log message to discord
     */
    private sendToDiscord = async (info: any, isRatelimited?: boolean) => {
        const postBody = {
            content: `${new Date().toISOString()} : ${info.message}`
        };

        if (info.level === 'error' && info.error && info.error.stack) {
            postBody.content += `\n\`\`\`${info.error.stack}\`\`\``;
        }

        if (isRatelimited) {
            postBody.content += '\n== This message was ratelimited, please check the timestamps carefully ==';
        }

        const options = {
            url: this.getUrl(),
            method: 'POST',
            json: true,
            body: postBody
        };

        try {
            await request
                .post(options.url)
                .send(options.body)
                .set('accept', 'json')
        } catch (err: any) {
            console.error('Error sending to discord');
            if (err.status === 429) {
                const body = err.response._body;
                const tryAgain = body.retry_after;
                console.error(`Rate limited, trying again in ${tryAgain/1000} seconds`);
                setTimeout(() => {
                    this.sendToDiscord(info, true);
                }, tryAgain);
            }
        }
    }
}
