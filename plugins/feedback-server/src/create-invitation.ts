import { main } from './cli.js';

await main(['admin', 'invite', ...Bun.argv.slice(2)]);
