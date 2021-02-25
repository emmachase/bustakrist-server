import "reflect-metadata";
import chalk from "chalk";
import {Connection, createConnection, getConnection} from "typeorm";
import {GameHash} from "./entity/GameHash";
import * as fs from "fs";
import { ExecutedGame } from "./entity/ExecutedGame";
import { getExpress, initExpress } from "./connect/express";
import { initSockets } from "./connect/socketmanager";
import { initConfig } from "./config";
import { logger } from "./logger";
import { User } from "./entity/User";
import { GameService } from "./services/GameService";
import { calcStats, initializeChain } from "./util/database";

logger.debug("App initializing...");

const config = initConfig();

createConnection().then(async connection => {

    // await initializeChain("devchain.txt", connection);
    // console.log(await connection.manager.count(GameHash));

    // await calcStats();

    // if (true) process.exit(0);

    // console.log(await fetchNextGameID());

    // const emma = new User();
    // emma.name = "ema";
    // emma.passwordHash="";
    // emma.balance = 0;
    
    // const threedeesix = new User();
    // threedeesix.name = "3d6";
    // threedeesix.passwordHash="";
    // threedeesix.balance = 0;

    // connection.manager.save(emma);
    // connection.manager.save(threedeesix);

    // const emma = (await connection.manager.findOne(User, undefined, {relations: ["friends"], where: {name: "ema"}}))!;
    // // const threedeesix = (await connection.manager.findOne(User, undefined, {relations: ["friends"], where: {name: "3d6"}}))!;

    // emma.balance += 10000;
    // await connection.manager.save(emma);

    // console.log(emma);
    // console.log(threedeesix);

    // emma.friends = [threedeesix];
    // threedeesix.friends = [emma];

    // connection.manager.save(emma);
    // connection.manager.save(threedeesix);


    initExpress();
    initSockets();

    GameService.instance.tryBootstrapService();

    getExpress().listen(
        config.system.listenPort,
        () => {
            logger.info(chalk`{bold ${config.system.name}} started on port {cyan ${config.system.listenPort}}`)
        }
    );

    // console.log("Inserting a new user into the database...");
    // const user = new GameHash();
    // user.id = 1;
    // user.hash = "12345"
    // // user.firstName = "Timber";
    // // user.lastName = "Saw";
    // // user.age = 25;
    // await connection.manager.save(user);
    // await connection.manager.clear(GameHash);
    // console.log("Saved a new user with id: " + user.id);

    // console.log("Loading users from the database...");
    // const users = await connection.manager.find(GameHash);
    // console.log("Loaded users: ", users);

    // console.log("Here you can setup and run express/koa/any other framework.");

}).catch(error => console.log(error));
