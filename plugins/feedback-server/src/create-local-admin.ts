import { main } from './cli.js';

await main(['admin', 'create-local', ...Bun.argv.slice(2)]);
