/** Throws unless the database is clearly a throwaway test database. */
export function assertDisposableDatabase(url: string | undefined): void {
  if (process.env.ALLOW_DESTRUCTIVE_TESTS === 'true') return;
  let name = '';
  try {
    name = new URL(url ?? '').pathname.slice(1);
  } catch {
    /* reported below */
  }
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run tests against database "${name || 'unknown'}": the suites delete all rows. ` +
        'Use a database whose name contains "test" (npm run test:prepare creates nimbusvault_test).'
    );
  }
}
