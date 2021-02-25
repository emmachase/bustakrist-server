import {Entity, Column, PrimaryColumn} from "typeorm";

@Entity()
export class GameHash {

    @PrimaryColumn()
    id: number;

    @Column()
    hash: string;

}
