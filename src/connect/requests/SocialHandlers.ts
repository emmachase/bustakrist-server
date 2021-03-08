import { getConnection } from "typeorm";
import Schema from "validate";
import { User } from "../../entity/User";
import { logger } from "../../logger";
import { ChatService } from "../../services/ChatService";
import { TipStream } from "../../services/KristService";
import { safeSend } from "../socketmanager";
import { RequestHandler, RequestMessage, SocketUser } from "../socketUser";
import { RequestCode, ErrorCode, ErrorDetail, UpdateCode } from "../transportCodes";

export class SocialHandlers extends SocketUser {
    private static MessageSchema = new Schema({
        msg: {
            type: String,
            required: true,
            length: { min: 1, max: 200 }
        },
        to: {
            type: String,
            required: false,
        }
    })

    @RequestHandler(RequestCode.SENDMSG)
    public async handleSendMsg(req: RequestMessage<{
        msg: string
        to: string
    }>) {
        const errors = SocialHandlers.MessageSchema.validate(req.data ?? {});
        if (errors.length) return req.replyFail(ErrorCode.MALFORMED, errors.map(e => e.message).join(" "));

        if (!this.authedUser) {
            return req.replyFail(ErrorCode.UNAUTHORIZED, ErrorDetail.NOT_LOGGED_IN);
        }

        const data = req.data!;

        ChatService.instance.sendMessage({
            from: this.authedUser.name, 
            message: data.msg!,
            to: data.to
        });
    }

    private static FriendSchema = new Schema({
        name: {
            type: String,
            required: true,
        },
        action: {
            type: Boolean,
            required: true,
        },
    })

    @RequestHandler(RequestCode.UPDATE_FRIEND)
    public async handleFriendship(req: RequestMessage<{
        name: string,
        action: boolean
    }>) {
        const errors = SocialHandlers.FriendSchema.validate(req.data ?? {});
        if (errors.length) return req.replyFail(ErrorCode.MALFORMED, errors.map(e => e.message).join(" "));

        if (!this.authedUser) {
            return req.replyFail(ErrorCode.UNAUTHORIZED, ErrorDetail.NOT_LOGGED_IN);
        }

        const data = req.data!;

        const user = await getConnection().manager.findOne(User, { 
            where: { id: this.authedUser.id },
            relations: ["friends"]
        }) as User;

        const friendIdx = user.friends.findIndex(u => u.name === data.name);
        if (data.action && friendIdx === -1) {
            const friend = await getConnection().manager.findOne(User, { where: { name: data.name } });
            if (friend === undefined) {
                return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.NOT_EXISTS)
            }

            user.friends.push(friend);
        } else if (!data.action && friendIdx !== -1) {
            user.friends.splice(friendIdx, 1);
        } else {
            req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.NOOP);
        }

        await getConnection().manager.save(user);

        return req.replySuccess();
    }

    private static TipSchema = new Schema({
        amount: {
            type: Number,
            required: true,
            size: { min: 0 },
        },
        to: {
            type: String,
            required: true,
        }
    })

    @RequestHandler(RequestCode.TIP)
    public async handleTip(req: RequestMessage<{
        amount: number
        to: string
    }>) {
        const errors = SocialHandlers.TipSchema.validate(req.data ?? {});
        if (errors.length) return req.replyFail(ErrorCode.MALFORMED, errors.map(e => e.message).join(" "));

        if (!this.authedUser) {
            return req.replyFail(ErrorCode.UNAUTHORIZED, ErrorDetail.NOT_LOGGED_IN);
        }

        const data = req.data!;

        await this.refresh();
        if (data.amount! > this.authedUser.balance) {
            return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.LOW_BALANCE);
        }

        const targetUser = await getConnection().manager.findOne(User, { where: { name: data.to } });
        if (!targetUser) {
            return req.replyFail(ErrorCode.UNFULFILLABLE, ErrorDetail.NOT_EXISTS);
        }

        await getConnection().transaction(async manager => {
            await manager.decrement(User, { id: this.authedUser!.id }, "balance", data.amount!);
            await manager.increment(User, { id: targetUser.id }, "balance", data.amount!);

            await manager.increment(User, { id: this.authedUser!.id }, "totalOut", data.amount!);
            await manager.increment(User, { id: targetUser.id }, "totalIn", data.amount!);
        });

        await this.refresh();
        safeSend(this.ws, {
            ok: true,
            type: UpdateCode.UPDATE_BALANCE,
            data: { newBal: this.authedUser!.balance }
        })

        TipStream.next({
            from: this.authedUser.name,
            to: targetUser.name,
            amount: data.amount!
        })

        return req.replySuccess();
    }
}