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
    const {
      amount,
      currency = 'usd',
      metadata = {},
      customerDetails = {},
    } = req.body;

    // Validate amount
    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json(
          errorResponse('Amount must be greater than zero', 'invalid-argument'),
        );
    }

    // Get user's Stripe account ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.stripeAccountId) {
      return res
        .status(400)
        .json(
          errorResponse(
            'Stripe account not connected. Please connect your Stripe account first.',
            'failed-precondition',
          ),
        );
    }

    if (user.stripeAccountStatus !== 'active') {
      return res
        .status(400)
        .json(
          errorResponse(
            'Stripe account is not active. Please complete the onboarding process.',
            'failed-precondition',
          ),
        );
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

    let intentData = {
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      metadata: paymentMetadata,
      application_fee_amount: 5,
    };
    if (customerDetails.email) {
      intentData.receipt_email = customerDetails.email;
    }
    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create(intentData, {
      // Create PI inside the connected account
      stripeAccount: accountId,
    });

    if (!paymentIntent.client_secret) {
      return res
        .status(500)
        .json(
          errorResponse(
            'Failed to create payment intent: missing client secret',
          ),
        );
    }

    // Note: Payment intents are stored in Stripe, not in our database
    // We only store user and stripe_details

    res.json(
      successResponse(
        {
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
        },
        'Payment intent created successfully',
      ),
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Helper function to fetch charges from Stripe for a date range
 */
const fetchChargesFromStripe = async (
  accountId,
  startTimestamp,
  endTimestamp,
) => {
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

    const charges = await stripe.charges.list(params, {
      stripeAccount: accountId,
    });

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
const groupChargesByDate = charges => {
  const statsByDate = {};

  charges.forEach(charge => {
    const chargeDate = new Date(charge.created * 1000)
      .toISOString()
      .split('T')[0];
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
const calculateSummary = stats => {
  const totalPayments = stats.reduce((sum, stat) => sum + stat.count, 0);
  const totalAmount = stats.reduce((sum, stat) => sum + stat.totalAmount, 0); // In cents
  const averageAmount =
    totalPayments > 0 ? Math.round(totalAmount / totalPayments) : 0; // In cents

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
      selectedDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
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
      return res
        .status(400)
        .json(
          errorResponse(
            'Invalid date format. Use ISO date format (e.g., 2025-12-15)',
            'invalid-argument',
          ),
        );
    }

    // Get user's Stripe account ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.stripeAccountId) {
      return res
        .status(400)
        .json(
          errorResponse(
            'Stripe account not connected. Please connect your Stripe account first.',
            'failed-precondition',
          ),
        );
    }

    if (user.stripeAccountStatus !== 'active') {
      return res
        .status(400)
        .json(
          errorResponse(
            'Stripe account is not active. Please complete the onboarding process.',
            'failed-precondition',
          ),
        );
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

    console.log('single Day dates', {
      singleDayStartTimestamp,
      singleDayEndTimestamp,
    });
    // Fetch single day charges
    const singleDayCharges = await fetchChargesFromStripe(
      accountId,
      singleDayStartTimestamp,
      singleDayEndTimestamp,
    );

    // Fetch trend data charges (if requested)
    let trendCharges = [];
    if (shouldIncludeTrend) {
      trendCharges = await fetchChargesFromStripe(
        accountId,
        trendStartTimestamp,
        trendEndTimestamp,
      );
    }

    // Group charges by date
    const singleDayStatsByDate = groupChargesByDate(singleDayCharges);
    const trendStatsByDate = shouldIncludeTrend
      ? groupChargesByDate(trendCharges)
      : {};

    // Format single day stats
    const singleDayStats = fillMissingDays(
      singleDayStatsByDate,
      singleDayStart,
      singleDayEnd,
    );
    const singleDaySummary = calculateSummary(singleDayStats);

    // Format trend data stats
    let trendData = null;
    if (shouldIncludeTrend) {
      const trendStats = fillMissingDays(
        trendStatsByDate,
        trendStart,
        trendEnd,
      );
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

    res.json(
      successResponse(response, 'Payment statistics retrieved successfully'),
    );
  } catch (error) {
    console.error('Error fetching payment stats:', error);
    next(error);
  }
};

/**
 * Create payment intent from products using Invoice-based approach
 * POST /api/payments/create-intent-from-products
 *
 * This creates an Invoice with InvoiceItems for each product, then finalizes it
 * to generate a PaymentIntent. This approach ensures receipts include line items.
 */
const createPaymentIntentFromProducts = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { cartItems = [], customerDetails = {} } = req.body;

    // Validate cartItems
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res
        .status(400)
        .json(
          errorResponse(
            'cartItems must be a non-empty array',
            'invalid-argument',
          ),
        );
    }

    // Validate each cart item
    for (let i = 0; i < cartItems.length; i++) {
      const item = cartItems[i];
      if (!item.priceId || typeof item.priceId !== 'string') {
        return res
          .status(400)
          .json(
            errorResponse(
              `cartItems[${i}].priceId is required and must be a string`,
              'invalid-argument',
            ),
          );
      }
      if (
        !item.quantity ||
        typeof item.quantity !== 'number' ||
        item.quantity <= 0
      ) {
        return res
          .status(400)
          .json(
            errorResponse(
              `cartItems[${i}].quantity must be a positive number`,
              'invalid-argument',
            ),
          );
      }
    }

    // Get user's Stripe account ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.stripeAccountId) {
      return res
        .status(400)
        .json(
          errorResponse(
            'Stripe account not connected. Please connect your Stripe account first.',
            'failed-precondition',
          ),
        );
    }

    if (user.stripeAccountStatus !== 'active') {
      return res
        .status(400)
        .json(
          errorResponse(
            'Stripe account is not active. Please complete the onboarding process.',
            'failed-precondition',
          ),
        );
    }

    const accountId = user.stripeAccountId;

    // Step 1: Create or retrieve Stripe Customer if email provided
    let customerId = null;
    if (customerDetails.email) {
      try {
        // Try to find existing customer by email
        const existingCustomers = await stripe.customers.list(
          {
            email: customerDetails.email,
            limit: 1,
          },
          { stripeAccount: accountId },
        );

        if (existingCustomers.data.length > 0) {
          customerId = existingCustomers.data[0].id;
        } else {
          // Create new customer
          const customer = await stripe.customers.create(
            {
              email: customerDetails.email,
              name: customerDetails.name,
              phone: customerDetails.phone,
              address: customerDetails.zip
                ? { postal_code: customerDetails.zip }
                : undefined,
              metadata: {
                userId,
              },
            },
            { stripeAccount: accountId },
          );
          customerId = customer.id;
        }
      } catch (error) {
        console.error('Error creating/retrieving customer:', error);
        // Continue without customer if creation fails
        // Invoice can still be created without customer
      }
    }
    let invoice;
    try {
      invoice = await stripe.invoices.create(
        {
          customer: customerId,
          pending_invoice_items_behavior: 'include',
          auto_advance: false,
          // collection_method: 'charge_automatically',
          metadata: {
            userId,
            paymentType: 'products',
          },
        },
        { stripeAccount: accountId },
      );
    } catch (error) {
      console.error('Error creating invoice:', error);

      return res
        .status(500)
        .json(
          errorResponse(
            `Failed to create invoice: ${error.message}`,
            'internal-error',
          ),
        );
    }

    // Step 2: Validate prices and create InvoiceItems for the customer
    // InvoiceItems only accept one-time prices, not recurring prices
    // Create items as pending (without invoice) - they'll be added to invoice automatically
    const invoiceItemIds = [];
    for (const item of cartItems) {
      try {
        // First, retrieve the price to verify it's one-time
        const price = await stripe.prices.retrieve(item.priceId, {
          stripeAccount: accountId,
        });

        // Validate that price is one-time (not recurring)
        if (price.type !== 'one_time') {
          // Clean up already created items
          for (const itemId of invoiceItemIds) {
            try {
              await stripe.invoiceItems.del(itemId, {
                stripeAccount: accountId,
              });
            } catch (delError) {
              console.error(`Error deleting invoice item ${itemId}:`, delError);
            }
          }

          return res
            .status(400)
            .json(
              errorResponse(
                `Price ${item.priceId} is a recurring price. Only one-time prices are supported for Terminal payments.`,
                'invalid-argument',
              ),
            );
        }

        // Create invoice item for customer (without invoice - will be pending)
        // When invoice is created, it will automatically include these pending items
        const invoiceItem = await stripe.invoiceItems.create(
          {
            customer: customerId,
            price: item.priceId,
            quantity: item.quantity,
            invoice: invoice?.id,
            metadata: {
              userId,
            },
          },
          { stripeAccount: accountId },
        );
        invoiceItemIds.push(invoiceItem.id);
      } catch (error) {
        // If invoice item creation fails, clean up already created items
        console.error(
          `Error creating invoice item for priceId ${item.priceId}:`,
          error,
        );

        for (const itemId of invoiceItemIds) {
          try {
            await stripe.invoiceItems.del(itemId, { stripeAccount: accountId });
          } catch (delError) {
            console.error(`Error deleting invoice item ${itemId}:`, delError);
          }
        }

        // Return error with specific priceId
        const errorMessage = error.message || 'Unknown error';
        return res
          .status(400)
          .json(
            errorResponse(
              `Invalid priceId: ${item.priceId}. ${errorMessage}`,
              'invalid-argument',
            ),
          );
      }
    }

    console.log('invoiceItemIds', invoiceItemIds);

    // Step 3: Create Invoice (will automatically include pending invoice items)
    console.log('invoice.id', invoice.id);

    

    // Step 4: Finalize Invoice with auto_advance: true
    // This will attempt to charge and create a PaymentIntent
    let finalizedInvoice;
    try {
      finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id, {
        stripeAccount: accountId,
      });
    } catch (error) {
      console.log(
        'Invoice finalization attempted (may have failed to charge):',
        error.message,
      );
    }

    if (
      !finalizedInvoice.lines.data ||
      finalizedInvoice.lines.data.length === 0
    ) {
      return res
        .status(500)
        .json(
          errorResponse(
            'Invoice items were created but not attached to invoice. Please try again.',
            'internal-error',
          ),
        );
    }

    const invoiceTotal = finalizedInvoice.total; // Already in cents
    const invoiceCurrency = finalizedInvoice.currency || 'usd';

    if (invoiceTotal === 0) {
      return res
        .status(500)
        .json(
          errorResponse(
            'Invoice total is zero. Please ensure invoice has valid line items with one-time prices.',
            'internal-error',
          ),
        );
    }

    // Build metadata linking to invoice
    const paymentMetadata = {
      userId,
      invoiceId: invoice.id,
      paymentType: 'products',
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

    // Create PaymentIntent with card_present for Terminal
    let paymentIntent;
    try {
      const intentData = {
        amount: invoiceTotal, // Already in cents from invoice
        currency: invoiceCurrency,
        payment_method_types: ['card_present'], // Required for Terminal
        capture_method: 'automatic',
        metadata: paymentMetadata,
        application_fee_amount: 5,
        customer: customerId,
      };



      paymentIntent = await stripe.paymentIntents.create(intentData, {
        stripeAccount: accountId,
      });
      // Attach PaymentIntent to invoice
      // Try using the attachPayment method if available in SDK
      try {
        console.log('Attaching apyment itnent to nvoice ', paymentIntent.id);
        // Check if attachPayment method exists (it might be in newer SDK versions)
        await stripe.invoices.attachPayment(
          finalizedInvoice.id,
          {
            payment_intent: paymentIntent.id,
            expand: ['payments'],
          },
          {
            stripeAccount: accountId,
          },
        );
      } catch (attachError) {
        console.error('Error attaching PaymentIntent to invoice:', attachError);
        return res
          .status(500)
          .json(
            errorResponse(
              `Failed to create PaymentIntent for Terminal: ${attachError.message}`,
              'internal-error',
            ),
          );
        // Don't fail the request - invoice and PaymentIntent are linked via metadata
        // The attachment is optional for receipt purposes, but recommended
      }

      console.log('✅ Created PaymentIntent with card_present for Terminal');
      console.log('PaymentIntent ID:', paymentIntent.id);
      console.log('PaymentIntent amount:', paymentIntent.amount);
      console.log(
        'PaymentIntent payment_method_types:',
        paymentIntent.payment_method_types,
      );
    } catch (createError) {
      console.error(
        '❌ Error creating PaymentIntent for Terminal:',
        createError,
      );

  

      return res
        .status(500)
        .json(
          errorResponse(
            `Failed to create PaymentIntent for Terminal: ${createError.message}`,
            'internal-error',
          ),
        );
    }

    if (!paymentIntent.client_secret) {
      return res
        .status(500)
        .json(
          errorResponse(
            'PaymentIntent created but missing client_secret',
            'internal-error',
          ),
        );
    }

    // Return response with client_secret and invoice ID for reference
    // Note: We use a separate PaymentIntent for Terminal (with card_present)
    // while the invoice exists for receipts with line items
    res.json(
      successResponse(
        {
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          invoiceId: finalizedInvoice.id, // Invoice ID for receipt reference
        },
        'Payment intent created from products successfully',
      ),
    );
  } catch (error) {
    console.error('Error in createPaymentIntentFromProducts:', error);
    next(error);
  }
};

module.exports = {
  createPaymentIntent,
  createPaymentIntentFromProducts,
  getPaymentStats,
};
