# Testing Strategy

## Overview

This document describes the testing approach for NimbusVault Phase 1, covering backend unit/integration tests and frontend component tests.

## Testing Pyramid

```
         /\
        /  \     E2E Tests (Future)
       /----\
      /      \   Integration Tests
     /--------\
    /          \ Unit Tests
   /------------\
```

### Phase 1 Focus
- ✅ Unit Tests (Backend services, utilities)
- ✅ Integration Tests (API endpoints with database)
- ✅ Component Tests (Frontend pages)
- ⏳ E2E Tests (Phase 2+)

## Backend Testing

### Framework
- **Jest** + **ts-jest** for TypeScript
- **Supertest** for HTTP integration tests
- **Prisma** test database (separate from dev)

### Configuration (`jest.config.js`)

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/**/*.d.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
  },
};
```

### Test Setup (`tests/setup.ts`)

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  // Clean up in reverse dependency order
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});
```

### Test Categories

#### 1. Health API
```typescript
describe('Health API', () => {
  it('GET /api/v1/health should return success', async () => {
    const response = await request(app).get('/api/v1/health').expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('NimbusVault backend running');
  });
});
```

#### 2. Registration Tests
```typescript
describe('POST /api/v1/auth/register', () => {
  it('should register a new user successfully', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Test', email: 'test@example.com', password: 'password123' })
      .expect(201);
    
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe('test@example.com');
    expect(response.body.data.tokens.accessToken).toBeDefined();
  });

  it('should fail with duplicate email', async () => {
    // First registration
    await request(app).post('/api/v1/auth/register').send(testUser).expect(201);
    
    // Duplicate
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(testUser)
      .expect(409);
    
    expect(response.body.error.code).toBe('EMAIL_EXISTS');
  });

  it('should fail with invalid email', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...testUser, email: 'invalid' })
      .expect(400);
    
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should fail with short password', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...testUser, password: 'short' })
      .expect(400);
    
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
```

#### 3. Login Tests
```typescript
describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    // Create test user
    const passwordHash = await bcrypt.hash(testUser.password, config.bcrypt.rounds);
    await prisma.user.create({
      data: { name: testUser.name, email: testUser.email, passwordHash },
    });
  });

  it('should login successfully with correct credentials', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);
    
    expect(response.body.data.tokens.accessToken).toBeDefined();
    expect(response.body.data.tokens.refreshToken).toBeDefined();
  });

  it('should fail with wrong password', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: 'wrong' })
      .expect(401);
    
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
```

#### 4. Protected Route Tests
```typescript
describe('JWT Protected Routes', () => {
  let accessToken: string;

  beforeEach(async () => {
    // Login and get tokens
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    accessToken = loginResponse.body.data.tokens.accessToken;
  });

  it('should access /auth/me with valid token', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    
    expect(response.body.data.email).toBe(testUser.email);
  });

  it('should reject request without token', async () => {
    await request(app).get('/api/v1/auth/me').expect(401);
  });

  it('should reject request with invalid token', async () => {
    await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid')
      .expect(401);
  });
});
```

#### 5. Refresh Token Rotation Tests
```typescript
describe('Refresh Token Rotation', () => {
  let refreshToken: string;
  let tokenFamily: string;

  beforeEach(async () => {
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    refreshToken = loginResponse.body.data.tokens.refreshToken;
    tokenFamily = loginResponse.body.data.tokens.tokenFamily;
  });

  it('should rotate refresh token successfully', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken, tokenFamily })
      .expect(200);
    
    expect(response.body.data.refreshToken).not.toBe(refreshToken);
    expect(response.body.data.tokenFamily).toBe(tokenFamily);
  });

  it('should detect token reuse', async () => {
    // First refresh - succeeds
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken, tokenFamily })
      .expect(200);
    
    // Second refresh with same token - fails
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken, tokenFamily })
      .expect(401);
    
    expect(response.body.error.code).toBe('TOKEN_REUSE_DETECTED');
  });
});
```

#### 6. Logout Tests
```typescript
describe('POST /api/v1/auth/logout', () => {
  it('should logout successfully', async () => {
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .send({ tokenFamily })
      .expect(200);
    
    expect(response.body.success).toBe(true);
  });

  it('should invalidate refresh tokens after logout', async () => {
    // Login again to get fresh tokens
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    
    const { refreshToken, tokenFamily } = loginResponse.body.data.tokens;
    
    // Logout
    await request(app)
      .post('/api/v1/auth/logout')
      .send({ tokenFamily })
      .expect(200);
    
    // Try to use revoked token
    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken, tokenFamily })
      .expect(401);
  });
});
```

### Running Backend Tests

```bash
cd backend

# All tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov

# Specific file
npm test -- auth.test.ts

# Debug mode
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Frontend Testing

### Framework
- **Vitest** for test runner
- **React Testing Library** for component testing
- **jsdom** environment
- **MSW** (Mock Service Worker) for API mocking (future)

### Configuration (`vitest.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.tsx'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // ... other aliases
    },
  },
});
```

### Test Setup (`tests/setup.ts`)

```typescript
import '@testing-library/jest-dom';
import { vi } from 'vitest';

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});
```

### Component Tests

#### Register Page
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@context/AuthContext';
import { RegisterPage } from '@pages/RegisterPage';
import { api } from '@services/api';

vi.mock('@services/api');

const renderWithProviders = (component: React.ReactNode) => {
  return render(
    <BrowserRouter>
      <AuthProvider>{component}</AuthProvider>
    </BrowserRouter>
  );
};

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.getItem = vi.fn().mockReturnValue(null);
  });

  it('renders register form with all fields', () => {
    renderWithProviders(<RegisterPage />);
    
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
  });

  it('shows error when passwords do not match', async () => {
    renderWithProviders(<RegisterPage />);
    
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
  });

  it('shows error when password is too short', async () => {
    renderWithProviders(<RegisterPage />);
    
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    });
  });

  it('calls register API on valid submit', async () => {
    const mockRegister = vi.fn().mockResolvedValue({ 
      data: { success: true, data: { user: { id: '1', name: 'Test', email: 'test@example.com' }, tokens: { accessToken: 'at', refreshToken: 'rt', tokenFamily: 'tf', expiresIn: 3600 } } } 
    });
    (api.post as any).mockImplementation(mockRegister);
    
    renderWithProviders(<RegisterPage />);
    
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    
    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('/auth/register', {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });
});
```

#### Login Page
```typescript
describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.getItem = vi.fn().mockReturnValue(null);
  });

  it('renders login form with all fields', () => {
    renderWithProviders(<LoginPage />);
    
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows error on failed login', async () => {
    (api.post as any).mockRejectedValue({
      response: { data: { message: 'Invalid credentials' } },
    });
    
    renderWithProviders(<LoginPage />);
    
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrongpassword' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    
    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });
  });
});
```

### Running Frontend Tests

```bash
cd frontend

# All tests (headless)
npm run test:run

# Watch mode
npm test

# With UI
npm run test:ui

# Coverage
npm run test:run -- --coverage
```

## Test Coverage Goals

### Backend
- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 80%
- **Lines**: > 80%

### Frontend
- **Statements**: > 70%
- **Branches**: > 65%
- **Functions**: > 70%
- **Lines**: > 70%

## CI Integration

### GitHub Actions (`.github/workflows/ci.yml`)

```yaml
jobs:
  backend:
    steps:
      - name: Run backend tests
        run: npm test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/nimbusvault
          JWT_ACCESS_SECRET: test-secret...
          JWT_REFRESH_SECRET: test-secret...
  
  frontend:
    steps:
      - name: Run frontend tests
        run: npm run test:run
```

### Pre-commit Hooks (Optional)

```bash
# Install husky
npm install -D husky lint-staged

# package.json
"husky": {
  "hooks": {
    "pre-commit": "lint-staged"
  }
},
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"]
}
```

## Test Data Management

### Factories (Future Enhancement)

```typescript
// tests/factories/user.factory.ts
export const createTestUser = (overrides = {}) => ({
  name: 'Test User',
  email: `test-${Date.now()}@example.com`,
  password: 'password123',
  ...overrides,
});

export const createTestUserInDb = async (prisma: PrismaClient, overrides = {}) => {
  const data = createTestUser(overrides);
  const passwordHash = await bcrypt.hash(data.password, 12);
  return prisma.user.create({
    data: { name: data.name, email: data.email, passwordHash },
  });
};
```

## Debugging Tests

### VS Code Launch Config (`.vscode/launch.json`)

```json
{
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Jest Debug",
      "program": "${workspaceFolder}/backend/node_modules/.bin/jest",
      "args": ["--runInBand", "--testNamePattern", "${input:testName}"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Vitest Debug",
      "program": "${workspaceFolder}/frontend/node_modules/.bin/vitest",
      "args": ["run", "${input:testFile}"],
      "console": "integratedTerminal"
    }
  ],
  "inputs": [
    {
      "type": "promptString",
      "id": "testName",
      "description": "Test name pattern"
    },
    {
      "type": "promptString",
      "id": "testFile",
      "description": "Test file path"
    }
  ]
}
```

## Best Practices

### Backend
1. **Isolate Tests**: Clean database between tests
2. **Test Behavior**: Focus on API contracts, not implementation
3. **Use Real DB**: Integration tests with actual PostgreSQL
4. **Mock External**: Only mock external services (AWS, email)
5. **Descriptive Names**: `should return 401 when token is expired`

### Frontend
1. **Test User Interactions**: Click, type, submit
2. **Avoid Implementation Details**: Don't test internal state
3. **Mock at Network Layer**: Mock API calls, not components
4. **Accessibility Queries**: Prefer `getByLabelText`, `getByRole`
5. **Async Handling**: Use `waitFor` for async assertions

### General
1. **Arrange-Act-Assert**: Structure tests clearly
2. **One Assertion Per Test**: When possible
3. **Independent Tests**: No test ordering dependencies
4. **Fast Feedback**: Unit tests < 100ms, integration < 1s
5. **Deterministic**: No flaky tests, fix immediately