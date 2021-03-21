import chalk from "chalk";
import { getConnection } from "typeorm";
import Schema from "validate";
import { User } from "../../entity/User";
import { logger } from "../../logger";
import { BalStream, KristService } from "../../services/KristService";
import { kst } from "../../util/chalkFormatters";
import { RequestHandler, RequestMessage, SocketUser } from "../socketUser";
import { ErrorCode, ErrorDetail, RequestCode } from "../transportCodes";

export class KristHandlers extends SocketUser {
    private static WithdrawSchema = new Schema({
        amount: {
            type: Number,
            required: true,
            size: { min: 1 }
        },
        to: {
            type: String,
            required: true
        }
    })

    @RequestHandler(RequestCode.WITHDRAW)
    public async handleWidthraw(req: RequestMessage<{
        amount: number
        to: string
    }>) {
        const errors = KristHandlers.WithdrawSchema.validate(req.data ?? {});
        if (errors.length) return req.replyFail(ErrorCode.MALFORMED, errors.map(e => e.message).join(" "));

        if (!this.authedUser) {
            return req.replyFail(ErrorCode.UNAUTHORIZED, ErrorDetail.NOT_LOGGED_IN);
        }

        const data = req.data!;

        // Make sure we compare to the most up-to date balance
        await this.refresh();

        const amount = Math.floor(100*data.amount!);
        if (amount > this.authedUser.balance) {
            return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.LOW_BALANCE);
        }


        try {
            const name = this.authedUser.name;
            await getConnection().manager.transaction(async manager => {
                await manager.decrement(User, { id: this.authedUser!.id }, "balance", amount);
                await manager.increment(User, { id: this.authedUser!.id }, "totalOut", amount);
                await KristService.instance.makeWithdrawal(name, data.to!, Math.floor(data.amount!));
            });

            logger.info(chalk`User {cyan ${this.authedUser.name}} withdrew ${kst(Math.floor(amount/100))}`);

            await this.refresh();
            return req.replySuccess({
                newBal: this.authedUser.balance
            });
        } catch {
            return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.NOT_EXISTS);
        }
    }
}
