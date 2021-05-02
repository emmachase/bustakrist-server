import client from "prom-client"
import Express from "express"
import { getConfig } from "../config";
import { logger } from "../logger";
import chalk from "chalk";

export const metrics_prefix = 'kbit_';
client.collectDefaultMetrics({ prefix: metrics_prefix, register: client.register });

export function initMetrics() {
    const app = Express();
    const config = getConfig();

    app.get('/metrics', async (_req, res) => {
        return res.send(await client.register.metrics());
    })

    app.listen(
        config.system.metricsPort,
        () => {
            logger.info(chalk`{bold Metrics} started on port {cyan ${config.system.metricsPort}}`);
        }
    )
}

export const metrics = client
