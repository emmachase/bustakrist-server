import Express from "express";
import ExpressWS from "express-ws";

let application: Express.Application & ExpressWS.Application;

export function initExpress(): typeof application {
    application = Express() as unknown as Express.Application & ExpressWS.Application;
    ExpressWS(application); // Setup WS

    application.set("trust proxy", "loopback");
    
    return application;
}

export function getExpress(): typeof application {
    if (!application) {
        throw Error("Attempted to access express application before initialization was complete.");
    }

    return application;
}