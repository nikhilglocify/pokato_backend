import express from 'express';
import Stripe from 'stripe';

const router = express.Router();

/**
 * POST /api/terminal/connection-token
 * Creates a connection token for Stripe Terminal
 * 
 * This endpoint is required by the Stripe Terminal SDK to establish
 * a connection with Stripe's servers.
 * 
 * @returns {Object} { secret: string } - Connection token secret
 */
router.post('/connection-token', async (req, res) => {
  try {
    // Validate Stripe secret key is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({
        error: 'STRIPE_SECRET_KEY is not configured. Please set it in your .env file.',
      });
    }

    // Initialize Stripe with secret key from environment variable
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-11-20.acacia',
    });

    // Create connection token
    const connectionToken = await stripe.terminal.connectionTokens.create();

    res.json({
      secret: connectionToken.secret,
    });
  } catch (error) {
    console.error('Error creating connection token:', error);
    res.status(500).json({
      error: error.message || 'Failed to create connection token',
    });
  }
});

export default router;

