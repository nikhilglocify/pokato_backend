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
    const { amount, currency = 'usd', metadata = {}, customerDetails = {} } = req.body;

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
    

    // Build metadata with customer details if provided
    const paymentMetadata = {
      userId,
      ...metadata,
    };

    // Add customer details to metadata if provided
    if (customerDetails.email) {
      paymentMetadata.customerEmail = customerDetails.email;
    }
    if (customerDetails.name) {
      paymentMetadata.customerName = customerDetails.name;
    }
    if (customerDetails.phone) {
      paymentMetadata.customerPhone = customerDetails.phone;
    }
    if (customerDetails.zip) {
      paymentMetadata.customerZip = customerDetails.zip;
    }

    // Use customer email for receipt if provided, otherwise use default


    let intentData={
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: paymentMetadata,
      application_fee_amount: 5,
      

    }
    if(customerDetails.email){
      intentData.receipt_email = customerDetails.email;
    }
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create(
      intentData,
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
 * Helper function to fetch charges from Stripe for a date range
 */
const fetchChargesFromStripe = async (accountId, startTimestamp, endTimestamp) => {
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

    // Include all charges (both succeeded and failed)
    allCharges = allCharges.concat(charges.data);

    hasMore = charges.has_more;
    if (hasMore && charges.data.length > 0) {
      startingAfter = charges.data[charges.data.length - 1].id;
    } else {
      hasMore = false;
    }
  }

  return allCharges;
};

/**
 * Helper function to group charges by date
 */
const groupChargesByDate = (charges) => {
  const statsByDate = {};
  
  charges.forEach(charge => {
    const chargeDate = new Date(charge.created * 1000).toISOString().split('T')[0];
    if (!statsByDate[chargeDate]) {
      statsByDate[chargeDate] = {
        date: chargeDate,
        count: 0,
        totalAmount: 0, // In cents
        successful: 0,
        failed: 0,
      };
    }
    statsByDate[chargeDate].count += 1;
    statsByDate[chargeDate].totalAmount += charge.amount; // Keep in cents
    if (charge.status === 'succeeded' && charge.paid) {
      statsByDate[chargeDate].successful += 1;
    } else {
      statsByDate[chargeDate].failed += 1;
    }
  });

  return statsByDate;
};

/**
 * Helper function to calculate summary from stats
 */
const calculateSummary = (stats) => {
  const totalPayments = stats.reduce((sum, stat) => sum + stat.count, 0);
  const totalAmount = stats.reduce((sum, stat) => sum + stat.totalAmount, 0); // In cents
  const averageAmount = totalPayments > 0 ? Math.round(totalAmount / totalPayments) : 0; // In cents

  return {
    totalPayments,
    totalAmount, // In cents
    averageAmount, // In cents
  };
};

/**
 * Helper function to fill missing days with zeros
 */
const fillMissingDays = (statsByDate, startDate, endDate) => {
  const filledStats = [];
  const currentDate = new Date(startDate);
  const end = new Date(endDate);

  while (currentDate <= end) {
    const dateKey = currentDate.toISOString().split('T')[0];
    if (statsByDate[dateKey]) {
      filledStats.push(statsByDate[dateKey]);
    } else {
      // Fill with zeros
      filledStats.push({
        date: dateKey,
        count: 0,
        totalAmount: 0,
        successful: 0,
        failed: 0,
      });
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return filledStats;
};

/**
 * Get payment statistics for a date with trend data
 * GET /api/payments/stats?date=2025-12-15&includeTrend=true&days=7
 */
const getPaymentStats = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { date, includeTrend = 'true', days = '7' } = req.query;

    // Parse selected date or use today
    // Parse date string as **UTC** date (YYYY-MM-DD format) to match Stripe's UTC timestamps
    let selectedDate;
    if (date) {
      // Parse YYYY-MM-DD explicitly as a UTC date so that 2025-12-15 means
      // 2025-12-15T00:00:00.000Z -> 2025-12-15T23:59:59.999Z in Stripe (which uses UTC)
      const [year, month, day] = date.split('-').map(Number);
      selectedDate = new Date(Date.UTC(year, month - 1, day)); // month is 0-indexed
    } else {
      // Use "today" in UTC
      const now = new Date();
      selectedDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }
    // Ensure we're at the start of the UTC day
    selectedDate.setUTCHours(0, 0, 0, 0);
    
    console.log('🔵 Backend - Parsed date:', {
      inputDate: date,
      parsedDate: selectedDate.toISOString(),
      localDate: selectedDate.toLocaleDateString(),
    });

    // Parse days parameter (ensure it's a positive number)
    const trendDays = Math.max(1, parseInt(days, 10) || 7);
    const shouldIncludeTrend = includeTrend === 'true' || includeTrend === true;

    // Validate date
    if (isNaN(selectedDate.getTime())) {
      return res.status(400).json(errorResponse(
        'Invalid date format. Use ISO date format (e.g., 2025-12-15)',
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

    // Calculate date range for single day (UTC boundaries)
    const singleDayStart = new Date(selectedDate);
    singleDayStart.setUTCHours(0, 0, 0, 0);
    const singleDayEnd = new Date(selectedDate);
    singleDayEnd.setUTCHours(23, 59, 59, 999);

    // Calculate date range for trend data (UTC boundaries)
    const trendStart = new Date(selectedDate);
    trendStart.setUTCDate(trendStart.getUTCDate() - (trendDays - 1)); // (days-1) days ago + today = days total
    trendStart.setUTCHours(0, 0, 0, 0);
    const trendEnd = new Date(selectedDate);
    trendEnd.setUTCHours(23, 59, 59, 999);

    // Convert dates to Unix timestamps (seconds)
    const singleDayStartTimestamp = Math.floor(singleDayStart.getTime() / 1000);
    const singleDayEndTimestamp = Math.floor(singleDayEnd.getTime() / 1000);
    const trendStartTimestamp = Math.floor(trendStart.getTime() / 1000);
    const trendEndTimestamp = Math.floor(trendEnd.getTime() / 1000);

    console.log("single Day dates",{
      singleDayStartTimestamp,
      singleDayEndTimestamp,
    })
    // Fetch single day charges
    const singleDayCharges = await fetchChargesFromStripe(
      accountId,
      singleDayStartTimestamp,
      singleDayEndTimestamp
    );

    // Fetch trend data charges (if requested)
    let trendCharges = [];
    if (shouldIncludeTrend) {
      trendCharges = await fetchChargesFromStripe(
        accountId,
        trendStartTimestamp,
        trendEndTimestamp
      );
    }

    // Group charges by date
    const singleDayStatsByDate = groupChargesByDate(singleDayCharges);
    const trendStatsByDate = shouldIncludeTrend ? groupChargesByDate(trendCharges) : {};

    // Format single day stats
    const singleDayStats = fillMissingDays(singleDayStatsByDate, singleDayStart, singleDayEnd);
    const singleDaySummary = calculateSummary(singleDayStats);

    // Format trend data stats
    let trendData = null;
    if (shouldIncludeTrend) {
      const trendStats = fillMissingDays(trendStatsByDate, trendStart, trendEnd);
      const trendSummary = calculateSummary(trendStats);

      trendData = {
        days: trendDays,
        stats: trendStats,
        summary: trendSummary,
      };
    }

    // Build response
    const response = {
      singleDay: {
        stats: singleDayStats,
        summary: singleDaySummary,
      },
      trendData,
    };

    res.json(successResponse(response, 'Payment statistics retrieved successfully'));
  } catch (error) {
    console.error('Error fetching payment stats:', error);
    next(error);
  }
};

module.exports = {
  createPaymentIntent,
  getPaymentStats,
};
