import * as fs from "fs";
import toml from "toml";

export interface AppConfig {
    system: {
        name: string
        listenPort: number
    }

    game: {
        salt: string
        roundDelay: number   // Number of seconds before starting the next round.
                             // (ie when the next startdate is broadcasted, so how long the score is shown on screen)
        roundPadding: number // Number of seconds after the date is broadcasted when the game actually starts (i.e. round starting in X...)
        history: number      // Number of rounds to pre-send history for
    }

    chat: {
        history: number
    }

    profile: {
        pageSize: number // How many bets per page for the bet graph
    }
}

let configInst: AppConfig;

export function initConfig(): AppConfig {
    const tomlStr = fs.readFileSync(
        process.env.KBIT_CONFIG ?? "./config.toml"
    ).toString("ascii");

    return configInst = toml.parse(tomlStr);
}

export function getConfig(): AppConfig {
    if (!configInst) {
        throw Error("Attempted to access application config before initialization was complete.");
    }

    return configInst;
}
