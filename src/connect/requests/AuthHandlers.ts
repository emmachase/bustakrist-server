import chalk from "chalk";
import { getConnection } from "typeorm";
import Schema from "validate";
import { User } from "../../entity/User";
import { logger } from "../../logger";
import { crypto64 } from "../../util/crypto";
import { RequestHandler, RequestMessage, SocketUser, TranscludeMethod } from "../socketUser";
import { RequestCode, ErrorCode, ErrorDetail, UpdateCode } from "../transportCodes";
import argon2 from "argon2";
import { ChatService } from "../../services/ChatService";
import { safeSend } from "../socketmanager";
import { GameService } from "../../services/GameService";
import { Ban } from "../../entity/Ban";

const normalName = (val: string) => /^[0-9a-zA-Z_\-$]+$/.test(val)

export class AuthHandlers extends SocketUser {
    private static AuthSchema = new Schema({
        name: {
            type: String,
            required: true,
            length: { min: 3, max: 32 },
            use: { normalName }
        },
        pass: {
            type: String,
            required: true,
            length: { min: 8, max: 320 }
        }
    })

    @RequestHandler(RequestCode.REGISTER)
    public async handleRegister(req: RequestMessage<{
        name: string
        pass: string
    }>) {
        const errors = AuthHandlers.AuthSchema.validate(req.data ?? {});
        if (errors.length) return req.replyFail(ErrorCode.MALFORMED, errors.map(e => e.message).join(" "));

        const data = req.data!;

        const existingUser = await getConnection().manager.createQueryBuilder(User, "user")
            .where("LOWER(user.name) = LOWER(:name)", { name: data.name })
            .getOne();

        try {
            if (existingUser) throw new Error();

            const newUser = new User();
            newUser.name = data.name!;
            newUser.passwordHash = await argon2.hash(data.pass!);
            
            await getConnection().manager.save(newUser);
        } catch (e) {
            logger.info(chalk`Register attempt from {yellow ${this.ip}} as {cyan ${data.name}} ({red.bold FAILURE})`);
            return req.replyFail(ErrorCode.INVALID_DATA, ErrorDetail.USERNAME_TAKEN);
        }

        logger.info(chalk`Register attempt from {yellow ${this.ip}} as {cyan ${data.name}} ({green.bold SUCCESS})`);
        this.authedUser = (await getConnection().manager.findOne(User, {
            where: { name: data.name },
            relations: [ "friends" ]
        }))!;

        this.authedUser.loginToken = crypto64(64);

        // Not necessary to await, this doesn't affect the login flow
        getConnection().manager.save(this.authedUser);
        this.notifyJoin();

        await this.sendAuthedGameState();

        return req.replySuccess({
            user: this.authedUser.name,
            bal: this.authedUser.balance,
            token: this.authedUser.loginToken,
            friends: this.authedUser.friends.map(x => x.name),
        });
    }

    @RequestHandler(RequestCode.LOGIN)
    public async handleLogin(req: RequestMessage<{
        name: string
        pass: string
    }>) {
        const errors = AuthHandlers.AuthSchema.validate(req.data ?? {});
        if (errors.length) return req.replyFail(ErrorCode.MALFORMED, errors.map(e => e.message).join(" "));

        const data = req.data!;
        const trueUser = await getConnection().manager.findOne(User, {
            where: { name: data.name }
        });

        if (!trueUser || !await argon2.verify(trueUser.passwordHash, data.pass!)) {
            logger.info(chalk`Login attempt from {yellow ${this.ip}} as {cyan ${data.name}} ({red.bold FAILURE})`);
            return req.replyFail(ErrorCode.UNAUTHORIZED, ErrorDetail.INVALID_CREDENTIALS);
        }

        const fullUser = await getConnection().manager.findOne(User, {
            where: { name: data.name },
            relations: [ "friends" ]
        });

        if (!fullUser || fullUser.banned) {
            return req.replyFail(ErrorCode.BANNED);
        }

        if (await getConnection().manager.findOne(Ban, undefined, {where: {ip: this.origReq.ip}})) {
            safeSend(this.ws, {
                ok: false,
                type: UpdateCode.HELLO,
                errorType: ErrorCode.BANNED,
                error: "Your IP has been banned"
            });

            this.ws.close();
        }

        logger.info(chalk`Login attempt from {yellow ${this.ip}} as {cyan ${data.name}} ({green.bold SUCCESS})`);
        this.authedUser = fullUser!;

        this.authedUser.loginToken = crypto64(64);

        // Not necessary to await, this doesn't affect the login flow
        getConnection().manager.save(this.authedUser);
        this.notifyJoin();

        await this.sendAuthedGameState();

        return req.replySuccess({
            user: this.authedUser.name,
            bal: this.authedUser.balance,
            token: this.authedUser.loginToken,
            friends: this.authedUser.friends.map(x => x.name),
        });
    }

    @RequestHandler(RequestCode.REAUTH)
    public async handleReauth(req: RequestMessage<{
        t: string
    }>) {
        if (!req.data || typeof req.data.t !== "string") {
            return this.sendMalformed(ErrorDetail.INVALID_JSON);
        }

        const data = req.data!;
        const trueUser = await getConnection().manager.findOne(User, {
            where: { loginToken: data.t }
        });

        if (!trueUser || trueUser.loginToken !== data.t) {
            logger.info(chalk`Reauth attempt from {yellow ${this.ip}} as {cyan ${trueUser?.name ?? "unknown"}} ({red.bold FAILURE})`);
            return req.replyFail(ErrorCode.UNAUTHORIZED, ErrorDetail.INVALID_CREDENTIALS);
        }

        if (!trueUser || trueUser.banned) {
            return req.replyFail(ErrorCode.BANNED);
        }

        if (await getConnection().manager.findOne(Ban, undefined, {where: {ip: this.origReq.ip}})) {
            safeSend(this.ws, {
                ok: false,
                type: UpdateCode.HELLO,
                errorType: ErrorCode.BANNED,
                error: "Your IP has been banned"
            });

            this.ws.close();
        }

        logger.info(chalk`Reauth attempt from {yellow ${this.ip}} as {cyan ${trueUser.name}} ({green.bold SUCCESS})`);
        this.authedUser = (await getConnection().manager.findOne(User, {
            where: { name: trueUser.name },
            relations: [ "friends" ]
        }))!;

        this.notifyJoin();

        await this.sendAuthedGameState();

        return req.replySuccess({
            user: this.authedUser.name,
            bal: this.authedUser.balance,
            token: this.authedUser.loginToken,
            friends: this.authedUser.friends.map(x => x.name),
        });
    }

    @RequestHandler(RequestCode.LOGOUT)
    public async handleLogout(req: RequestMessage) {
        if (!this.authedUser) {
            return req.replyFail(ErrorCode.UNAUTHORIZED, ErrorDetail.NOT_LOGGED_IN);
        }

        logger.info(chalk`User {cyan ${this.authedUser.name}} logged out.`)

        this.authedUser.loginToken = undefined;
        getConnection().manager.save(this.authedUser);

        this.notifyLeave();
        this.authedUser = undefined;

        return req.replySuccess();
    }

}