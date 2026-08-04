for (const filename of ['server.mjs', 'cli.mjs']) {
  const bundleUrl = new URL(`../dist/${filename}`, import.meta.url);
  const source = await Bun.file(bundleUrl).text();
  await Bun.write(bundleUrl, source.replace(/[ \t]+$/gm, ''));
}
