import express from 'express';
import Stripe from 'stripe';

const router = express.Router();

// Initialize Stripe with secret key from environment variable
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
});

/**
 * POST /api/stripe/connect/create-account
 * Creates a Stripe Connect account for a user
 * 
 * Requires: userId in request body or from auth token
 */
router.post('/connect/create-account', async (req, res) => {
  try {
    const { userId, email } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // Create Stripe Connect account
    const account = await stripe.accounts.create({
      type: 'express',
      email: email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    // Return account ID (store in your database/Firestore)
    res.json({
      accountId: account.id,
      status: 'pending',
    });
  } catch (error) {
    console.error('Error creating Stripe Connect account:', error);
    res.status(500).json({
      error: error.message || 'Failed to create Stripe Connect account',
    });
  }
});

/**
 * POST /api/stripe/connect/get-link
 * Gets Stripe Connect onboarding link
 * 
 * Requires: accountId and returnUrl
 */
router.post('/connect/get-link', async (req, res) => {
  try {
    const { accountId, returnUrl } = req.body;

    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: returnUrl || 'https://your-app.com/stripe/refresh',
      return_url: returnUrl || 'https://your-app.com/stripe/return',
      type: 'account_onboarding',
    });

    res.json({
      url: accountLink.url,
    });
  } catch (error) {
    console.error('Error creating Stripe Connect link:', error);
    res.status(500).json({
      error: error.message || 'Failed to create Stripe Connect link',
    });
  }
});

/**
 * GET /api/stripe/connect/status/:accountId
 * Gets Stripe account status
 */
router.get('/connect/status/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;

    // Get account details from Stripe
    const account = await stripe.accounts.retrieve(accountId);

    let status = 'pending';
    if (account.details_submitted && account.charges_enabled) {
      status = 'active';
    } else if (account.details_submitted && !account.charges_enabled) {
      status = 'disabled';
    }

    res.json({
      connected: true,
      status,
      accountId,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
    });
  } catch (error) {
    console.error('Error getting Stripe account status:', error);
    res.status(500).json({
      error: error.message || 'Failed to get account status',
    });
  }
});

/**
 * POST /api/stripe/terminal/connection-token
 * Creates connection token for Stripe Terminal
 * Uses user's connected Stripe account
 * 
 * Requires: accountId in request body
 */
router.post('/terminal/connection-token', async (req, res) => {
  try {
    const { accountId } = req.body;

    if (!accountId) {
      return res.status(400).json({
        error: 'accountId is required. Please connect your Stripe account first.',
      });
    }

    // Create connection token using the user's Stripe account
    const connectionToken = await stripe.terminal.connectionTokens.create(
      {},
      {
        stripeAccount: accountId,
      },
    );

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



