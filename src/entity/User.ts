import {Entity, Column, PrimaryGeneratedColumn, Unique, ManyToMany, JoinTable, OneToMany} from "typeorm";
import { HistoricalBet } from "./HistoricalBet";

@Entity()
@Unique(["name"])
export class User {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    name: string;

    @Column()
    passwordHash: string;

    @Column({nullable: true})
    loginToken?: string;

    @Column({type: "integer", default: 100000})
    balance: number; // Balance is fixed precision number, 123 means 1.23

    @Column({type: "integer", default: 0})
    totalIn: number; // Total Krist into this account, including tips

    @Column({type: "integer", default: 0})
    totalOut: number; // Total Krist withdrawn from this account, including tips

    @ManyToMany(_type => User)
    @JoinTable()
    friends: User[];

    @OneToMany(_type => HistoricalBet, b => b.user)
    history: HistoricalBet[];

    @Column({type: "datetime", default: () => "DATETIME('now')"})
    joined: Date;

}
