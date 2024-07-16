import chalk from "chalk";
import { getConnection } from "typeorm";
import Schema from "validate";
import { User } from "../../entity/User";
import { logger } from "../../logger";
import { BalStream, KristService } from "../../services/KristService";
import { kst } from "../../util/chalkFormatters";
import { queueTransaction } from "../../util/TransactionQueue";
import { RequestHandler, RequestMessage, SocketUser } from "../socketUser";
import { ErrorCode, ErrorDetail, RequestCode } from "../transportCodes";
import { deadline } from "../../util/prom";
import { SECOND } from "../../util/time";
import { v4 as uuid } from "uuid";

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
        if (errors.length) return req.replyFail(ErrorCode.MALFORMED, errors.map(e => e.path).join(" "));

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

        logger.info(`${this.authedUser.name} withdrawing ${kst(Math.floor(amount/100))} to ${data.to}`);

        try {
            const name = this.authedUser.name;
            const reqId = uuid();
            await queueTransaction(() => getConnection().manager.transaction(async manager => {
                await manager.decrement(User, { id: this.authedUser!.id }, "balance", amount);
                await manager.increment(User, { id: this.authedUser!.id }, "totalOut", amount);
                const tx = await deadline(KristService.instance.makeWithdrawal(name, data.to!, Math.floor(data.amount!), reqId), 5 * SECOND);
                if (!tx) {
                    throw new Error("Transaction failed");
                }
            }));

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
