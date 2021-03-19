import { Connection, getConnection } from "typeorm";
import { ExecutedGame } from "../entity/ExecutedGame";
import { GameHash } from "../entity/GameHash";
import * as fs from "fs";
import readline from "readline";
import cliProgress from "cli-progress";
import { getConfig } from "../config";
import { calculateGameResult } from "../services/ScoreService";

const batchSize = 400;
export async function initializeChain(name: string, connection: Connection) {
    const fileStream = fs.createReadStream(name);

    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
  
    // const hashes = fs.readFileSync(name).toString().split("\n").reverse();

    await getConnection().transaction(async transactionalEntityManager => {
        let i = 0;
        let batch: string[] = [];
        const exec = () => transactionalEntityManager
            .createQueryBuilder()
            .insert()
            .into(GameHash)
            .values(batch.map((hash, idx) => ({
                id: i + idx - batchSize,
                hash: hash
            })))
            .execute();
    
        const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        bar1.start(20000000/batchSize, 0);
    
        for await (const line of rl) {
            batch.push(line);
            i += 1;
    
            if (batch.length === batchSize) {
                await exec();
                
                batch = [];
    
                bar1.update(i/batchSize);
            }
        }
    
        bar1.stop();
        
        if (batch.length > 0) {
            await exec();
        }    
    });    

    // Initialize the genesis game
    const genesis = new ExecutedGame();
    genesis.id = 0;
    genesis.hash = await connection.manager.findOne(GameHash, 0) as GameHash;
    genesis.bustedAt = 0;
    genesis.totalProfit = 0;
    genesis.totalWagered = 0;

    connection.manager.save(genesis);
}

export async function calcStats() {
    const hashes = await getConnection().manager.find(GameHash, { take: 50000 });
    console.log(hashes.length);
    const bufs = hashes.map(h => Buffer.from(h.hash, "hex"));
    const busts = bufs.map(b => calculateGameResult(b, "00000000000000000004bac129769598d1fad2b42859e625729661a32b9c3e71"))
    const good = busts.map(b => b >= 200);

    let run = 0;
    for (let i = 2200; i < good.length; i++) {
        if (!good[i]) run += 1;
        else run = 0;

        if (run == 10) {
            console.log("Run of 10 ending at ", i);
            break;
        }
    }
    
    console.log(good.length);
}

export async function fetchNextGameID(): Promise<number> {
    // SELECT 1+MAX(_ROWID_) from executed_game;
    const rows = await getConnection().manager
        .createQueryBuilder()
        .select("1+MAX(_ROWID_)", "cnt")
        .from(ExecutedGame, "eg")
        .execute();

    return rows[0].cnt;
}

export function fetchHistory(): Promise<ExecutedGame[]> {
    return getConnection().manager.find(ExecutedGame, {
        relations: [ "hash" ],
        take: getConfig().game.history,
        order: {
            id: "DESC",
        }
    });
}
