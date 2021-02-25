import chalk from "chalk";
import { logger } from "../../logger";
import { MINUTE } from "../../util/time";
import { RequestHandler, RequestMessage, SocketUser } from "../socketUser";
import { RequestCode } from "../transportCodes";

export class MiscHandlers extends SocketUser {
    @RequestHandler(RequestCode.PING)
    public handlePing(req: RequestMessage<{
        delay: number
    }>) {
        logger.debug(chalk`Ping from {yellow ${this.ip}}`);

        const delay = req.data?.delay ?? 0;
        const trigger = () => req.replySuccess({ now: +new Date() });
        if (delay > 0) {
            setTimeout(trigger, Math.min(MINUTE, delay));
        } else {
            trigger();
        }
    }
}