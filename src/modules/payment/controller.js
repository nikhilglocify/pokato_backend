const { successResponse, errorResponse } = require('../../utils/response.js');
const {
  validateStripeAccount,
  ensureLocationTippingConfig,
  createPaymentIntentService,
  findOrCreateCustomerService,
  createInvoiceService,
  createInvoiceItemsService,
  addTipLineItemService,
  finalizeInvoiceService,
  attachPaymentIntentToInvoiceService,
  createPaymentIntentFromInvoiceService,
  buildPaymentMetadata,
  getPaymentStatsService,
  getTransactionsService,
  createRefundService,
  getChargeService,
} = require('./services.js');

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
      readerId,
      connectionType,
      locationId,
    } = req.body;

    // Validate amount
    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json(
          errorResponse('Amount must be greater than zero', 'invalid-argument'),
        );
    }


    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);

    // Ensure location has tipping config for internet readers
    await ensureLocationTippingConfig(accountId, readerId, connectionType, locationId);

    // Call service to create payment intent
    const result = await createPaymentIntentService(accountId, {
      amount,
      currency,
      metadata,
      customerDetails,
      userId,
    });

    res.json(successResponse(result, 'Payment intent created successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Get payment statistics for a date with trend data
 * GET /api/payments/stats?date=2025-12-15&includeTrend=true&days=7
 */
const getPaymentStats = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { date, includeTrend = 'true', days = '7' } = req.query;

    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);

    // Call service to get payment statistics
    const stats = await getPaymentStatsService(accountId, {
      date,
      includeTrend,
      days,
    });

    res.json(
      successResponse(stats, 'Payment statistics retrieved successfully'),
    );
  } catch (error) {
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
    const { 
      cartItems = [], 
      customerDetails = {},
      tipAmount = 0,
      readerId,
      connectionType,
      locationId,
    } = req.body;

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

    // Validate tipAmount if provided
    if (tipAmount && (typeof tipAmount !== 'number' || tipAmount < 0)) {
      return res
        .status(400)
        .json(
          errorResponse(
            'tipAmount must be a non-negative number',
            'invalid-argument',
          ),
        );
    }

    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);

    // Ensure location has tipping config for internet readers
    await ensureLocationTippingConfig(accountId, readerId, connectionType, locationId);

    // Step 1: Create or retrieve Stripe Customer if email provided
    const customerId = await findOrCreateCustomerService(
      accountId,
      customerDetails,
      userId
    );

    // Step 2: Create invoice
    const invoice = await createInvoiceService(accountId, customerId, userId);

    // Step 3: Create invoice items (validates prices and creates items)
    await createInvoiceItemsService(
      accountId,
      invoice.id,
      customerId,
      cartItems,
      userId
    );

    // Step 4: Add tip as line item if provided
    if (tipAmount > 0) {
      await addTipLineItemService(
        accountId,
        invoice.id,
        customerId,
        tipAmount,
        userId
      );
    }

    // Step 5: Finalize invoice
    const finalizedInvoice = await finalizeInvoiceService(accountId, invoice.id);

    // Step 6: Build payment metadata (include tip info if present)
    const paymentMetadata = buildPaymentMetadata(
      userId,
      {
        invoiceId: invoice.id,
        paymentType: 'products',
        tipAmount: tipAmount > 0 ? tipAmount : undefined,
        tippingMethod: tipAmount > 0 ? 'app-based' : undefined,
      },
      customerDetails
    );

    // Step 7: Create PaymentIntent from invoice
    const paymentIntent = await createPaymentIntentFromInvoiceService(
      accountId,
      finalizedInvoice,
      paymentMetadata,
      customerId
    );

    // Step 8: Try to attach PaymentIntent to invoice (optional, for receipts)
    try {
      await attachPaymentIntentToInvoiceService(
        accountId,
        finalizedInvoice.id,
        paymentIntent.paymentIntentId
      );
    } catch (attachError) {
      // Attachment is optional - log but don't fail
      console.error('Error attaching PaymentIntent to invoice:', attachError);
    }

    // Return response with client_secret and invoice ID for reference
    res.json(
      successResponse(
        {
          clientSecret: paymentIntent.clientSecret,
          paymentIntentId: paymentIntent.paymentIntentId,
          invoiceId: finalizedInvoice.id, // Invoice ID for receipt reference
        },
        'Payment intent created from products successfully',
      ),
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get transactions for a specific date
 * GET /api/payments/transactions?date=2025-12-15
 */
const getTransactions = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { date } = req.query;

    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);
                                    
    // Call service to get transactions
    const transactions = await getTransactionsService(accountId, date || null);

    res.json(
      successResponse(transactions, 'Transactions retrieved successfully'),
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Create a refund for a transaction
 * POST /api/payments/refund
 */
const createRefund = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { chargeId, reason } = req.body;

    // Input validation
    if (!chargeId || typeof chargeId !== 'string') {
      return res
        .status(400)
        .json(
          errorResponse('chargeId is required and must be a string', 'invalid-argument'),
        );
    }

    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);

    // Fetch charge from Stripe to get the amount
    const charge = await getChargeService(accountId, chargeId);
    const chargeAmount = charge.amount; // Amount in cents
    const amountRefunded = charge.amount_refunded || 0; // Already refunded amount
    const availableAmount = chargeAmount - amountRefunded; // Available amount for refund

    // Validate amount if provided (must be positive and not exceed available amount)
    // let refundAmount = null;
    // if (amount !== undefined && amount !== null) {
    //   if (typeof amount !== 'number' || amount <= 0) {
    //     return res
    //       .status(400)
    //       .json(
    //         errorResponse('Amount must be a positive number', 'invalid-argument'),
    //       );
    //   }
    //   if (amount > availableAmount) {
    //     return res
    //       .status(400)
    //       .json(
    //         errorResponse(
    //           `Amount exceeds available refund amount. Available: ${availableAmount / 100} ${charge.currency.toUpperCase()}`,
    //           'invalid-argument',
    //         ),
    //       );
    //   }
    //   refundAmount = Math.round(amount);
    // }

    // Validate reason if provided
    if (reason && !['duplicate', 'fraudulent', 'requested_by_customer'].includes(reason)) {
      return res
        .status(400)
        .json(
          errorResponse(
            'Reason must be one of: duplicate, fraudulent, requested_by_customer',
            'invalid-argument',
          ),
        );
    }

    // Call service to create refund
    const refund = await createRefundService(accountId, chargeId, {
      amount: availableAmount,
      reason: reason || null,
    });

    res.json(successResponse(refund, 'Refund processed successfully'));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createPaymentIntent,
  createPaymentIntentFromProducts,
  getPaymentStats,
  getTransactions,
  createRefund,
};
