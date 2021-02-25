import chalk from "chalk";
import { Subject } from "rxjs";
import { getConnection } from "typeorm";
import { getConfig } from "../config";
import { User } from "../entity/User";
import { logger } from "../logger";

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

    public sendMessage(msg: {from: string, message: string, to?: string}): void {
        logger.info(chalk`{magenta.bold ${msg.from}}: ${msg.message} -> {cyan ${msg.to ?? "Global"}}`);

        const privateMsg = !!msg.to;
        const event = {
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
        }
    }
}
