# Stripe Terminal Backend Server

Backend server for the Stripe Terminal React Native application.

## Setup

1. **Install dependencies:**
   ```bash
   cd server
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Then edit `.env` and add your Stripe secret key:
   ```
   STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
   ```
   
   Get your API keys from: https://dashboard.stripe.com/apikeys
   - Use **test keys** for development
   - Use **live keys** for production

3. **Start the server:**
   ```bash
   npm start
   ```
   
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

## Endpoints

### POST /api/terminal/connection-token

Creates a connection token for Stripe Terminal SDK.

**Request:**
```bash
POST http://localhost:3000/api/terminal/connection-token
Content-Type: application/json
```

**Response:**
```json
{
  "secret": "pst_test_..."
}
```

## Configuration

Update the React Native app's `src/config/constants.ts`:

```typescript
export const TERMINAL_CONNECTION_TOKEN_URL = 'http://localhost:3000/api/terminal/connection-token';
```

**Note:** For Android emulator, use `http://10.0.2.2:3000` instead of `localhost`.
For iOS simulator, `localhost` works fine.

## Production

For production deployment:
1. Use environment variables for configuration
2. Use Stripe live keys (not test keys)
3. Deploy to a cloud service (Heroku, AWS, etc.)
4. Update the React Native app to use the production URL



