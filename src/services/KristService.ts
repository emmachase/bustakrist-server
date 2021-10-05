import { Subject } from "rxjs";
import axios from "axios";
import WebSocket, { MessageEvent } from "ws";
import { getConfig } from "../config";
import { logger } from "../logger";
import { SECOND, sleepFor } from "../util/time";
import { DelayedProp } from "../util/DelayedProp";
import chalk from "chalk";
import { getConnection } from "typeorm";
import { User } from "../entity/User";
import { kst } from "../util/chalkFormatters";
import { metrics, metrics_prefix } from "../connect/prometheus";

type CommonMeta = {
    metaname?: string
    name?: string
    recipient?: string

    username?: string
    message?: string
    return?: string
} & Record<string, string>;

interface KristAddress {
    address: string;
    balance: number;
    totalin: number;
    totalout: number;
    firstseen: string; // Date
}

interface KristTransaction {
    id: number,
    from: string,
    to: string, 
    value: number,
    time: string, // Date
    metadata: string,
    sent_metaname?: string, // The @ address
    sent_name?: string, // abc.kst 
}

type KristEvent = { 
    type: "event", 
    event: "transaction", 
    transaction: 
        | { type: "transfer" } & KristTransaction 
        | { type: "mined" | "name_purchase" | "name_a_record" | "name_transfer" }
} | { type: "event", event: "block" | "name" | "motd" }

export const TipStream = new Subject<{
    to: string, // ID
    from: string, // ID
    amount: number
}>();

export const BalStream = new Subject<{
    user: string
}>();

new metrics.Gauge({
    name: metrics_prefix + "wallet_krist",
    help: "Amount of Krist contained in the wallet",
    labelNames: ["division"],
    async collect() {
        this.set(
            { division: "all" }, 
            await KristService.instance.getBalance()
        );

        this.set(
            { division: "allocated" }, 
            await KristService.instance.getAllocatedBalance() / 100
        );

        this.set(
            { division: "unallocated" }, 
            await KristService.instance.getUnallocatedBalance() / 100
        );
    }
});

export class KristService {
    private static _instance: KristService;
    public static get instance() {
        if (this._instance) return this._instance;
        else return this._instance = new KristService();
    }

    private ws: WebSocket;

    private activeRequests: Map<number, (x: unknown) => void> = new Map();
    private idCounter = 0;
    private genID(): number {
      // The ORZ will wrap as a 32 bit int, which is desirable
      return this.idCounter = (this.idCounter + 1) | 0;
    }

    private walletTotalBalance = new DelayedProp<number>();

    // Amount of Krist held in user accounts (Fixed 2)
    async getAllocatedBalance(): Promise<number> {
        const { sum } = await getConnection().manager
            .createQueryBuilder(User, "user")
            .select("SUM(user.balance)", "sum")
            .getRawOne();
        
        return sum;
    }

    // Amount of Krist in the wallet that is not held in user accounts (Fixed 2)
    async getUnallocatedBalance(): Promise<number> {
        return 100*await this.walletTotalBalance.getValue() - await this.getAllocatedBalance();
    }

    private constructor() {}

    public async tryConnect() {
        logger.info("Connecting to Krist...");

        const startRes = await axios(`https://${getConfig().krist.node}/ws/start`, {
            method: "POST",
            params: { privatekey: getConfig().krist.pkey }
        });

        const wsURL = startRes.data;
        if (!wsURL?.ok) {
            throw new Error("Could not connect to Krist");
        }

        this.ws = new WebSocket(wsURL.url);
        this.ws.onopen = this.onOpen.bind(this);
        this.ws.onclose = this.onClose.bind(this);
        this.ws.onmessage = this.handleMessage.bind(this);
    }

    private handleMessage(message: MessageEvent) {
        const dataStr = message.data.toString("ascii");
        let data: Record<string, unknown>;
        try {
            const obj = JSON.parse(dataStr);
            if (obj !== null && typeof obj !== "object") return;

            data = obj;
        } catch {
            // Meh, probably wasn't important anyways
            return;
        }

        if (typeof data.id === "number") {
            const callback = this.activeRequests.get(data.id);
            if (callback) {
                callback(data);
            }

            // Clear from queue as it has been fulfilled
            this.activeRequests.delete(data.id);
        } else {
            const msgType = data.type;
            switch (msgType) {
                case "hello": // passthrough
                case "keepalive":
                    break;

                case "event":
                    logger.debug(chalk`{bold Krist event}: '${dataStr}'`);

                    const event = data as KristEvent;
                    if (event.event === "transaction" && event.transaction.type === "transfer") {
                        const trans = event.transaction;
                        this.processTransaction(trans);
                    }

                    break;

                default:
                    logger.warn(chalk`{bold Unsolicted Krist message}: '${dataStr}'`);
            }
        }
    }

    private async processTransaction(trans: KristTransaction): Promise<void> {
        const myAddress = getConfig().krist.address;
        if (trans.from === myAddress && trans.to !== myAddress) {
            this.walletTotalBalance.setValue(
                await this.walletTotalBalance.getValue() - trans.value
            )
        } else if (trans.from !== myAddress && trans.to === myAddress) {
            this.walletTotalBalance.setValue(
                await this.walletTotalBalance.getValue() + trans.value
            )

            await this.processIncomingTransaction(trans);
        } else {
            // We don't care about this tx
            // Either we're not involved, or it was a NO-OP
            return;
        }
    }

    private async processIncomingTransaction(trans: KristTransaction): Promise<void> {
        if (!trans.sent_name) return;

        // Check that we are registered to respond to this name
        if (!getConfig().krist.names.includes(trans.sent_name)) return;

        if (!trans.sent_metaname) {
            return void await this.makeRefund(trans, "No username specified, send to username@" + trans.sent_name + ".kst");
        };

        const user = await getConnection().manager.createQueryBuilder(User, "user")
            .where("LOWER(user.name) = LOWER(:name)", { name: trans.sent_metaname })
            .getOne();

        if (!user) {
            return void await this.makeRefund(trans, "The user '" + trans.sent_metaname + "' does not exist");
        }

        await getConnection().manager.transaction(async manager => {
            await manager.increment(User, { id: user.id }, "balance", 100*trans.value);
            await manager.increment(User, { id: user.id }, "totalIn", 100*trans.value);
        })
        BalStream.next({ user: user.name })

        const safeFrom = this.getSafeReturn(trans.from, this.parseCommonMeta(trans.metadata));
        logger.info(chalk`Recieved ${kst(Math.floor(trans.value))} from {magenta ${safeFrom}} for user {cyan ${user.name}}`);
    }

    private async makeRequest(type: "me"): Promise<{ isGuest: true } | { isGuest: false, address: KristAddress }>;
    private async makeRequest(type: "login", payload: { privatekey: string }): Promise<{ isGuest: true } | { isGuest: false, address: KristAddress }>;
    private async makeRequest(type: "subscribe",   payload: { event: string }): Promise<{ subscription_level: string[] }>;
    private async makeRequest(type: "unsubscribe", payload: { event: string }): Promise<{ subscription_level: string[] }>;
    private async makeRequest(type: "make_transaction", payload: {
        to: string, amount: number, metadata?: string
    }): Promise<{ transaction: KristTransaction }>;
    private async makeRequest(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
        const requestId = this.genID();

        this.ws.send(JSON.stringify({
            type: type,
            id: requestId,
            ... payload
        }));

        return await new Promise((resolve, reject) => {
            this.activeRequests.set(requestId, res => {
                logger.silly(chalk`{bold Krist response}: ${JSON.stringify(res)}`); // Very silly debug

                if (typeof res === "object" && res && (res as {ok: boolean}).ok) {
                    resolve(res);
                } else {
                    reject(res);
                }
            })
        });
    }

    private async onOpen() {
        await Promise.all([
            this.makeRequest("unsubscribe", { event: "blocks" }),
            this.makeRequest("subscribe", { event: "ownTransactions" }),
        ]);

        let me = await this.makeRequest("me");
        if (me.isGuest) {
            me = await this.makeRequest("login", { privatekey: getConfig().krist.pkey });
            if (me.isGuest) {
                throw logger.error("Unable to login to Krist");
            }
        }

        this.walletTotalBalance.setValue(me.address.balance);
    }

    private async onClose() {
        while (true) {
            try {
                logger.error("Lost connection to Krist, reconnecting in " + getConfig().krist.connectionBounce + " seconds");
                await sleepFor(getConfig().krist.connectionBounce * SECOND);

                await this.tryConnect();
                break;
            } catch {}
        }
    }

    public encodeCommonMeta(meta: CommonMeta): string {
        return Object.entries(meta).map(([prop, value]) => `${prop}=${value}`).join(";");
    }

    public parseCommonMeta(metadata: string | null): CommonMeta {
		if (!metadata) return {};

		const parts: CommonMeta = {};

		const metaParts = metadata.split(";");
		if (metaParts.length <= 0) return {};

		const nameMatches = /^(?:([a-z0-9-_]{1,32})@)?([a-z0-9]{1,64}\.kst)$/.exec(metaParts[0]);

		if (nameMatches) {
			if (nameMatches[1]) parts.metaname = nameMatches[1];
			if (nameMatches[2]) parts.name = nameMatches[2];

			parts.recipient = nameMatches[1] ? nameMatches[1] + "@" + nameMatches[2] : nameMatches[2];
		}

		for (let i = 0; i < metaParts.length; i++) {
			const metaPart = metaParts[i];
			const kv = metaPart.split("=", 2);

			if (i === 0 && nameMatches) continue;

			if (kv.length === 1) {
				parts[i.toString()] = kv[0];
			} else {
				parts[kv[0]] = kv.slice(1).join("=");
			}
		}

		return parts;
	}

    public getSafeReturn(rawFrom: string, meta: CommonMeta) {
        const ideal = (meta.return ?? rawFrom).toLowerCase();

        if (ideal.endsWith(".kst")) {
            const name = ideal.match(/(.*)\.kst/);
            if (name && name[1]) {
                if (getConfig().krist.names.includes(name[1])) {
                    // Prevent infinite loops
                    return rawFrom;
                }
            }
        }

        return ideal;
    }

    public async getBalance(): Promise<number> {
        return this.walletTotalBalance.getValue();
    }

    public async makeRefund(trans: KristTransaction, message: string) {
        const meta = this.parseCommonMeta(trans.metadata);

        try {
            return await this.makeRequest("make_transaction", {
                to: this.getSafeReturn(trans.from, meta),
                amount: trans.value,
                metadata: this.encodeCommonMeta({
                    return: getConfig().krist.address,
                    message: message
                })
            })
        } catch (e) {
            logger.error(chalk`{bold Error making refund}: ${e.toString()}`)
        }
    }

    public async makeWithdrawal(username: string, to: string, amount: number) {
        try {
            return await this.makeRequest("make_transaction", {
                to: this.getSafeReturn(to, {}),
                amount: amount,
                metadata: this.encodeCommonMeta({
                    return: `${username}@${getConfig().krist.names[0]}.kst`.toLowerCase(),
                    message: "Thank you for using BustAKrist!"
                })
            })
        } catch (e) {
            logger.error(chalk`{bold Error making refund}: ${e.toString()}`)
        }
    }
}
