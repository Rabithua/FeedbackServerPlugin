import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

interface EvalCase {
  schema_version?: unknown;
  name?: unknown;
  tags?: unknown;
  execution?: {
    prompt?: unknown;
    max_turns?: unknown;
    timeout_seconds?: unknown;
    allowed_tools?: unknown;
  };
  runs?: unknown;
  graders?: unknown;
  expected_outcome?: unknown;
}

const allowedGraderTypes = new Set([
  'regex',
  'tool_order',
  'tool_used',
  'file_exists',
  'llm',
  'baseline',
]);

describe('Claude Code plugin eval suite', () => {
  test('defines the required workflow and negative cases with bounded execution', async () => {
    const root = resolve(import.meta.dir, '../evals');
    const files = [...new Bun.Glob('**/case.yaml').scanSync({ cwd: root })].sort();
    expect(files).toHaveLength(7);
    expect(files).toEqual(expect.arrayContaining([
      'setup/case.yaml',
      'triage/case.yaml',
      'waitlist/case.yaml',
      'publishing/case.yaml',
      'error-recovery/case.yaml',
      'profiles/case.yaml',
      'negative-unrelated-feedback/case.yaml',
    ]));

    const names = new Set<string>();
    for (const file of files) {
      const parsed = Bun.YAML.parse(await Bun.file(resolve(root, file)).text()) as EvalCase;
      expect(parsed.schema_version, file).toBe('1.1');
      expect(typeof parsed.name, file).toBe('string');
      expect(names.has(parsed.name as string), file).toBe(false);
      names.add(parsed.name as string);
      expect(Array.isArray(parsed.tags), file).toBe(true);
      expect(typeof parsed.execution?.prompt, file).toBe('string');
      expect(parsed.execution?.max_turns, file).toBeNumber();
      expect(parsed.execution?.timeout_seconds, file).toBeNumber();
      expect(Array.isArray(parsed.execution?.allowed_tools), file).toBe(true);
      expect(parsed.runs, file).toBe(1);
      expect(typeof parsed.expected_outcome, file).toBe('string');
      expect(Array.isArray(parsed.graders), file).toBe(true);
      for (const grader of parsed.graders as Array<Record<string, unknown>>) {
        expect(allowedGraderTypes.has(String(grader.type)), file).toBe(true);
        expect(typeof grader.name, file).toBe('string');
      }
    }
  });
});
