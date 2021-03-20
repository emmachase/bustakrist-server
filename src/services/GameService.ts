import chalk from "chalk";
import { Subject } from "rxjs";
import { EntityManager, getConnection } from "typeorm";
import { getConfig } from "../config";
import { ConnectionStream, isAnyoneHere } from "../connect/socketmanager";
import { ExecutedGame } from "../entity/ExecutedGame";
import { GameHash } from "../entity/GameHash";
import { User } from "../entity/User";
import { logger } from "../logger";
import { fetchHistory, fetchNextGameID } from "../util/database";
import { SECOND, sleepFor } from "../util/time";
import { calculateGameResult, getIndividualSafety, getRoundLength, getRoundSafety, getScoreAt } from "./ScoreService";
import { DateTime, Duration } from "luxon";
import { HistoricalBet } from "../entity/HistoricalBet";
import { AsyncPool } from "../util/AsyncPool";
import { Mutex } from "async-mutex";
import { redis } from "../connect/redis";

export enum GameEvent {
    ANNOUNCE_START,
    BUST,
    ADD_PLAYER,
    PLAYER_CASHEDOUT,
    AFTER_DRAIN,
    PAUSED
}

export type Wager = {
    player: User
    wager: number   // NOT x100 like everywhere else, this is raw KST
    cashout: number // What the player cashed out at, again, x100
                    // If the user cashes out early, this is lowered
    exited: boolean // If the user cashed out early (will have updated cashout)
}

export enum InState {

}

export class GameService {
    private static _instance: GameService;
    public static get instance() {
        if (this._instance) return this._instance;
        else return this._instance = new GameService();
    }

    public GameStream: Subject<{
        type: GameEvent.ANNOUNCE_START
        start: number // Unix Epoch timestamp
        gameid: number
    } | {
        type: GameEvent.BUST
        bustedAt: number // Fixed point 100
        hash: string // Game hash
    } | {
        type: GameEvent.ADD_PLAYER
        name: string
        wager: number
    } | {
        type: GameEvent.PLAYER_CASHEDOUT
        name: string
        cashout: number // FP100
    } | {
        type: GameEvent.AFTER_DRAIN
    } | {
        type: GameEvent.PAUSED
        value: boolean
    }> = new Subject();

    public UserPlayingStream: Subject<{
        user: User
        isPlaying: "active" | "pending" | boolean
    }> = new Subject();

    public CashoutAlertStream: Subject<{
        user: User
    }> = new Subject();

    private nextGameID: number;
    public gameIsRunning: boolean = false;
    public previousGames: ExecutedGame[] = [];
    private currentExecutingGame: ExecutedGame;
    private currentGameID: number;
    private currentGameSeed: Buffer;
    private currentStartDate: number;
    private currentGameBusted: number | undefined;

    private cashoutPool = new AsyncPool();

    public gamePaused = false;
    public requestPause() {
        this.gamePaused = true;
        redis.set("bk_paused", "true");
    }

    public unpause(): boolean {
        if (this.gamePaused) {
            this.gamePaused = false;
            redis.set("bk_paused", "false");

            this.GameStream.next({
                type: GameEvent.PAUSED,
                value: false,
            });

            this.nextGame();
            return true;
        }

        return false;
    }

    // Wagers yet to be locked in for the next round
    private pendingWagers: Wager[] = [];
    private pendingWagersMutex = new Mutex();

    // Wagers locked in this round
    private activeWagers: Wager[] = [];
    private activeWagersMutex = new Mutex();

    private connectionSubscription = ConnectionStream.subscribe(() => {
        if (this.hasInitialized) {
            this.tryBootstrapService();
        }
    });
    private constructor() {
        this.restoreConfiguration().then(() => {
            fetchNextGameID().then(gid => {
                this.nextGameID = gid;
                this.hasInitialized = true;

                this.tryBootstrapService();
            });

            fetchHistory().then(history => {
                this.previousGames = this.previousGames.concat(history);
            })
        })
    }

    private hasInitialized = false;
    private async restoreConfiguration() {
        const paused = await redis.get("bk_paused");
        this.gamePaused = paused === "true";
    }

    public tryBootstrapService() {
        if (!isAnyoneHere() || this.gameIsRunning) {
            return;
        }
        
        if (!this.nextGameID) {
            return;
        }
        
        logger.debug("Bootstrapping game service");
        this.gameIsRunning = true;
        this.nextGame();
    }

    public getState() {
        return {
            gameid: this.currentGameID,
            start: this.currentStartDate,
            bust: this.currentGameBusted,
            hash: this.currentGameBusted
                ? this.currentGameSeed.toString("hex")
                : undefined,
            wagers: this.activeWagers
        }
    }

    public async isPlaying(user: User): Promise<boolean | "pending" | "active"> {
        let ret;

        await this.pendingWagersMutex.runExclusive(() => {
            const pending = !!this.pendingWagers.find(w => w.player.id === user.id);
            if (pending) ret = "pending";
        });

        if (ret) return ret;

        await this.activeWagersMutex.runExclusive(() => {
            const active =  !!this.activeWagers.find(w => w.player.id === user.id);
            if (active) ret = "active";
        });

        if (ret) return ret;

        return false;
    }

    public async canJoinGame(user: User): Promise<boolean> {
        const timeDiff = DateTime.now().minus(this.currentStartDate).toMillis();

        let ret: boolean = false;
        if (timeDiff < getConfig().game.roundPadding) {
            await this.activeWagersMutex.runExclusive(() => 
                ret = !!this.activeWagers.find(w => w.player.id === user.id)
            );

            return ret;
        } else {
            await this.pendingWagersMutex.runExclusive(() => 
                ret = !!this.pendingWagers.find(w => w.player.id === user.id)
            );

            return ret;
        }
    }

    public async putWager(player: User, bet: number, cashout: number) {
        const timeDiff = DateTime.now().minus(this.currentStartDate).toMillis();

        const wager: Wager = {
            player, wager: bet, cashout, exited: false
        };

        if (timeDiff < getConfig().game.roundPadding) {
            await this.activeWagersMutex.runExclusive(async () => {
                // Let them in to the active game
                await this.drainWager(getConnection().manager, wager);
                this.activeWagers.push(wager);

                // Add them to the round safety
                await this.resetRoundSafety();

                this.UserPlayingStream.next({
                    user: player,
                    isPlaying: "active"
                });
            });
        } else {
            await this.pendingWagersMutex.runExclusive(async () => {
                // Queue them for the next game
                this.pendingWagers.push(wager);

                this.UserPlayingStream.next({
                    user: player,
                    isPlaying: "pending"
                });
            })
        }
    }

    public async pullWager(user: User, enforceMultiplier?: number): Promise<boolean> {
        let ret;

        if (enforceMultiplier === undefined) {
            await this.pendingWagersMutex.runExclusive(() => {
                const pendingIdx = this.pendingWagers.findIndex(wager => wager.player.id === user.id);
                if (pendingIdx !== -1) {
                    this.pendingWagers.splice(pendingIdx, 1);
                    this.UserPlayingStream.next({
                        user: user,
                        isPlaying: false
                    });

                    ret = true;
                }
            })
        }

        if (ret) return ret;

        await this.activeWagersMutex.runExclusive(() => {
            const active = this.activeWagers.find(wager => wager.player.id === user.id);
            if (active) {
                if (active.exited) {
                    ret = false; // Already pulled out
                    return;
                } else {
                    const position = enforceMultiplier ?? this.getCurrentMultiplier();
                    active.cashout = Math.min(active.cashout, Math.max(position, 100));
                    active.exited = true;

                    this.GameStream.next({
                        type: GameEvent.PLAYER_CASHEDOUT,
                        name: active.player.name,
                        cashout: active.cashout
                    });

                    this.UserPlayingStream.next({
                        user: active.player,
                        isPlaying: false
                    });

                    logger.debug(chalk`User {yellow ${active.player.name}} cashed out at {magenta ${active.cashout/100}}x`);
                    ret = true;
                    return;
                }
            }

            ret = false;
        });

        if (!ret) return false;
        return ret;
    }

    public async nextGame() {
        if (this.gamePaused) {
            this.GameStream.next({
                type: GameEvent.PAUSED,
                value: true,
            });

            return;
        }

        this.currentGameID = this.nextGameID++;
        logger.info(chalk.bold`Initiating game {cyan ${this.currentGameID}}`);

        this.cashoutPool.clear();

        const gameHash = await this.fetchGameSeed();
        this.currentGameSeed = Buffer.from(gameHash.hash, "hex")
        logger.debug(chalk`Seed for game {bold ${this.currentGameID}}: {cyan ${this.currentGameSeed.toString("hex")}} `);

        // Set Game State
        const roundPadding = getConfig().game.roundPadding;
        this.currentStartDate = DateTime.now().plus(Duration.fromMillis(roundPadding * SECOND)).toMillis();
        this.currentGameBusted = undefined;
        
        const bustAt = calculateGameResult(this.currentGameSeed, getConfig().game.salt);
        const roundLengthMS = getRoundLength(bustAt);

        const bustAtTime = this.currentStartDate + roundLengthMS;
        logger.debug(chalk`Will bust at: {magenta.bold ${bustAt/100}}x on {bold ${DateTime.fromMillis(bustAtTime).toRFC2822()}}`);

        // Save the game to the DB beforehand incase of spontaneous crashes or smth idk
        const gameEntity = new ExecutedGame();
        this.currentExecutingGame = gameEntity;
        gameEntity.id = this.currentGameID;
        gameEntity.hash = gameHash;
        gameEntity.bustedAt = bustAt;
        gameEntity.totalWagered = 0;
        getConnection().manager.save(gameEntity);

        this.GameStream.next({
            type: GameEvent.ANNOUNCE_START,
            start: this.currentStartDate,
            gameid: this.currentGameID
        });

        // Bets are locked in as soon as the countdown starts (more can come in but none can back out)
        await this.drainPendingWagers();

        this.GameStream.next({
            type: GameEvent.AFTER_DRAIN
        });

        // Enact round safety
        const totalWagered = this.countTotalWagered();
        if (totalWagered > 0) {
            await this.resetRoundSafety();
        }

        // Sleep until the game has busted
        await sleepFor(bustAtTime - +new Date());

        this.cashoutPool.clear();

        // Fulfill the wagers as soon as the bust happens
        const totalProfit = await this.fulfillWagers(bustAt);
        gameEntity.totalWagered = totalWagered;
        gameEntity.totalProfit = totalProfit;
        getConnection().manager.save(gameEntity); // Finalize the executed game

        // Save it in the history
        this.previousGames.unshift(gameEntity);
        this.previousGames = this.previousGames.slice(0, getConfig().game.history);

        // Update Bust State
        this.currentGameBusted = bustAt;
        this.GameStream.next({
            type: GameEvent.BUST,
            bustedAt: bustAt,
            hash: this.currentGameSeed.toString("hex")
        });

        logger.debug(chalk`Busted!`);
        logger.info(chalk`Round ended with {cyan ${totalWagered
            }KST} wagered, and {yellow ${totalProfit/100
            }KST} profited ({magenta ${(totalWagered*100 - totalProfit)/100}KST} server profit).`);

        // Give a few seconds for the multiplier to stay on screen
        const roundDelay = getConfig().game.roundDelay;
        await sleepFor(roundDelay * SECOND);

        // Turn off the game if nobody is here to play
        if (!isAnyoneHere()) {
            this.gameIsRunning = false;
        } else {
            // Otherwise, start the next game :)
            this.nextGame();
        }
    }

    private getCurrentMultiplier(): number {
        const timeDiff = DateTime.now().minus(this.currentStartDate);
        return getScoreAt(timeDiff.toMillis());
    }

    private async resetRoundSafety() {
        const safetyCashout = await getRoundSafety(this.countTotalWagered());
        const length = getRoundLength(safetyCashout);
        const delta = DateTime.now().minus(this.currentStartDate).toMillis();
        this.cashoutPool.addTimeout(-1, async () => {
            // Double check that this safety is still the right one (players may have exited)
            const newSafetyCashout = await getRoundSafety(this.countTotalWagered(), this.countProfited());
            if (newSafetyCashout !== safetyCashout) {
                this.resetRoundSafety();
            } else {
                for (const wager of this.activeWagers) {
                    if (await this.pullWager(wager.player, safetyCashout)) {
                        this.CashoutAlertStream.next({ user: wager.player });
                    }
                }
            }
        }, length - delta);
    }

    // DAO

    private async fetchGameSeed() {
        const gameHash = await getConnection()
            .manager.findOne(GameHash, this.currentGameID);

        if (!gameHash) {
            logger.error(chalk.red.bold`FATAL: Out of hashes.`)
            throw Error("Out of hashes.");
        }

        return gameHash;
    }

    private async drainWager(manager: EntityManager, wager: Wager) {
        // In rare cases, such as after a tip, a user's balance may have decreased in between
        // the wager submit and the game start, in which we should fail to add them to the game.
        const user = await manager.findOne(User, { where: { id: wager.player.id }});
        if (user!.balance < 100*wager.wager) return this.UserPlayingStream.next({
            user: user!, isPlaying: false
        });

        this.GameStream.next({
            type: GameEvent.ADD_PLAYER,
            name: wager.player.name,
            wager: wager.wager
        });

        const safetyCashout = await getIndividualSafety(wager.wager);
        const effectiveCashout = Math.min(wager.cashout, safetyCashout);
        const length = getRoundLength(effectiveCashout);
        const delta = DateTime.now().minus(this.currentStartDate).toMillis();
        this.cashoutPool.addTimeout(wager.player.id, async () => {
            if (await this.pullWager(wager.player, effectiveCashout)) {
                if (effectiveCashout === safetyCashout) {
                    this.CashoutAlertStream.next({ user: wager.player });
                }
            }
        }, length - delta);

        this.UserPlayingStream.next({
            user: wager.player,
            isPlaying: "active"
        });

        await manager.decrement(User, { id: wager.player.id }, "balance", 100*wager.wager);
    }

    private async drainPendingWagers() {
        await this.pendingWagersMutex.runExclusive(async () => {
            await this.activeWagersMutex.runExclusive(async () => {
                const wagers = this.pendingWagers;
                this.pendingWagers = [];

                await getConnection().transaction(async manager => {
                    for (const wager of wagers) {
                        await this.drainWager(manager, wager);
                    }
                });

                // In case there was a race where someone got in before the transaction finished
                this.activeWagers = this.activeWagers.concat(wagers);
            })
        })
    }

    private scoreWager(bust: number, wager: Wager): number {
        // 10 W, 2x => 10 * 2\.00 = 20\.00
        let rawScore = 0;

        if (wager.cashout <= bust) {
            rawScore = wager.wager*wager.cashout;

            if (wager.cashout === bust && !wager.exited) {
                this.GameStream.next({
                    type: GameEvent.PLAYER_CASHEDOUT,
                    name: wager.player.name,
                    cashout: wager.cashout
                });
            }
        }

        return rawScore;
    }

    private async pushHistoricalBet(manager: EntityManager, wager: Wager, profit: number) {
        const player = await manager.findOneOrFail(User, wager.player.id, { select: ["id", "balance", "totalIn", "totalOut"] });

        const lastGame = await manager.findOne(HistoricalBet, 
            { 
                select: [ "seq" ],
                where: { user: player },
                order: { seq: "DESC" }
            });

        const entry = new HistoricalBet();
        entry.seq = (lastGame ? lastGame.seq : 0) + 1;
        entry.user = wager.player;
        entry.game = this.currentExecutingGame;
        entry.busted = this.currentExecutingGame.bustedAt;
        entry.newBalance = player.balance; // This function is called after the increment has happened
        entry.newNetBalance = player.balance - (player.totalIn - player.totalOut);
        entry.bet = wager.wager;
        if (profit > 0) {
            entry.cashout = wager.cashout;
        } else {
            entry.cashout = undefined;
        }

        manager.save(entry);
    }

    private countTotalWagered(): number {
        return this.activeWagers.reduce((acc, v) => acc + (v.exited ? 0 : v.wager), 0);
    }

    private countProfited(): number {
        return this.activeWagers.reduce((acc, v) => acc + (v.exited ? v.wager*(v.cashout - 100) : 0), 0);
    }

    private async fulfillWagers(bust: number): Promise<number> {
        let totalProfit = 0;

        await this.activeWagersMutex.runExclusive(async () => {
            const wagers = this.activeWagers;
            this.activeWagers = [];

            await getConnection().transaction(async manager => {
                for (const wager of wagers) {
                    const profit = this.scoreWager(bust, wager);
                    if (profit > 0) {
                        await manager.increment(User, { id: wager.player.id }, "balance", profit);
                    }

                    // Push this game onto the user's betting history
                    await this.pushHistoricalBet(manager, wager, profit);

                    totalProfit += profit;
                }
            });

            for (const wager of wagers) {
                if (!wager.exited) {
                    this.UserPlayingStream.next({
                        user: wager.player,
                        isPlaying: false
                    });
                }
            }
        });

        return totalProfit;
    }
}
