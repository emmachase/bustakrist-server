import Redis from "ioredis";
import { getConfig } from "../config";

const config = getConfig();
export const redis = new Redis(
    config.redis.port,
    config.redis.host
);
