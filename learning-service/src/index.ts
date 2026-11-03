import {loadConfig} from './config.js';
import {LearningService} from './server.js';

const service = new LearningService(loadConfig());

const shutdown = async (): Promise<void> => {
    await service.close();
    process.exit(0);
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await service.start();
