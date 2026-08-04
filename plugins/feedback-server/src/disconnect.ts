import { main } from './cli.js';

await main(['agent', 'disconnect', ...Bun.argv.slice(2)]);
