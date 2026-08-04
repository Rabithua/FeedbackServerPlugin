export function parseCliOptions(
  argv: string[],
  allowedOptions: readonly string[],
): ReadonlyMap<string, string> {
  const allowed = new Set(allowedOptions);
  const parsed = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--') continue;
    if (!option || !option.startsWith('--') || !allowed.has(option)) {
      throw new Error(`Unsupported option: ${option ?? ''}`.trim());
    }
    if (parsed.has(option)) throw new Error(`Option may only be provided once: ${option}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    parsed.set(option, value);
    index += 1;
  }

  return parsed;
}

export function parseIntegerOption(
  options: ReadonlyMap<string, string>,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const raw = options.get(name);
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

