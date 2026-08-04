import { main } from './cli.js';

await main(['admin', 'accept-invite', ...Bun.argv.slice(2)]);
