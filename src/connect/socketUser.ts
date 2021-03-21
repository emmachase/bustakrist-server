import chalk from "chalk";
import { Request } from "express";
import WebSocket from "ws";
import { User } from "../entity/User";
import { logger } from "../logger";
import { safeSend } from "./socketmanager";
import { ErrorCode, ErrorDetail, RequestCode, UpdateCode } from "./transportCodes";
import { getConnection } from "typeorm";
import { ChatService } from "../services/ChatService";
import { Subscription } from "rxjs";
import { GameEvent, GameService } from "../services/GameService";
import { BalStream, TipStream } from "../services/KristService";

const requestHandlers: Record<RequestCode, (msg: RequestMessage) => void> = {} as any;

export function RequestHandler(type: RequestCode): MethodDecorator {
    return function (
      _target: typeof SocketUser,
      _propertyKey: string,
      descriptor: PropertyDescriptor
    ) {
        requestHandlers[type] = descriptor.value;
    } as MethodDecorator;
}

export const TranscludeMethod: MethodDecorator = (_target, propertyKey, descriptor) => {
    const proto = SocketUser.prototype as any;
    proto[propertyKey] = descriptor.value;
}

export class RequestMessage<D = unknown> {
    constructor(private ws: WebSocket, public id: number | undefined, public data: Partial<D> | undefined) {}

    private reply(ok: boolean, data?: unknown, extra?: Record<string, unknown>) {
        safeSend(this.ws, {
            ok, type: UpdateCode.REPLY, id: this.id, data, ...extra
        })
    }

    public replySuccess(data?: unknown) {
        return this.reply(true, data);
    }

    public replyFail(code: ErrorCode, msg?: ErrorDetail | string, data?: unknown) {
        return this.reply(false, data, {
            errorType: code,
            error: msg
        });
    }
}

export class SocketUser {
    protected ws: WebSocket;
    protected origReq: Request;
    public getOriginalRequest() {
        return this.origReq;
    }

    // When the user logs in, their User will be hydrated
    protected authedUser?: User;
    public getAuthedUser(): User | undefined {
        return this.authedUser;
    }

    protected get ip() {
        return this.origReq.ip;
    }

    public get isActive() {
        return this.ws.readyState === 1; // Open
    }

    public constructor(ws: WebSocket, req: Request) {
        this.ws = ws;
        this.origReq = req;

        ws.on("message", this.handleMessage.bind(this));
        ws.on("close", this.die.bind(this));
    }

    public initialize() {
        this.presendHistory();

        this.registerObservers();

        logger.info(chalk`WS Connection established from {yellow ${this.origReq.ip}}`)
    }

    public ban(ip: boolean) {
        safeSend(this.ws, {
            ok: false,
            type: UpdateCode.HELLO,
            errorType: ErrorCode.BANNED,
            error: ip 
                ? "Your IP has been banned"
                : "You have been banned"
        });

        this.die();
    }

    private presendHistory() {
        // Game History
        if (GameService.instance.gameIsRunning) {
            const state = GameService.instance.getState();

            if (GameService.instance.gamePaused) {
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.PAUSED,
                    data: {
                        value: true
                    }
                });
            }

            safeSend(this.ws, {
                ok: true,
                type: UpdateCode.GAME_STARTING,
                data: {
                    now: +new Date(),
                    start: state.start,
                    gameid: state.gameid
                }
            });

            if (state.bust) {
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.BUSTED,
                    data: {
                        bust: state.bust,
                        hash: state.hash
                    }
                });
            }

            safeSend(this.ws, {
                ok: true,
                type: UpdateCode.ADD_ALL_PLAYERS,
                data: {
                    players: state.wagers.map(w => ({
                        name: w.player.name,
                        wager: w.wager,
                        cashout: w.exited ? w.cashout : undefined
                    }))
                }
            });
        }

        // Bust History
        safeSend(this.ws, {
            ok: true,
            type: UpdateCode.HISTORY,
            data: {
                history: GameService.instance.previousGames.map(g => ({
                    id: g.hash.id,
                    bust: g.bustedAt,
                    hash: g.hash.hash,
                }))
            }
        });

        // Chat History
        for (const next of ChatService.instance.globalHistory) {
            safeSend(this.ws, {
                ok: true,
                type: UpdateCode.MESSAGE,
                data: next,
            });
        }
    }

    private destruct() {
        this.notifyLeave();
        this.subscriptions.forEach(s => s.unsubscribe());
    }

    private handleMessage(data: WebSocket.Data) {
        let request: {
            type?: RequestCode
            id?: number
            data?: Record<string, unknown>
        };

        try {
            const dataStr = data.toString();
            if (dataStr.length > 10000) {
                this.sendMalformed(ErrorDetail.TOO_BIG);
                this.die();
                return;
            }

            request = JSON.parse(dataStr);

            if (typeof request !== "object") {
                logger.debug("failed object")
                return this.sendMalformed(ErrorDetail.INVALID_JSON);
            }
        } catch {
            return this.sendMalformed(ErrorDetail.INVALID_JSON);
        }

        if (request.type === undefined) {
            return this.sendMalformed(ErrorDetail.NO_TYPE);
        }

        const rMsg = new RequestMessage(this.ws, request.id, request.data);
        try {
            const handler = requestHandlers[request.type];
            if (handler) {
                handler.call(this, rMsg);
            } else {
                return rMsg.replyFail(ErrorCode.UNKNOWN_TYPE);
            }
        } catch {
            return rMsg.replyFail(ErrorCode.INTERNAL_ERROR);
        }
    }

    protected sendError(code: ErrorCode, detail: ErrorDetail): void {
        safeSend(this.ws, {
            ok: false,
            errorType: code,
            error: detail
        })
    }

    protected sendMalformed(detail: ErrorDetail): void {
        return this.sendError(ErrorCode.MALFORMED, detail);
    }


    private subscriptions: Subscription[] = [];
    private registerObservers() {
        this.subscriptions.push(ChatService.instance.subscribe(next => {
            const direct = this.authedUser?.name === next.to;

            if (!next.private || direct
                || this.authedUser?.name === next.from) {
                
                if (next.private) {
                    next.feed = direct ? next.from : next.to;
                }

                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.MESSAGE,
                    data: next,
                });
            }
        }));

        this.subscriptions.push(BalStream.subscribe(async next => {
            if (this.authedUser?.name === next.user) {
                await this.refresh();
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.UPDATE_BALANCE,
                    data: { ...next, newBal: this.authedUser.balance }
                })
            }
        }));

        this.subscriptions.push(TipStream.subscribe(async next => {
            if (this.authedUser?.name === next.to) {
                await this.refresh();
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.RECIEVE_TIP,
                    data: { ...next, newBal: this.authedUser.balance }
                })
            }
        }));

        this.subscriptions.push(GameService.instance.CashoutAlertStream.subscribe(async next => {
            if (this.authedUser?.id === next.user.id) {
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.ALERT_SAFETY,
                })
            }
        }))

        this.subscriptions.push(GameService.instance.GameStream.subscribe(async next => {
            // setTimeout to push to next event tick to let values propogate (specifically balances)
            await this.refresh();
            const newBal = this.authedUser?.balance;

            if (next.type === GameEvent.ANNOUNCE_START) {
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.GAME_STARTING,
                    data: {
                        now: +new Date(),
                        start: next.start,
                        gameid: next.gameid, newBal
                    }
                });
            } else if (next.type === GameEvent.AFTER_DRAIN) {
                await this.refresh();
                if (this.authedUser) {
                    safeSend(this.ws, {
                        ok: true,
                        type: UpdateCode.UPDATE_BALANCE,
                        data: {
                            newBal: this.authedUser.balance
                        }
                    });
                }
            } else if (next.type === GameEvent.BUST) {
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.BUSTED,
                    data: {
                        bust: next.bustedAt, 
                        hash: next.hash, newBal
                    }
                });

                await this.sendAuthedGameState();
            } else if (next.type === GameEvent.ADD_PLAYER) {
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.ADD_PLAYER,
                    data: {
                        name: next.name,
                        wager: next.wager
                    }
                });
            } else if (next.type === GameEvent.PLAYER_CASHEDOUT) {
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.PLAYER_CASHEDOUT,
                    data: {
                        name: next.name,
                        cashout: next.cashout
                    }
                });
            } else if (next.type === GameEvent.PAUSED) {
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.PAUSED,
                    data: {
                        value: next.value
                    }
                });
            }
        }));

        this.subscriptions.push(GameService.instance.UserPlayingStream.subscribe(async next => {
            if (this.authedUser?.id === next.user.id) {
                safeSend(this.ws, {
                    ok: true,
                    type: UpdateCode.UPDATE_PLAYING,
                    data: {
                        playing: next.isPlaying
                    }
                })
            }
        }));
    }

    public die() {
        this.ws.close();
        this.destruct();
    }

    public async refresh() {
        if (!this.authedUser) return;

        this.authedUser = await getConnection().manager.findOne(User, this.authedUser.id);
    }

    public notifyJoin() {
        if (this.authedUser) {
            ChatService.instance.sendMessage({
                from: this.authedUser?.name!, 
                message: "<joined the chat>"
            });
        }
    }

    public notifyLeave() {
        if (this.authedUser) {
            ChatService.instance.sendMessage({
                from: this.authedUser.name,
                message: "<left the chat>"
            });
        }
    }

    public async sendAuthedGameState() {
        if (this.authedUser) {
            safeSend(this.ws, {
                ok: true,
                type: UpdateCode.UPDATE_PLAYING,
                data: {
                    playing: await GameService.instance.isPlaying(this.authedUser)
                }
            })
        }
    }
}
