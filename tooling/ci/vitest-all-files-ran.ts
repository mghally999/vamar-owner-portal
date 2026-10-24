/**
 * Vitest reporter: the run fails when a selected test file never executed a test (for example
 * its worker failed to start on a busy machine) or when Vitest caught unhandled errors. Vitest's
 * own summary can still read "passed" in those cases.
 */
import type { Reporter, TestModule, TestSpecification } from 'vitest/node';

export default class AllTestFilesRan implements Reporter {
  private selected: string[] = [];

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>): void {
    this.selected = specifications.map((s) => s.moduleId);
  }

  onTestRunEnd(modules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<unknown>): void {
    const ran = new Set(
      modules
        .filter((m) => {
          const tests = [...m.children.allTests()];
          return tests.some((t) => ['passed', 'failed'].includes(t.result().state));
        })
        .map((m) => m.moduleId),
    );
    const missing = this.selected.filter((id) => !ran.has(id));
    if (missing.length > 0 || unhandledErrors.length > 0) {
      for (const id of missing) console.error(`test file did not run: ${id}`);
      if (unhandledErrors.length > 0)
        console.error(`${String(unhandledErrors.length)} unhandled error(s) during the run`);
      process.exitCode = 1;
    }
  }
}
