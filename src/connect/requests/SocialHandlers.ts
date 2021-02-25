import Schema from "validate";
import { logger } from "../../logger";
import { ChatService } from "../../services/ChatService";
import { RequestHandler, RequestMessage, SocketUser } from "../socketUser";
import { RequestCode, ErrorCode, ErrorDetail } from "../transportCodes";

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
        logger.debug(req.data);
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
}