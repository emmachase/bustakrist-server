import chalk from "chalk";
import { uid } from 'uid/secure';
import { Subject } from "rxjs";
import { getConnection } from "typeorm";
import { getConfig } from "../config";
import { getAllConnections } from "../connect/socketmanager";
import { Ban } from "../entity/Ban";
import { User } from "../entity/User";
import { logger } from "../logger";
import { BalStream, KristService } from "./KristService";
import { GameService } from "./GameService";
import { kstF2 } from "../util/chalkFormatters";

interface ChatEvent {
    from: string // Username
    message: string
    timestamp: number // +new Date()
    private?: boolean
    to?: string
    feed?: string
}

export class ChatService extends Subject<ChatEvent> {
    public static instance = new ChatService();

    private get maxHistoryLength() {
        return getConfig().chat.history;
    }

    public globalHistory: ChatEvent[] = [];

    private constructor() {
        super();
    }

    previousIds: string[] = [];
    getId(): string {
        let id: string;

        do {
            id = uid();
        } while(this.previousIds.includes(id));

        this.previousIds = this.previousIds.slice(-255);
        this.previousIds.push(id);

        return id;
    }

    public sendMessage(msg: {from: string, message: string, to?: string}): void {
        logger.info(chalk`{magenta.bold ${msg.from}}: ${msg.message} -> {cyan ${msg.to ?? "Global"}}`);

        const privateMsg = !!msg.to;
        const event = {
            id: this.getId(),
            from: msg.from,
            message: msg.message,
            to: msg.to,
            timestamp: +new Date(),
            private: privateMsg || undefined
        };

        if (!privateMsg) {
            this.globalHistory.push(event);
            this.globalHistory = this.globalHistory.slice(-this.maxHistoryLength);
        }

        this.next(event);

        this.checkCommand(event);
    }

    private async checkCommand(event: {
        from: string
        message: string
        timestamp: number
        to?: string
        private?: boolean
    }) {
        if (event.message.startsWith("!bal")) {
            const target = event.message.match(/^!bal (\w+)/);
            if (target && target[1]) {
                const username = target[1];
                const user = await getConnection().manager.findOne(User, {
                    where: { name: username },
                    select: ["balance"]
                });

                if (user) {
                    this.next({
                        from: "<SYSTEM>",
                        message: `${username} has ${user?.balance / 100}KST`,
                        timestamp: +new Date(),
                    });
                } else {
                    this.next({
                        from: "<SYSTEM>",
                        message: `There is no user named ${username}`,
                        timestamp: +new Date(),
                    });
                }
            }
        } else if (event.message.startsWith("!bankroll")) {
            const bankroll = await KristService.instance.getUnallocatedBalance();

            this.next({
                from: "<SYSTEM>",
                message: `The current bankroll is ${(bankroll/100).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                })}KST`,
                timestamp: +new Date(),
            });
        } else if (event.message.startsWith("!banip")) {
            if (event.from !== "emma") {
                return this.next({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    timestamp: +new Date(),
                });
            }

            const target = event.message.match(/^!banip (\w+)/);
            if (target && target[1]) {
                const username = target[1];
                let ips = new Set<string>();
                for (const sock of getAllConnections()) {
                    const user = sock.getAuthedUser();
                    if (user?.name === username) {
                        ips.add(sock.getOriginalRequest().ip);

                        sock.ban(true);
                    }
                }

                if (ips.size) {
                    for (const ip of ips) {
                        const ban = new Ban();
                        ban.ip = ip;

                        await getConnection().manager.save(ban);
                    }

                    this.next({
                        from: "<SYSTEM>",
                        message: `${username} has been ip-banned.`,
                        timestamp: +new Date(),
                    });
                } else {
                    this.next({
                        from: "<SYSTEM>",
                        message: `There is no user named ${username} online`,
                        timestamp: +new Date(),
                    });
                }
            }
        } else if (event.message.startsWith("!ban")) {
            if (event.from !== "emma") {
                return this.next({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    timestamp: +new Date(),
                });
            }

            const target = event.message.match(/^!banip (\w+)/);
            if (target && target[1]) {
                const username = target[1];
                const user = await getConnection().manager.findOne(User, {
                    where: { name: username },
                });

                for (const sock of getAllConnections()) {
                    const user = sock.getAuthedUser();
                    if (user?.name === username) {
                        sock.ban(false);
                    }
                }

                if (user) {
                    user.banned = true;
                    await getConnection().manager.save(user);

                    this.next({
                        from: "<SYSTEM>",
                        message: `${username} has been banned.`,
                        timestamp: +new Date(),
                    });
                } else {
                    this.next({
                        from: "<SYSTEM>",
                        message: `There is no user named ${username}.`,
                        timestamp: +new Date(),
                    });
                }
            }
        } else if (event.message.startsWith("!rawgive")) {
            if (event.from !== "emma") {
                return this.next({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    timestamp: +new Date(),
                });
            }

            const parts = event.message.split(/\s+/);
            parts.shift(); // remove cmd header

            if (parts && parts[0] && parts[1]) {
                const username = parts[0];
                const user = await getConnection().manager.findOne(User, {
                    where: { name: username },
                    select: ["id", "name", "balance"]
                });

                if (user) {
                    const amount = Math.floor(+parts[1]) || 0;
                    await getConnection().manager.increment(User, { id: user.id }, "balance", amount);
                    BalStream.next({ user: user.name });

                    this.next({
                        from: "<SYSTEM>",
                        message: `${username}'s balance was raw modified by ${amount}.`,
                        timestamp: +new Date(),
                    });
                } else {
                    this.next({
                        from: "<SYSTEM>",
                        message: `There is no user named ${username}.`,
                        timestamp: +new Date(),
                    });
                }
            }
        } else if (event.message.startsWith("!give")) {
            if (event.from !== "emma") {
                return this.next({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    timestamp: +new Date(),
                });
            }

            const parts = event.message.split(/\s+/);
            parts.shift(); // remove cmd header

            if (parts && parts[0] && parts[1]) {
                const username = parts[0];
                const user = await getConnection().manager.findOne(User, {
                    where: { name: username },
                    select: ["id", "name", "balance"]
                });

                if (user) {
                    const amount = Math.floor(+parts[1]*100) || 0;
                    await getConnection().manager.transaction(async manager => {
                        await manager.increment(User, { id: user.id }, "balance", amount);
                        await manager.increment(User, { id: user.id }, "totalIn", amount);
                    })
                    BalStream.next({ user: user.name });
                    
                    this.next({
                        from: "<SYSTEM>",
                        message: `Gave ${username} ${(amount/100).toFixed(2)}KST.`,
                        timestamp: +new Date(),
                    });
                } else {
                    this.next({
                        from: "<SYSTEM>",
                        message: `There is no user named ${username}.`,
                        timestamp: +new Date(),
                    });
                }
            }
        } else if (event.message.startsWith("!pause")) {
            if (event.from !== "emma") {
                return this.next({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    timestamp: +new Date(),
                });
            }

            GameService.instance.requestPause();

            this.next({
                from: "<SYSTEM>",
                message: `A pause has been requested.`,
                timestamp: +new Date(),
            });
        } else if (event.message.startsWith("!unpause")) {
            if (event.from !== "emma") {
                return this.next({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    timestamp: +new Date(),
                });
            }

            if (GameService.instance.unpause()) {
                this.next({
                    from: "<SYSTEM>",
                    message: `The game has been resumed.`,
                    timestamp: +new Date(),
                });
            } else {
                this.next({
                    from: "<SYSTEM>",
                    message: `The game is not paused.`,
                    timestamp: +new Date(),
                });
            }
        }
    }
}
