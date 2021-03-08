import { getConnection } from "typeorm";
import Schema from "validate";
import { User } from "../../entity/User";
import { KristService } from "../../services/KristService";
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
            await KristService.instance.makeWithdrawal(this.authedUser.name, data.to!, Math.floor(data.amount!));
            await getConnection().manager.decrement(User, { id: this.authedUser!.id }, "balance", amount);        

            await this.refresh();
            return req.replySuccess({
                newBal: this.authedUser.balance
            });
        } catch {
            return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.NOT_EXISTS);
        }
    }
}
