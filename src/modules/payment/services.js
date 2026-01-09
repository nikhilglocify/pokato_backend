const { stripe } = require('../../config/stripe.js');
const prisma = require('../../config/database.js');

/**
 * Ensure location has tipping configuration for internet readers
 * This function checks if the reader's location has a tipping config,
 * and creates one if it doesn't exist.
 * 
 * @param {string} accountId - Stripe account ID
 * @param {string} readerId - Reader ID (optional, only needed if locationId not provided)
 * @param {string} connectionType - Connection type (internet, tapToPay, bluetooth)
 * @param {string} locationId - Location ID (optional, if provided skips reader retrieval)
 * @returns {Promise<void>}
 */
const ensureLocationTippingConfig = async (accountId, readerId, connectionType, locationId) => {
  try {
    // Only process for internet readers
    if (connectionType !== 'internet') {
      console.log(`⏭️ Skipping tipping config setup - connection type is ${connectionType}, not internet`);
      return;
    }

    // If locationId is provided, use it directly; otherwise retrieve from reader
    let finalLocationId = locationId;

    if (!finalLocationId) {
      if (!readerId) {
        console.log('⚠️ No reader ID or location ID provided, skipping tipping config setup');
        return;
      }

      console.log(`🔧 No locationId provided, retrieving reader ${readerId} to get location...`);

      // Step 1: Retrieve reader to get location ID
      let reader;
      try {
        reader = await stripe.terminal.readers.retrieve(
          readerId,
          { stripeAccount: accountId }
        );
        console.log(`✅ Reader retrieved: ${reader.id}, location: ${reader.location}`);
      } catch (readerError) {
        console.warn(`⚠️ Failed to retrieve reader ${readerId}:`, readerError.message);
        return; // Continue with payment creation
      }

      if (!reader.location) {
        console.warn('⚠️ Reader has no location assigned, skipping tipping config setup');
        return;
      }

      finalLocationId = reader.location;
    } else {
      console.log(`🔧 Using provided locationId: ${finalLocationId}, skipping reader retrieval`);
    }

    // Step 2: Retrieve location to check for existing config
    let location;
    try {
      location = await stripe.terminal.locations.retrieve(
        finalLocationId,
        { stripeAccount: accountId }
      );
      console.log("locationData",location)
      console.log(`✅ Location retrieved: ${location.id}, display_name: ${location.display_name}`);
    } catch (locationError) {
      console.warn(`⚠️ Failed to retrieve location ${finalLocationId}:`, locationError.message);
      return; // Continue with payment creation
    }


    // Step 3: Check if location already has a configuration
    if (location.configuration_overrides) {
      console.log(`✅ Location already has tipping config: ${location.configuration_overrides}`);
      return; // Config exists, reuse it
    }

    console.log('🆕 No tipping config found, creating new configuration...');

    // Step 4: Create new tipping configuration
    let configuration;
    try {
      configuration = await stripe.terminal.configurations.create(
        {
          tipping: {
            usd: {
              percentages: [15, 20, 25],
              fixed_amounts: [100, 200, 300], // $1, $2, $3 in cents
              smart_tip_threshold: 1000, // $10 in cents
            },
          },
        },
        { stripeAccount: accountId }
      );
      console.log(`✅ Tipping configuration created: ${configuration.id}`);
    } catch (configError) {
      console.warn('⚠️ Failed to create tipping configuration:', configError.message);
      return; // Continue with payment creation
    }

    // Step 5: Update location with new configuration
    try {
      await stripe.terminal.locations.update(
        finalLocationId,
        {
          configuration_overrides: configuration.id,
        },
        { stripeAccount: accountId }
      );
      console.log(`✅ Location updated with tipping config: ${configuration.id}`);
    } catch (updateError) {
      console.warn(`⚠️ Failed to update location with config:`, updateError.message);
      // Continue with payment creation even if update fails
    }

  } catch (error) {
    // Catch any unexpected errors and log them
    console.error('❌ Unexpected error in ensureLocationTippingConfig:', error);
    // Don't throw - continue with payment creation
  }
};

/**
 * Validate user has an active Stripe account
 * @param {string} userId - User ID
 * @returns {Promise<string>} Stripe account ID
 * @throws {Error} If account is not connected or not active (with statusCode 400)
 */
const validateStripeAccount = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user?.stripeAccountId) {
    const error = new Error('Stripe account not connected. Please connect your Stripe account first.');
    error.statusCode = 400;
    error.code = 'failed-precondition';
    throw error;
  }

  if (user.stripeAccountStatus !== 'active') {
    const error = new Error('Stripe account is not active. Please complete the onboarding process.');
    error.statusCode = 400;
    error.code = 'failed-precondition';
    throw error;
  }

  return user.stripeAccountId;
};

/**
 * Build payment metadata from customer details and user ID
 * @param {string} userId - User ID
 * @param {object} metadata - Additional metadata
 * @param {object} customerDetails - Customer details
 * @returns {object} Payment metadata object
 */
const buildPaymentMetadata = (userId, metadata = {}, customerDetails = {}) => {
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

  return paymentMetadata;
};

/**
 * Create payment intent for Terminal payment
 * @param {string} accountId - Stripe account ID
 * @param {object} paymentData - Payment data
 * @param {number} paymentData.amount - Amount in dollars
 * @param {string} paymentData.currency - Currency code
 * @param {object} paymentData.metadata - Additional metadata
 * @param {object} paymentData.customerDetails - Customer details
 * @param {object|null} paymentData.tippingConfig - Tipping configuration
 * @returns {Promise<object>} Payment intent with clientSecret and id
 */
const createPaymentIntentService = async (accountId, paymentData) => {
  try {
    const { 
      amount, 
      currency = 'usd', 
      metadata = {}, 
      customerDetails = {}
    } = paymentData

    // Build metadata with customer details
    const paymentMetadata = buildPaymentMetadata(
      paymentData.userId,
      metadata,
      customerDetails
    );

    const intentData = {
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
      stripeAccount: accountId,
    });

    if (!paymentIntent.client_secret) {
      const error = new Error('Failed to create payment intent: missing client secret');
      error.statusCode = 500;
      throw error;
    }

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  } catch (error) {
    throw new Error(error.message || 'Error creating payment intent');
  }
};

/**
 * Find or create Stripe customer
 * @param {string} accountId - Stripe account ID
 * @param {object} customerDetails - Customer details
 * @param {string} customerDetails.email - Customer email
 * @param {string} customerDetails.name - Customer name
 * @param {string} customerDetails.phone - Customer phone
 * @param {string} customerDetails.zip - Customer zip code
 * @param {string} userId - User ID for metadata
 * @returns {Promise<string|null>} Customer ID or null if email not provided
 */
const findOrCreateCustomerService = async (accountId, customerDetails, userId) => {
  try {
    if (!customerDetails.email) {
      throw new Error('Email is required to create a customer');
    
    }

    // Try to find existing customer by email
    const existingCustomers = await stripe.customers.list(
      {
        email: customerDetails.email,
        limit: 1,
      },
      { stripeAccount: accountId }
    );

    if (existingCustomers.data.length > 0) {
      return existingCustomers.data[0].id;
    }

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
      { stripeAccount: accountId }
    );

    return customer.id;
  } catch (error) {
    // Log error but don't throw - invoice can still be created without customer
    console.error('Error creating/retrieving customer:', error);
    throw new Error(error.message || 'Error creating/retrieving customer');
    // return null;
  }
};

/**
 * Create Stripe invoice
 * @param {string} accountId - Stripe account ID
 * @param {string|null} customerId - Customer ID (optional)
 * @param {string} userId - User ID for metadata
 * @returns {Promise<object>} Created invoice object
 */
const createInvoiceService = async (accountId, customerId, userId) => {
  try {
    const invoice = await stripe.invoices.create(
      {
        customer: customerId,
        pending_invoice_items_behavior: 'include',
        auto_advance: false,
        collection_method: 'send_invoice',
        due_date: Math.floor(Date.now() / 1000) + 86400, // 1 day from now
        metadata: {
          userId,
          paymentType: 'products',
        },
      },
      { stripeAccount: accountId }
    );

    return invoice;
  } catch (error) {
    throw new Error(error.message || 'Error creating invoice');
  }
};

/**
 * Retrieve and validate price is one-time
 * @param {string} accountId - Stripe account ID
 * @param {string} priceId - Price ID to validate
 * @returns {Promise<object>} Price object
 * @throws {Error} If price is not one-time
 */
const validatePriceIsOneTime = async (accountId, priceId) => {
  try {
    const price = await stripe.prices.retrieve(priceId, {
      stripeAccount: accountId,
    });

    if (price.type !== 'one_time') {
      const error = new Error(
        `Price ${priceId} is a recurring price. Only one-time prices are supported for Terminal payments.`
      );
      error.statusCode = 400;
      error.code = 'invalid-argument';
      throw error;
    }

    return price;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new Error(error.message || 'Error validating price');
  }
};

/**
 * Create invoice item
 * @param {string} accountId - Stripe account ID
 * @param {object} itemData - Invoice item data
 * @param {string} itemData.customerId - Customer ID
 * @param {string} itemData.priceId - Price ID
 * @param {number} itemData.quantity - Quantity
 * @param {string} itemData.invoiceId - Invoice ID
 * @param {string} itemData.userId - User ID for metadata
 * @returns {Promise<object>} Created invoice item
 */
const createInvoiceItemService = async (accountId, itemData) => {
  try {
    const { customerId, priceId, quantity, invoiceId, userId } = itemData;

    const invoiceItem = await stripe.invoiceItems.create(
      {
        customer: customerId,
        price: priceId,
        quantity: quantity,
        invoice: invoiceId,
        metadata: {
          userId,
        },
      },
      { stripeAccount: accountId }
    );

    return invoiceItem;
  } catch (error) {
    throw new Error(error.message || 'Error creating invoice item');
  }
};

/**
 * Delete invoice item
 * @param {string} accountId - Stripe account ID
 * @param {string} itemId - Invoice item ID
 */
const deleteInvoiceItemService = async (accountId, itemId) => {
  try {
    await stripe.invoiceItems.del(itemId, { stripeAccount: accountId });
  } catch (error) {
    console.error(`Error deleting invoice item ${itemId}:`, error);
    throw error;
  }
};

/**
 * Create invoice items for cart items
 * @param {string} accountId - Stripe account ID
 * @param {string} invoiceId - Invoice ID
 * @param {string|null} customerId - Customer ID
 * @param {Array} cartItems - Cart items array
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of invoice item IDs
 */
const createInvoiceItemsService = async (accountId, invoiceId, customerId, cartItems, userId) => {
  const invoiceItemIds = [];

  for (const item of cartItems) {
    try {
      // Validate price is one-time
      await validatePriceIsOneTime(accountId, item.priceId);

      // Create invoice item
      const invoiceItem = await createInvoiceItemService(accountId, {
        customerId,
        priceId: item.priceId,
        quantity: item.quantity,
        invoiceId,
        userId,
      });

      invoiceItemIds.push(invoiceItem.id);
    } catch (error) {
      // Clean up already created items
      for (const itemId of invoiceItemIds) {
        try {
          await deleteInvoiceItemService(accountId, itemId);
        } catch (delError) {
          console.error(`Error deleting invoice item ${itemId}:`, delError);
        }
      }

      // Re-throw error with context
      const errorMessage = error.message || 'Unknown error';
      const enhancedError = new Error(`Invalid priceId: ${item.priceId}. ${errorMessage}`);
      enhancedError.statusCode = error.statusCode || 400;
      enhancedError.code = error.code || 'invalid-argument';
      throw enhancedError;
    }
  }

  return invoiceItemIds;
};

/**
 * Finalize Stripe invoice
 * @param {string} accountId - Stripe account ID
 * @param {string} invoiceId - Invoice ID
 * @returns {Promise<object>} Finalized invoice object
 */
const finalizeInvoiceService = async (accountId, invoiceId) => {
  try {
    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoiceId, {
      stripeAccount: accountId,
    });

    if (!finalizedInvoice.lines.data || finalizedInvoice.lines.data.length === 0) {
      const error = new Error(
        'Invoice items were created but not attached to invoice. Please try again.'
      );
      error.statusCode = 500;
      throw error;
    }

    const invoiceTotal = finalizedInvoice.total; // Already in cents
    if (invoiceTotal === 0) {
      const error = new Error(
        'Invoice total is zero. Please ensure invoice has valid line items with one-time prices.'
      );
      error.statusCode = 500;
      throw error;
    }

    return finalizedInvoice;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    // Log but don't fail if finalization has issues
    console.error('Invoice finalization attempted (may have failed to charge):', error.message);
    throw new Error(error.message || 'Error finalizing invoice');
  }
};

/**
 * Attach payment intent to invoice
 * @param {string} accountId - Stripe account ID
 * @param {string} invoiceId - Invoice ID
 * @param {string} paymentIntentId - Payment intent ID
 * @returns {Promise<object>} Updated invoice object
 */
const attachPaymentIntentToInvoiceService = async (accountId, invoiceId, paymentIntentId) => {
  try {
    await stripe.invoices.attachPayment(
      invoiceId,
      {
        payment_intent: paymentIntentId,
        expand: ['payments'],
      },
      {
        stripeAccount: accountId,
      }
    );
  } catch (error) {
    // Attachment is optional for receipt purposes, but log the error
    console.error('Error attaching PaymentIntent to invoice:', error);
    const attachError = new Error(`Failed to attach PaymentIntent to invoice: ${error.message}`);
    attachError.statusCode = 500;
    throw attachError;
  }
};

/**
 * Create payment intent from invoice
 * @param {string} accountId - Stripe account ID
 * @param {object} invoiceData - Invoice data
 * @param {number} invoiceData.total - Invoice total in cents
 * @param {string} invoiceData.currency - Invoice currency
 * @param {string} invoiceData.id - Invoice ID
 * @param {object} paymentMetadata - Payment metadata
 * @param {string|null} customerId - Customer ID
 * @param {object|null} tippingConfig - Tipping configuration
 * @returns {Promise<object>} Payment intent with clientSecret and id
 */
const createPaymentIntentFromInvoiceService = async (
  accountId,
  invoiceData,
  paymentMetadata,
  customerId
) => {
  try {
    const { total, currency } = invoiceData;

    const intentData = {
      amount: total, // Already in cents from invoice
      currency: currency || 'usd',
      payment_method_types: ['card_present'], // Required for Terminal
      capture_method: 'automatic',
      metadata: paymentMetadata,
      application_fee_amount: 5,
      customer: customerId,
    };

    const paymentIntent = await stripe.paymentIntents.create(intentData, {
      stripeAccount: accountId,
    });

    if (!paymentIntent.client_secret) {
      const error = new Error('PaymentIntent created but missing client_secret');
      error.statusCode = 500;
      throw error;
    }

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new Error(error.message || 'Error creating payment intent from invoice');
  }
};

/**
 * Fetch charges from Stripe for a date range
 * @param {string} accountId - Stripe account ID
 * @param {number} startTimestamp - Start timestamp (Unix seconds)
 * @param {number} endTimestamp - End timestamp (Unix seconds)
 * @returns {Promise<Array>} Array of charge objects
 */
const fetchChargesFromStripeService = async (accountId, startTimestamp, endTimestamp) => {
  try {
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
  } catch (error) {
    throw new Error(error.message || 'Error fetching charges from Stripe');
  }
};

/**
 * Group charges by date
 * @param {Array} charges - Array of charge objects
 * @returns {object} Object with date keys and stats objects
 */
const groupChargesByDateService = (charges) => {
  const statsByDate = {};

  charges.forEach((charge) => {
    const chargeDate = new Date(charge.created * 1000)
      .toISOString()
      .split('T')[0];
    if (!statsByDate[chargeDate]) {
      statsByDate[chargeDate] = {
        date: chargeDate,
        count: 0,
        totalAmount: 0, // In cents (includes tips)
        successful: 0,
        failed: 0,
        totalTips: 0, // Total tips in cents
      };
    }
    
    // Extract tip amount from metadata or amount_details
    const tipAmount = charge.metadata?.tipAmount 
      ? parseInt(charge.metadata.tipAmount, 10) 
      : (charge.amount_details?.tip?.amount || 0);
    
    statsByDate[chargeDate].count += 1;
    statsByDate[chargeDate].totalAmount += charge.amount; // Keep in cents
    statsByDate[chargeDate].totalTips += tipAmount; // Track tips separately
    
    if (charge.status === 'succeeded' && charge.paid) {
      statsByDate[chargeDate].successful += 1;
    } else {
      statsByDate[chargeDate].failed += 1;
    }
  });

  return statsByDate;
};

/**
 * Calculate summary from stats array
 * @param {Array} stats - Array of stats objects
 * @returns {object} Summary object with totalPayments, totalAmount, averageAmount, totalTips
 */
const calculateSummaryService = (stats) => {
  const totalPayments = stats.reduce((sum, stat) => sum + stat.count, 0);
  const totalAmount = stats.reduce((sum, stat) => sum + stat.totalAmount, 0); // In cents
  const totalTips = stats.reduce((sum, stat) => sum + (stat.totalTips || 0), 0); // In cents
  const averageAmount =
    totalPayments > 0 ? Math.round(totalAmount / totalPayments) : 0; // In cents

  return {
    totalPayments,
    totalAmount, // In cents (includes tips)
    averageAmount, // In cents
    totalTips, // In cents
  };
};

/**
 * Fill missing days with zeros
 * @param {object} statsByDate - Stats object with date keys
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Array} Array of stats objects with all days filled
 */
const fillMissingDaysService = (statsByDate, startDate, endDate) => {
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
        totalTips: 0, // Include totalTips in filled days
      });
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return filledStats;
};

/**
 * Parse date string to UTC Date object
 * @param {string|null} dateString - Date string in YYYY-MM-DD format
 * @returns {Date} UTC Date object at start of day
 */
const parseDateToUTC = (dateString) => {
  if (dateString) {
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day)); // month is 0-indexed
    date.setUTCHours(0, 0, 0, 0);
    return date;
  } else {
    // Use "today" in UTC
    const now = new Date();
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }
};

/**
 * Get payment statistics for a date with trend data
 * @param {string} accountId - Stripe account ID
 * @param {object} queryParams - Query parameters
 * @param {string|null} queryParams.date - Date string (YYYY-MM-DD)
 * @param {string|boolean} queryParams.includeTrend - Whether to include trend data
 * @param {string|number} queryParams.days - Number of days for trend
 * @returns {Promise<object>} Payment statistics object
 */
const getPaymentStatsService = async (accountId, queryParams) => {
  try {
    const { date, includeTrend = 'true', days = '7' } = queryParams;

    // Parse date
    const selectedDate = parseDateToUTC(date);

    // Validate date
    if (isNaN(selectedDate.getTime())) {
      const error = new Error('Invalid date format. Use ISO date format (e.g., 2025-12-15)');
      error.statusCode = 400;
      error.code = 'invalid-argument';
      throw error;
    }

    // Parse days parameter
    const trendDays = Math.max(1, parseInt(days, 10) || 7);
    const shouldIncludeTrend = includeTrend === 'true' || includeTrend === true;

    // Calculate date ranges (UTC boundaries)
    const singleDayStart = new Date(selectedDate);
    singleDayStart.setUTCHours(0, 0, 0, 0);
    const singleDayEnd = new Date(selectedDate);
    singleDayEnd.setUTCHours(23, 59, 59, 999);

    const trendStart = new Date(selectedDate);
    trendStart.setUTCDate(trendStart.getUTCDate() - (trendDays - 1));
    trendStart.setUTCHours(0, 0, 0, 0);
    const trendEnd = new Date(selectedDate);
    trendEnd.setUTCHours(23, 59, 59, 999);

    // Convert to Unix timestamps (seconds)
    const singleDayStartTimestamp = Math.floor(singleDayStart.getTime() / 1000);
    const singleDayEndTimestamp = Math.floor(singleDayEnd.getTime() / 1000);
    const trendStartTimestamp = Math.floor(trendStart.getTime() / 1000);
    const trendEndTimestamp = Math.floor(trendEnd.getTime() / 1000);

    // Fetch charges
    const singleDayCharges = await fetchChargesFromStripeService(
      accountId,
      singleDayStartTimestamp,
      singleDayEndTimestamp
    );

    let trendCharges = [];
    if (shouldIncludeTrend) {
      trendCharges = await fetchChargesFromStripeService(
        accountId,
        trendStartTimestamp,
        trendEndTimestamp
      );
    }

    // Group charges by date
    const singleDayStatsByDate = groupChargesByDateService(singleDayCharges);
    const trendStatsByDate = shouldIncludeTrend
      ? groupChargesByDateService(trendCharges)
      : {};

    // Format stats
    const singleDayStats = fillMissingDaysService(
      singleDayStatsByDate,
      singleDayStart,
      singleDayEnd
    );
    const singleDaySummary = calculateSummaryService(singleDayStats);

    // Format trend data
    let trendData = null;
    if (shouldIncludeTrend) {
      const trendStats = fillMissingDaysService(
        trendStatsByDate,
        trendStart,
        trendEnd
      );
      const trendSummary = calculateSummaryService(trendStats);

      trendData = {
        days: trendDays,
        stats: trendStats,
        summary: trendSummary,
      };
    }

    // Build response
    return {
      singleDay: {
        stats: singleDayStats,
        summary: singleDaySummary,
      },
      trendData,
    };
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new Error(error.message || 'Error getting payment statistics');
  }
};

/**
 * Get transactions (charges) for a specific date
 * @param {string} accountId - Stripe account ID
 * @param {string|null} date - Date string in YYYY-MM-DD format (optional, defaults to today)
 * @returns {Promise<Array>} Array of charge/transaction objects
 */
const getTransactionsService = async (accountId, date = null) => {
  try {
    // Parse date to UTC
    const selectedDate = parseDateToUTC(date);

    // Validate date
    if (isNaN(selectedDate.getTime())) {
      const error = new Error('Invalid date format. Use ISO date format (e.g., 2025-12-15)');
      error.statusCode = 400;
      error.code = 'invalid-argument';
      throw error;
    }

    // Calculate date range for the selected day (UTC boundaries)
    const dayStart = new Date(selectedDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(selectedDate);
    dayEnd.setUTCHours(23, 59, 59, 999);

    // Convert to Unix timestamps (seconds)
    const startTimestamp = Math.floor(dayStart.getTime() / 1000);
    const endTimestamp = Math.floor(dayEnd.getTime() / 1000);

    // Fetch charges for the day
    const charges = await fetchChargesFromStripeService(
      accountId,
      startTimestamp,
      endTimestamp
    );

    // Sort charges by created time (newest first)
    const sortedCharges = charges.sort((a, b) => b.created - a.created);

    // Map charges to transaction format with refunded status and tip details
    return sortedCharges.map(charge => {
      // Extract tip amount from metadata or amount_details
      const tipAmount = charge.metadata?.tipAmount 
        ? parseInt(charge.metadata.tipAmount, 10) 
        : (charge.amount_details?.tip?.amount || 0);
      
      const tippingMethod = charge.metadata?.tippingMethod || null;
      const baseAmount = charge.amount - tipAmount;

      return {
        id: charge.id,
        amount: charge.amount, // Total amount in cents
        currency: charge.currency,
        status: charge.status,
        created: charge.created,
        customer: charge.customer,
        payment_method: charge.payment_method,
        receipt_url: charge.receipt_url,
        description: charge.description,
        receipt_email: charge.receipt_email || charge.billing_details?.email || charge.metadata?.customerEmail || null,
        customerEmail: charge.billing_details?.email || charge.metadata?.customerEmail || null,
        customerName: charge.billing_details?.name || charge.metadata?.customerName || null,
        paid: charge.paid || false,
        refunded: charge.refunded || charge.amount_refunded > 0 || false,
        metadata: charge.metadata || {},
        // Tip details
        tipAmount, // Tip amount in cents
        tippingMethod, // 'on-reader', 'app-based', or null
        baseAmount, // Base amount (excluding tip) in cents
      };
    });
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw new Error(error.message || 'Error getting transactions');
  }
};

/**
 * Fetch a charge from Stripe
 * @param {string} accountId - Stripe account ID
 * @param {string} chargeId - Charge ID
 * @returns {Promise<object>} Charge object
 */
const getChargeService = async (accountId, chargeId) => {
  try {
    const charge = await stripe.charges.retrieve(chargeId, {
      stripeAccount: accountId,
    });
    return charge;
  } catch (error) {
    throw new Error(error.message || 'Error fetching charge from Stripe');
  }
};

/**
 * Create a refund for a charge
 * @param {string} accountId - Stripe account ID
 * @param {string} chargeId - Charge ID to refund
 * @param {object} refundData - Refund data
 * @param {number|null} refundData.amount - Amount to refund in cents (optional, null for full refund)
 * @param {string} refundData.reason - Refund reason (optional: 'duplicate', 'fraudulent', 'requested_by_customer')
 * @returns {Promise<object>} Refund object
 */
const createRefundService = async (accountId, chargeId, refundData = {}) => {
  try {
    const { amount = null, reason = null } = refundData;

    // Build refund parameters
    const refundParams = {
      charge: chargeId,
    };

    // Add amount if specified (partial refund)
    if (amount && amount > 0) {
      refundParams.amount = Math.round(amount);
    }

    // Add reason if specified
    if (reason && ['duplicate', 'fraudulent', 'requested_by_customer'].includes(reason)) {
      refundParams.reason = reason;
    }

    // Create refund
    const refund = await stripe.refunds.create(refundParams, {
      stripeAccount: accountId,
    });

    return {
      id: refund.id,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      charge: refund.charge,
      created: refund.created,
      reason: refund.reason,
    };
  } catch (error) {
    throw new Error(error.message || 'Error creating refund');
  }
};

module.exports = {
  validateStripeAccount,
  buildPaymentMetadata,
  ensureLocationTippingConfig,
  createPaymentIntentService,
  findOrCreateCustomerService,
  createInvoiceService,
  validatePriceIsOneTime,
  createInvoiceItemService,
  deleteInvoiceItemService,
  createInvoiceItemsService,
  finalizeInvoiceService,
  attachPaymentIntentToInvoiceService,
  createPaymentIntentFromInvoiceService,
  fetchChargesFromStripeService,
  groupChargesByDateService,
  calculateSummaryService,
  fillMissingDaysService,
  getPaymentStatsService,
  getTransactionsService,
  createRefundService,
  getChargeService,
};

