const { stripe } = require('../../config/stripe.js');
const prisma = require('../../config/database.js');
const { successResponse, errorResponse } = require('../../utils/response.js');

/**
 * Create payment intent for Terminal payment
 * POST /api/payments/create-intent
 */
const createPaymentIntent = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { amount, currency = 'usd', metadata = {} } = req.body;

    // Validate amount
    if (!amount || amount <= 0) {
      return res.status(400).json(errorResponse('Amount must be greater than zero', 'invalid-argument'));
    }

    // Get user's Stripe account ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.stripeAccountId) {
      return res.status(400).json(errorResponse(
        'Stripe account not connected. Please connect your Stripe account first.',
        'failed-precondition'
      ));
    }

    if (user.stripeAccountStatus !== 'active') {
      return res.status(400).json(errorResponse(
        'Stripe account is not active. Please complete the onboarding process.',
        'failed-precondition'
      ));
    }

    const accountId = user.stripeAccountId;

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        metadata: {
          userId,
          ...metadata,
        },
      },
      {
        // Create PI inside the connected account
        stripeAccount: accountId,
      }
    );

    if (!paymentIntent.client_secret) {
      return res.status(500).json(errorResponse('Failed to create payment intent: missing client secret'));
    }

    // Note: Payment intents are stored in Stripe, not in our database
    // We only store user and stripe_details

    res.json(successResponse({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    }, 'Payment intent created successfully'));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createPaymentIntent,
};
