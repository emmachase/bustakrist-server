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
import { calculateGameResult, getRoundLength, getScoreAt } from "./ScoreService";
import { DateTime, Duration } from "luxon";
import { HistoricalBet } from "../entity/HistoricalBet";
import { AsyncPool } from "../util/AsyncPool";

export enum GameEvent {
    ANNOUNCE_START,
    BUST,
    ADD_PLAYER,
    PLAYER_CASHEDOUT
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
    }> = new Subject();

    public UserPlayingStream: Subject<{
        user: User
        isPlaying: "active" | "pending" | boolean
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

    // Wagers yet to be locked in for the next round
    private pendingWagers: Wager[] = [];

    // Wagers locked in this round
    private activeWagers: Wager[] = [];

    private connectionSubscription = ConnectionStream.subscribe(this.tryBootstrapService.bind(this));
    private constructor() {
        fetchNextGameID().then(gid => {
            this.nextGameID = gid;
            this.tryBootstrapService();
        });

        fetchHistory().then(history => {
            this.previousGames = this.previousGames.concat(history);
        })
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

    public isPlaying(user: User): boolean | "pending" | "active" {
        const pending = !!this.pendingWagers.find(w => w.player.id === user.id);
        if (pending) return "pending";

        const active =  !!this.activeWagers.find(w => w.player.id === user.id);
        if (active) return "active";

        return false;
        /*
        return      this.pendingWagers
            .concat(this.activeWagers)
            .find(w => w.player.id === user.id) !== undefined;
        */
    }

    public canJoinGame(user: User): boolean {
        const timeDiff = DateTime.now().minus(this.currentStartDate).toMillis();

        if (timeDiff < getConfig().game.roundPadding) {
            return !!this.activeWagers.find(w => w.player.id === user.id);
        } else {
            return !!this.pendingWagers.find(w => w.player.id === user.id);
        }
    }

    public async putWager(player: User, bet: number, cashout: number) {
        const timeDiff = DateTime.now().minus(this.currentStartDate).toMillis();

        const wager: Wager = {
            player, wager: bet, cashout, exited: false
        };

        if (timeDiff < getConfig().game.roundPadding) {
            // Let them in to the active game
            await this.drainWager(getConnection().manager, wager);
            this.activeWagers.push(wager);

            this.UserPlayingStream.next({
                user: player,
                isPlaying: "active"
            });
        } else {
            // Queue them for the next game
            this.pendingWagers.push(wager);

            this.UserPlayingStream.next({
                user: player,
                isPlaying: "pending"
            });
        }
    }

    public pullWager(user: User): boolean {
        const pendingIdx = this.pendingWagers.findIndex(wager => wager.player.id === user.id);
        if (pendingIdx !== -1) {
            this.pendingWagers.splice(pendingIdx, 1);
            this.UserPlayingStream.next({
                user: user,
                isPlaying: false
            });

            return true;
        }

        const active = this.activeWagers.find(wager => wager.player.id === user.id);
        if (active) {
            if (active.exited) {
                return false; // Already pulled out
            } else {
                const position = this.getCurrentMultiplier();
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
                return true;
            }
        }

        return false;
    }

    public async nextGame() {
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
        gameEntity.totalWagered = 0; // TODO
        getConnection().manager.save(gameEntity);

        this.GameStream.next({
            type: GameEvent.ANNOUNCE_START,
            start: this.currentStartDate,
            gameid: this.currentGameID
        });

        // Bets are locked in as soon as the countdown starts (more can come in but none can back out)
        await this.drainPendingWagers();

        // Sleep until the game has busted
        await sleepFor(bustAtTime - +new Date());

        this.cashoutPool.clear();

        // Fulfill the wagers as soon as the bust happens
        const [totalWagered, totalProfit] = await this.fulfillWagers(bustAt);
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
        this.GameStream.next({
            type: GameEvent.ADD_PLAYER,
            name: wager.player.name,
            wager: wager.wager
        });

        const safetyCashout = wager.cashout;
        const length = getRoundLength(safetyCashout);
        const delta = DateTime.now().minus(this.currentStartDate).toMillis();
        this.cashoutPool.addTimeout(wager.player.id, () => {
            this.pullWager(wager.player);
        }, length - delta);

        this.UserPlayingStream.next({
            user: wager.player,
            isPlaying: "active"
        });

        await manager.decrement(User, { id: wager.player.id }, "balance", 100*wager.wager);
    }

    private async drainPendingWagers() {
        const wagers = this.pendingWagers;
        this.pendingWagers = [];

        await getConnection().transaction(async manager => {
            for (const wager of wagers) {
                await this.drainWager(manager, wager);
            }
        });

        // In case there was a race where someone got in before the transaction finished
        this.activeWagers = this.activeWagers.concat(wagers);
    }

    private scoreWager(bust: number, wager: Wager): number {
        // 10 W, 2x => 10 * 2\.00 = 20\.00
        let rawScore = 0;

        if (wager.cashout <= bust) {
            rawScore = wager.wager*wager.cashout;
        }

        return rawScore;
    }

    private async pushHistoricalBet(manager: EntityManager, wager: Wager, profit: number) {
        const player = await manager.findOneOrFail(User, wager.player.id, { select: ["balance"] });

        const entry = new HistoricalBet();
        entry.user = wager.player;
        entry.game = this.currentExecutingGame;
        entry.busted = this.currentExecutingGame.bustedAt;
        entry.newBalance = player.balance; // This function is called after the increment has happened
        entry.bet = wager.wager;
        if (profit > 0) {
            entry.cashout = wager.cashout;
        } else {
            entry.cashout = undefined;
        }

        manager.save(entry);
    }

    private async fulfillWagers(bust: number): Promise<[number, number]> {
        const wagers = this.activeWagers;
        this.activeWagers = [];

        let totalWagered = 0;
        let totalProfit = 0;

        await getConnection().transaction(async manager => {
            for (const wager of wagers) {
                const profit = this.scoreWager(bust, wager);
                if (profit > 0) {
                    await manager.increment(User, { id: wager.player.id }, "balance", profit);
                }

                // Push this game onto the user's betting history
                await this.pushHistoricalBet(manager, wager, profit);

                totalWagered += wager.wager;
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

        return [totalWagered, totalProfit];
    }
}
