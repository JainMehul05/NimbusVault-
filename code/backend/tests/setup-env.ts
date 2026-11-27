import dotenv from 'dotenv';
import { assertDisposableDatabase } from './db-guard';

dotenv.config({ path: '.env.test' });

// The suites delete every row when they finish, so they must never reach real data.
assertDisposableDatabase(process.env.DATABASE_URL);
