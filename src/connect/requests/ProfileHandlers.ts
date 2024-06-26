import { getConnection } from "typeorm";
import Schema from "validate";
import { getConfig } from "../../config";
import { HistoricalBet } from "../../entity/HistoricalBet";
import { User } from "../../entity/User";
import { GameService } from "../../services/GameService";
import { RequestHandler, RequestMessage, SocketUser } from "../socketUser";
import { ErrorCode, ErrorDetail, RequestCode } from "../transportCodes";
import { logger } from "../../logger";

export class ProfileHandlers extends SocketUser {
    @RequestHandler(RequestCode.PROFILE)
    public async handleGetProfile(req: RequestMessage<{
        user: string
    }>) {
        if (!req.data?.user) return req.replyFail(ErrorCode.MALFORMED, "missing user");

        const manager = getConnection().manager;

        const user = await manager.findOne(User, { where: { name: req.data.user } });
        if (!user) return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.NOT_EXISTS);

        logger.info(`Request for ${user.name}'s profile`);

        const gamesPlayed = await manager.count(HistoricalBet, { where: { user } });

        const alltimeMinMax = await manager.createQueryBuilder(HistoricalBet, "bets")
            .select(["MIN(newNetBalance) as minb", "MAX(newNetBalance) as maxb"])
            .where({ user }).execute();

        const totalWagered = (await manager.createQueryBuilder(HistoricalBet, "bets")
            .select("SUM(bet)", "wagered").where({ user }).execute())[0].wagered;

        // Account for if they're currently in a game
        const currentWager = GameService.instance.getState().wagers.find(x => x.player.name === user.name);
        const currentOffset = currentWager ? currentWager.wager : 0;

        return req.replySuccess({
            joined: +user.joined,
            balance: user.balance + currentOffset*100,
            netBase: user.totalIn - user.totalOut,
            allTimeNetLow: alltimeMinMax[0].minb,
            allTimeNetHigh: alltimeMinMax[0].maxb,
            gamesPlayed, totalWagered,
        })
    }

    private static ProfileBetsSchema = new Schema({
        user: {
            type: String,
            required: true,
        },
        page: {
            type: Number,
            size: { min: 0 },
        }
    })

    @RequestHandler(RequestCode.PROFILE_BETS)
    public async handleGetProfileBets(req: RequestMessage<{
        user: string
        page: number
    }>) {
        const errors = ProfileHandlers.ProfileBetsSchema.validate(req.data ?? {});
        if (errors.length) return req.replyFail(ErrorCode.MALFORMED, errors.map(e => e.path).join(" "));
        
        const data = req.data!;

        const manager = getConnection().manager;
        
        const page = data.page ?? 0;
        const user = await manager.findOne(User, { where: { name: data.user } });
        if (!user) return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.NOT_EXISTS);

        logger.info(`Request for ${user.name}'s profile bets (page ${page})`);

        const pageSize = getConfig().profile.pageSize;
        const [entities, count] = await manager.findAndCount(HistoricalBet, {
            relations: [ "game" ],
            where: { user },
            order: {
                id: "DESC"
            },
            skip: page * pageSize,
            take: pageSize
        });

        const rest = count - pageSize*page - entities.length;
        return req.replySuccess({
            entities: entities.map(e => ({
                ...e,
                id: e.seq,
                game: e.game.id,
                timestamp: +e.timestamp,
            })), more: rest > 0
        });
    }
}