import {Entity, Column, PrimaryGeneratedColumn, ManyToOne, OneToOne, JoinColumn, OneToMany} from "typeorm";
import { ExecutedGame } from "./ExecutedGame";
import { User } from "./User";

@Entity()
export class HistoricalBet {

    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(_type => User, u => u.history)
    user: User;

    @ManyToOne(_type => ExecutedGame)
    game: ExecutedGame;

    @Column("integer")
    newBalance: number;

    @Column("integer")
    bet: number;

    @Column("integer")
    busted: number;

    @Column({type: "integer", nullable: true})
    cashout?: number; // What multiplier the user cashed out at, a value of NULL means the user busted

    @Column({type: "datetime", default: () => "DATETIME('now')"})
    timestamp: Date;

}
