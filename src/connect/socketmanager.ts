import { getExpress } from "./express";
import ExpressWS from "express-ws";
import WebSocket from "ws";
import { SocketUser } from "./socketUser";
import { getConnection } from "typeorm";
import { Ban } from "../entity/Ban";
import { ErrorCode, RequestCode, UpdateCode } from "./transportCodes";
import { MINUTE, SECOND } from "../util/time";
import { logger } from "../logger";
import chalk from "chalk";
import { Request } from "express";
import { Subject } from "rxjs";

// This import registers all the request handlers
import "./requests";


const connections: SocketUser[] = [];
export const ConnectionStream = new Subject();

export function isAnyoneHere(): boolean {
    return !!connections.length;
}

export function getAllConnections() {
    return connections;
}

export function setupSocket(ws: WebSocket, req: Request) {
    const sock = new SocketUser(ws, req);
    connections.push(sock);
    ConnectionStream.next();
    
    return sock;
}

export function pruneSockets() {
    let pruned = 0;
    for (let i = connections.length - 1; i >= 0; i--) {
        if (!connections[i] || !connections[i].isActive) {
            const removing = connections[i];
            const replaceWith = connections.pop();
            if (replaceWith !== removing) {
                connections[i] = replaceWith!;
            }
            
            pruned += 1;
        }
    }
    
    logger.info(chalk`Pruned {cyan ${pruned}} ws connections, {cyan ${connections.length}} remain.`)
}

setInterval(pruneSockets, 10*MINUTE);

export function safeSend(ws: WebSocket, data: {
    ok: boolean
    id?: number
    type?: UpdateCode
    errorType?: ErrorCode
    [k: string]: unknown
}) {
    if (ws.readyState === 1	) {
        ws.send(JSON.stringify(data));
    } else {
        pruneSockets();
    }
}

export function initSockets() {

    const app = getExpress();

    app.ws("/api/sock", async (ws, req) => {
        const sock = setupSocket(ws, req);
        
        safeSend(ws, {
            ok: true,
            type: UpdateCode.HELLO
        });

        sock.initialize();

        if (await getConnection().manager.findOne(Ban, undefined, {where: {ip: req.ip}})) {
            safeSend(ws, {
                ok: false,
                type: UpdateCode.HELLO,
                errorType: ErrorCode.BANNED,
                error: "Your IP has been banned"
            });

            ws.close();
        }
    });

}
