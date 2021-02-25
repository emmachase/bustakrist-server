import {Entity, Column, PrimaryGeneratedColumn} from "typeorm";

@Entity()
export class Ban {

    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    ip: string;

}
