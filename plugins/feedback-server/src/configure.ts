import { main } from './cli.js';

await main(['agent', 'configure', ...Bun.argv.slice(2)]);
