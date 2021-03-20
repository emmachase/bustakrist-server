import {MigrationInterface, QueryRunner} from "typeorm";

export class AddUserBanned1616180539529 implements MigrationInterface {
    name = 'AddUserBanned1616180539529'
    
    public async up(queryRunner: QueryRunner): Promise<void> {
                await queryRunner.query(`PRAGMA foreign_key = OFF; CREATE TABLE "temporary_user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "passwordHash" varchar NOT NULL, "loginToken" varchar, "balance" integer NOT NULL DEFAULT (0), "totalIn" integer NOT NULL DEFAULT (0), "totalOut" integer NOT NULL DEFAULT (0), "joined" datetime NOT NULL DEFAULT (DATETIME('now')), "banned" boolean NOT NULL DEFAULT (0), CONSTRAINT "UQ_065d4d8f3b5adb4a08841eae3c8" UNIQUE ("name"))`);
                        await queryRunner.query(`PRAGMA foreign_key = OFF; INSERT INTO "temporary_user"("id", "name", "passwordHash", "loginToken", "balance", "totalIn", "totalOut", "joined") SELECT "id", "name", "passwordHash", "loginToken", "balance", "totalIn", "totalOut", "joined" FROM "user"`);
                                await queryRunner.query(`PRAGMA foreign_key = OFF; DROP TABLE "user"`);
                                        await queryRunner.query(`PRAGMA foreign_key = OFF; ALTER TABLE "temporary_user" RENAME TO "user"`);

    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user" RENAME TO "temporary_user"`);
        await queryRunner.query(`CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "passwordHash" varchar NOT NULL, "loginToken" varchar, "balance" integer NOT NULL DEFAULT (0), "totalIn" integer NOT NULL DEFAULT (0), "totalOut" integer NOT NULL DEFAULT (0), "joined" datetime NOT NULL DEFAULT (DATETIME('now')), CONSTRAINT "UQ_065d4d8f3b5adb4a08841eae3c8" UNIQUE ("name"))`);
        await queryRunner.query(`INSERT INTO "user"("id", "name", "passwordHash", "loginToken", "balance", "totalIn", "totalOut", "joined") SELECT "id", "name", "passwordHash", "loginToken", "balance", "totalIn", "totalOut", "joined" FROM "temporary_user"`);
        await queryRunner.query(`DROP TABLE "temporary_user"`);
    }

}
