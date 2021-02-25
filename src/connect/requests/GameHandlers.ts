import Schema from "validate";
import { GameService } from "../../services/GameService";
import { SocketUser, RequestHandler, RequestMessage } from "../socketUser";
import { RequestCode, ErrorCode, ErrorDetail } from "../transportCodes";

export class GameHandlers extends SocketUser {
    @RequestHandler(RequestCode.GETBAL)
    public async handleGetBal(req: RequestMessage) {
        if (!this.authedUser) {
            return req.replyFail(ErrorCode.UNAUTHORIZED, ErrorDetail.NOT_LOGGED_IN);
        }

        await this.refresh();

        return req.replySuccess({
            user: this.authedUser.name,
            bal: this.authedUser.balance
        });
    }

    private static CommitSchema = new Schema({
        bet: {
            type: Number,
            required: true,
            size: { min: 1 }
        },
        cashout: {
            type: Number,
            required: true,
            size: { min: 101 }
        }
    })

    @RequestHandler(RequestCode.COMMIT_WAGER)
    public async commitWager(req: RequestMessage<{
        bet: number,
        cashout: number,
    }>) {
        const errors = GameHandlers.CommitSchema.validate(req.data ?? {});
        if (errors.length) return req.replyFail(ErrorCode.MALFORMED, errors.map(e => e.message).join(" "));

        if (!this.authedUser) {
            return req.replyFail(ErrorCode.UNAUTHORIZED, ErrorDetail.NOT_LOGGED_IN);
        }

        const data = req.data!;
        data.bet = Math.floor(data.bet!);
        data.cashout = Math.floor(data.cashout!);

        // Make sure balance is up to-date
        await this.refresh();

        if (this.authedUser.balance < 100*data.bet) {
            return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.LOW_BALANCE);
        }

        if (GameService.instance.canJoinGame(this.authedUser)) {
            return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.ALREADY_PLAYING);
        }

        await GameService.instance.putWager(this.authedUser, data.bet, data.cashout);
        await this.refresh();
        req.replySuccess({
            newBal: this.authedUser.balance
        });
    }

    @RequestHandler(RequestCode.PULLOUT_WAGER)
    public async pullWager(req: RequestMessage) {
        if (!this.authedUser) {
            return req.replyFail(ErrorCode.UNAUTHORIZED, ErrorDetail.NOT_LOGGED_IN);
        }

        if (!GameService.instance.isPlaying(this.authedUser)) {
            return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.NOT_PLAYING);
        }

        const success = GameService.instance.pullWager(this.authedUser);
        if (!success) {
            return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.NOT_PLAYING);
        }

        return req.replySuccess();
    }
}
