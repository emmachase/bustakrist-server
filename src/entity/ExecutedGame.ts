import {Entity, Column, PrimaryColumn, OneToOne, JoinColumn} from "typeorm";
import { GameHash } from "./GameHash";

@Entity()
export class ExecutedGame {

    @PrimaryColumn()
    id: number;

    @OneToOne(_type => GameHash)
    @JoinColumn()
    hash: GameHash;

    @Column("integer")
    bustedAt: number;

    @Column("integer")
    totalWagered: number;
    
    @Column({type: "integer", default: 0})
    totalProfit: number;

    @Column({type: "datetime", default: () => "DATETIME('now')"})
    timestamp: Date;

}
