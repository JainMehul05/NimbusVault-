# Authentication System Design

## Overview

This document describes the authentication implementation for NimbusVault Phase 1, featuring JWT access tokens with refresh token rotation and replay detection.

## Token Architecture

### Access Token (JWT)
- **Algorithm**: HS256
- **Expiration**: 15 minutes
- **Payload**:
  ```json
  {
    "userId": "uuid",
    "email": "user@example.com",
    "type": "access",
    "iat": 1234567890,
    "exp": 1234568790
  }
  ```
- **Usage**: Sent in Authorization header as `Bearer <token>`
- **Storage**: Client-side memory (not localStorage for security)

### Refresh Token (JWT)
- **Algorithm**: HS256
- **Expiration**: 7 days
- **Payload**:
  ```json
  {
    "userId": "uuid",
    "tokenFamily": "uuid",
    "type": "refresh",
    "iat": 1234567890,
    "exp": 1234567890
  }
  ```
- **Storage**: HttpOnly, Secure, SameSite=Lax cookie + database hash
- **Rotation**: New token issued on each use
- **Family**: Groups related tokens for revocation

## Database Schema

### RefreshToken Table
```prisma
model RefreshToken {
  id          String   @id @default(uuid())
  userId      String
  tokenHash   String   // bcrypt hash of raw token
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  revokedAt   DateTime?
  tokenFamily String   // Groups tokens for rotation/revocation
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([tokenFamily])
  @@map("refresh_tokens")
}
```

## Authentication Flow

### Registration
```
POST /api/v1/auth/register
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securepassword123"
}

Response (201):
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "user": { "id": "...", "name": "John Doe", "email": "john@example.com" },
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "dGhpcyBpcyBhIHJhdyB0b2tlbg...",
      "tokenFamily": "uuid",
      "expiresIn": 604800
    }
  }
}
```
- Password hashed with bcrypt (12 rounds)
- Access token generated (15 min)
- Refresh token generated, hashed with bcrypt, stored in DB
- Refresh token set as HttpOnly cookie
- Raw refresh token returned in response for client storage

### Login
```
POST /api/v1/auth/login
{
  "email": "john@example.com",
  "password": "securepassword123"
}

Response (200):
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { "id": "...", "name": "John Doe", "email": "john@example.com" },
    "tokens": {
      "accessToken": "eyJ...",
      "refreshToken": "dGhpcyBpcyBhIHJhdyB0b2tlbg...",
      "tokenFamily": "uuid",
      "expiresIn": 604800
    }
  }
}
```
- User lookup by email
- Password verification with bcrypt
- New token family created
- Tokens generated and stored

### Access Protected Resource
```
GET /api/v1/auth/me
Authorization: Bearer <accessToken>

Response (200):
{
  "success": true,
  "message": "User profile retrieved",
  "data": {
    "id": "...",
    "name": "John Doe",
    "email": "john@example.com",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```
- Middleware extracts Bearer token
- Verifies JWT signature and expiration
- Checks token type is "access"
- Attaches user payload to request

### Token Refresh
```
POST /api/v1/auth/refresh
{
  "refreshToken": "dGhpcyBpcyBhIHJhdyB0b2tlbg...",
  "tokenFamily": "uuid"
}

Response (200):
{
  "success": true,
  "message": "Token refreshed",
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "bmV3IHJhdyB0b2tlbg...",
    "tokenFamily": "uuid",
    "expiresIn": 604800
  }
}
```
1. Find active tokens in token family
2. Compare provided token with stored hashes (bcrypt)
3. If match found:
   - Revoke used token (set revokedAt)
   - Generate new refresh token in same family
   - Generate new access token
   - Return both tokens
4. If no match:
   - Revoke entire token family (security)
   - Return 401 TOKEN_REUSE_DETECTED

### Logout
```
POST /api/v1/auth/logout
{
  "tokenFamily": "uuid"
}

Response (200):
{
  "success": true,
  "message": "Logged out successfully"
}
```
- Revoke all tokens in family (set revokedAt)
- Clear HttpOnly cookie
- Client clears localStorage

## Security Features

### 1. Token Rotation
- Each refresh generates new refresh token
- Old token immediately revoked
- Limits window of opportunity for stolen tokens

### 2. Replay Detection
- Token family tracks all related tokens
- If same token used twice:
  - Entire family revoked
  - User must re-authenticate
  - Alerts potential token theft

### 3. Secure Storage
- Refresh tokens hashed with bcrypt before DB storage
- HttpOnly cookie prevents XSS access
- SameSite=Lax prevents CSRF
- Secure flag in production (HTTPS only)

### 4. Short-Lived Access Tokens
- 15-minute expiration limits damage from token leakage
- Automatic refresh via interceptor

### 5. Revocation on Logout
- Immediate invalidation of all user sessions
- Token family cleanup

## Client Implementation

### Token Storage (Frontend)
```typescript
// localStorage (access token only - short lived)
localStorage.setItem('accessToken', accessToken);
localStorage.setItem('refreshToken', refreshToken); // raw token for refresh calls
localStorage.setItem('tokenFamily', tokenFamily);
localStorage.setItem('user', JSON.stringify(user));
```

### Axios Interceptor (Auto-Refresh)
```typescript
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      const refreshToken = localStorage.getItem('refreshToken');
      const tokenFamily = localStorage.getItem('tokenFamily');
      
      const response = await axios.post('/auth/refresh', { refreshToken, tokenFamily });
      
      const { accessToken, refreshToken: newRefreshToken, tokenFamily: newFamily } = response.data.data.tokens;
      
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', newRefreshToken);
      localStorage.setItem('tokenFamily', newFamily);
      
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    }
    return Promise.reject(error);
  }
);
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Request validation failed |
| EMAIL_EXISTS | 409 | Email already registered |
| INVALID_CREDENTIALS | 401 | Wrong email/password |
| TOKEN_REQUIRED | 401 | Missing Authorization header |
| INVALID_TOKEN | 401 | Expired or malformed access token |
| INVALID_REFRESH_TOKEN | 401 | Expired or unknown refresh token |
| TOKEN_REUSE_DETECTED | 401 | Refresh token used multiple times |
| USER_NOT_FOUND | 404 | User deleted but token valid |

## Testing Scenarios

### Happy Path
1. Register → Login → Access /me → Refresh → Access /me → Logout

### Security Tests
1. Expired access token → Auto-refresh → Success
2. Expired refresh token → 401 → Redirect to login
3. Reused refresh token → 401 TOKEN_REUSE_DETECTED → Family revoked
4. Logout → Refresh attempt → 401
5. Concurrent logins → Each gets own token family

### Edge Cases
1. Clock skew between client/server
2. Network failure during refresh
3. Multiple tabs refreshing simultaneously
4. Token family cleanup on expiration

## Configuration

### Environment Variables
```env
JWT_ACCESS_SECRET=your-32-char-min-secret
JWT_REFRESH_SECRET=your-32-char-min-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_ROUNDS=12
```

### Secret Generation
```bash
# Generate secure secrets
openssl rand -base64 32
```

## Future Enhancements (Phase 2+)

1. **Device Tracking**: Store device info with refresh tokens
2. **Session Management**: List/revoke active sessions
3. **MFA Support**: TOTP/WebAuthn integration
4. **OAuth2/OIDC**: Social login providers
5. **Token Blacklisting**: Redis for distributed revocation
6. **Audit Logging**: Security event tracking