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

/**
 * Get payment statistics for a date range
 * GET /api/payments/stats?startDate=2023-01-01T00:00:00.000Z&endDate=2023-01-31T23:59:59.999Z
 */
const getPaymentStats = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate } = req.query;

    // Validate date parameters
    if (!startDate || !endDate) {
      return res.status(400).json(errorResponse(
        'startDate and endDate query parameters are required',
        'invalid-argument'
      ));
    }

    // Parse and validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json(errorResponse(
        'Invalid date format. Use ISO 8601 format (e.g., 2023-01-01T00:00:00.000Z)',
        'invalid-argument'
      ));
    }

    if (start > end) {
      return res.status(400).json(errorResponse(
        'startDate must be before or equal to endDate',
        'invalid-argument'
      ));
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

    // Convert dates to Unix timestamps (seconds)
    const startTimestamp = Math.floor(start.getTime() / 1000);
    const endTimestamp = Math.floor(end.getTime() / 1000);

    // Fetch charges from Stripe with date filtering
    let allCharges = [];
    let hasMore = true;
    let startingAfter = null;
    const limit = 100; // Stripe's max limit per request

    while (hasMore) {
      const params = {
        created: {
          gte: startTimestamp,
          lte: endTimestamp,
        },
        status: 'succeeded', // Only successful charges
        limit,
      };

      if (startingAfter) {
        params.starting_after = startingAfter;
      }

      const charges = await stripe.charges.list(
        params,
        {
          stripeAccount: accountId,
        }
      );

      // Filter to only succeeded charges (double check)
      const succeededCharges = charges.data.filter(charge => charge.status === 'succeeded' && charge.paid === true);
      allCharges = allCharges.concat(succeededCharges);

      hasMore = charges.has_more;
      if (hasMore && charges.data.length > 0) {
        startingAfter = charges.data[charges.data.length - 1].id;
      } else {
        hasMore = false;
      }
    }

    // Calculate statistics
    const totalPayments = allCharges.length;
    const totalAmount = allCharges.reduce((sum, charge) => {
      // Stripe amounts are in cents, convert to dollars
      return sum + (charge.amount / 100);
    }, 0);
    const averageAmount = totalPayments > 0 ? totalAmount / totalPayments : 0;

    // Group charges by date for stats array
    const statsByDate = {};
    allCharges.forEach(charge => {
      const chargeDate = new Date(charge.created * 1000).toISOString().split('T')[0];
      if (!statsByDate[chargeDate]) {
        statsByDate[chargeDate] = {
          date: chargeDate,
          count: 0,
          totalAmount: 0,
          successful: 0,
          failed: 0,
        };
      }
      statsByDate[chargeDate].count += 1;
      statsByDate[chargeDate].totalAmount += charge.amount / 100; // Convert cents to dollars
      if (charge.status === 'succeeded' && charge.paid) {
        statsByDate[chargeDate].successful += 1;
      } else {
        statsByDate[chargeDate].failed += 1;
      }
    });

    // Convert stats object to array and sort by date
    const stats = Object.values(statsByDate).sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Round amounts to 2 decimal places
    const roundedTotalAmount = Math.round(totalAmount * 100) / 100;
    const roundedAverageAmount = Math.round(averageAmount * 100) / 100;

    res.json(successResponse({
      summary: {
        totalPayments,
        totalAmount: roundedTotalAmount,
        averageAmount: roundedAverageAmount,
      },
      stats: stats.map(stat => ({
        ...stat,
        totalAmount: Math.round(stat.totalAmount * 100) / 100,
      })),
    }, 'Payment statistics retrieved successfully'));
  } catch (error) {
    console.error('Error fetching payment stats:', error);
    next(error);
  }
};

module.exports = {
  createPaymentIntent,
  getPaymentStats,
};
