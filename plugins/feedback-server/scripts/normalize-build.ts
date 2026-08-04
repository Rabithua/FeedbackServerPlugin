const bundleUrl = new URL('../dist/server.mjs', import.meta.url);
const source = await Bun.file(bundleUrl).text();

await Bun.write(bundleUrl, source.replace(/[ \t]+$/gm, ''));
