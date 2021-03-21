import chalk from "chalk";
import { uid } from 'uid/secure';
import { Subject } from "rxjs";
import { getConnection, LessThan, MoreThan } from "typeorm";
import { getConfig } from "../config";
import { getAllConnections } from "../connect/socketmanager";
import { Ban } from "../entity/Ban";
import { User } from "../entity/User";
import { logger } from "../logger";
import { BalStream, KristService } from "./KristService";
import { GameService } from "./GameService";
import { kstF2 } from "../util/chalkFormatters";
import { ExecutedGame } from "../entity/ExecutedGame";

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

    public sendMessage(msg: {from: string, message: string, to?: string, simulated?: boolean}): void {
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

        if (!msg.simulated) {
            this.checkCommand(event);
        }
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
                    this.sendMessage({
                        from: "<SYSTEM>",
                        message: `${username} has ${user?.balance / 100}KST`,
                        simulated: true
                    });
                } else {
                    this.sendMessage({
                        from: "<SYSTEM>",
                        message: `There is no user named ${username}`,
                        simulated: true
                    });
                }
            }
        } else if (event.message.startsWith("!bankroll")) {
            const bankroll = await KristService.instance.getUnallocatedBalance();

            this.sendMessage({
                from: "<SYSTEM>",
                message: `The current bankroll is ${(bankroll/100).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                })}KST`,
                simulated: true
            });
        } else if (event.message.startsWith("!ipban")) {
            if (event.from !== "emma") {
                return this.sendMessage({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    simulated: true
                });
            }

            const target = event.message.match(/^!ipban (\w+)/);
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

                    this.sendMessage({
                        from: "<SYSTEM>",
                        message: `${username} has been ip-banned.`,
                        simulated: true
                    });
                } else {
                    this.sendMessage({
                        from: "<SYSTEM>",
                        message: `There is no user named ${username} online`,
                        simulated: true
                    });
                }
            }
        } else if (event.message.startsWith("!ban")) {
            if (event.from !== "emma") {
                return this.sendMessage({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    simulated: true
                });
            }

            const target = event.message.match(/^!ban (\w+)/);
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

                    this.sendMessage({
                        from: "<SYSTEM>",
                        message: `${username} has been banned.`,
                        simulated: true
                    });
                } else {
                    this.sendMessage({
                        from: "<SYSTEM>",
                        message: `There is no user named ${username}.`,
                        simulated: true
                    });
                }
            }
        } else if (event.message.startsWith("!rawgive")) {
            if (event.from !== "emma") {
                return this.sendMessage({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    simulated: true
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

                    this.sendMessage({
                        from: "<SYSTEM>",
                        message: `${username}'s balance was raw modified by ${amount}.`,
                        simulated: true
                    });
                } else {
                    this.sendMessage({
                        from: "<SYSTEM>",
                        message: `There is no user named ${username}.`,
                        simulated: true
                    });
                }
            }
        } else if (event.message.startsWith("!give")) {
            if (event.from !== "emma") {
                return this.sendMessage({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    simulated: true
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
                    
                    this.sendMessage({
                        from: "<SYSTEM>",
                        message: `Gave ${username} ${(amount/100).toFixed(2)}KST.`,
                        simulated: true
                    });
                } else {
                    this.sendMessage({
                        from: "<SYSTEM>",
                        message: `There is no user named ${username}.`,
                        simulated: true
                    });
                }
            }
        } else if (event.message.startsWith("!pause")) {
            if (event.from !== "emma") {
                return this.sendMessage({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    simulated: true
                });
            }

            GameService.instance.requestPause();

            this.sendMessage({
                from: "<SYSTEM>",
                message: `A pause has been requested.`,
                simulated: true
            });
        } else if (event.message.startsWith("!unpause")) {
            if (event.from !== "emma") {
                return this.sendMessage({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    simulated: true
                });
            }

            if (GameService.instance.unpause()) {
                this.sendMessage({
                    from: "<SYSTEM>",
                    message: `The game has been resumed.`,
                    simulated: true
                });
            } else {
                this.sendMessage({
                    from: "<SYSTEM>",
                    message: `The game is not paused.`,
                    simulated: true
                });
            }
        } else if (event.message.startsWith("!forcesync")) {
            if (event.from !== "emma") {
                return this.sendMessage({
                    from: "<SYSTEM>",
                    message: `You are not authorized to run this command.`,
                    simulated: true
                });
            }

            getAllConnections().forEach(connection => {
                connection.forceSync();
            });
        } else if (event.message.startsWith("!nextgame")) {
            this.sendMessage({
                from: "<SYSTEM>",
                message: `The next game will be game/seed #${GameService.instance.nextGameID.toLocaleString()}.`,
                simulated: true
            });
        } else if (event.message.startsWith("!lastunder")) {
            const parts = event.message.split(/\s+/);
            parts.shift(); // remove cmd header

            // select * from executed_game where bustedAt > 2000 order by id desc limit 1;
            if (parts && parts[0]) {
                const bust = Math.floor(100*+parts[0])
                if (isNaN(bust)) {
                    return this.sendMessage({
                        from: "<SYSTEM>",
                        message: `Not a valid bust multiplier.`,
                        simulated: true
                    });
                }

                const lastItem = await getConnection().manager
                    .createQueryBuilder(ExecutedGame, "executed_game")
                    .where({ bustedAt: LessThan(bust) })
                    .orderBy({ id: "DESC" })
                    .take(1)
                    .getOne();

                if (!lastItem) {
                    return this.sendMessage({
                        from: "<SYSTEM>",
                        message: `It has yet to bust under ${(bust/100).toFixed(2)}.`,
                        simulated: true
                    });
                }

                return this.sendMessage({
                    from: "<SYSTEM>",
                    message: `It last busted under ${(bust/100).toFixed(2)}, at ${(lastItem.bustedAt/100).toFixed(2)}, in game ${lastItem.id} (${GameService.instance.currentGameID - lastItem.id} games ago).`,
                    simulated: true
                });
            }
        } else if (event.message.startsWith("!lastabove")) {
            const parts = event.message.split(/\s+/);
            parts.shift(); // remove cmd header

            // select * from executed_game where bustedAt > 2000 order by id desc limit 1;
            if (parts && parts[0]) {
                const bust = Math.floor(100*+parts[0])
                if (isNaN(bust)) {
                    return this.sendMessage({
                        from: "<SYSTEM>",
                        message: `Not a valid bust multiplier.`,
                        simulated: true
                    });
                }

                const lastItem = await getConnection().manager
                    .createQueryBuilder(ExecutedGame, "executed_game")
                    .where({ bustedAt: MoreThan(bust) })
                    .orderBy({ id: "DESC" })
                    .take(1)
                    .getOne();

                if (!lastItem) {
                    return this.sendMessage({
                        from: "<SYSTEM>",
                        message: `It has yet to bust above ${(bust/100).toFixed(2)}.`,
                        simulated: true
                    });
                }

                return this.sendMessage({
                    from: "<SYSTEM>",
                    message: `It last busted above ${(bust/100).toFixed(2)}, at ${(lastItem.bustedAt/100).toFixed(2)}, in game ${lastItem.id} (${GameService.instance.currentGameID - lastItem.id} games ago).`,
                    simulated: true
                });
            }
        }
    }
}
