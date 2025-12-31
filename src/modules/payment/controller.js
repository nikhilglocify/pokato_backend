const { successResponse, errorResponse } = require('../../utils/response.js');
const {
  validateStripeAccount,
  createPaymentIntentService,
  findOrCreateCustomerService,
  createInvoiceService,
  createInvoiceItemsService,
  finalizeInvoiceService,
  attachPaymentIntentToInvoiceService,
  createPaymentIntentFromInvoiceService,
  buildPaymentMetadata,
  getPaymentStatsService,
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

    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);

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

    // Step 4: Finalize invoice
    const finalizedInvoice = await finalizeInvoiceService(accountId, invoice.id);

    // Step 5: Build payment metadata
    const paymentMetadata = buildPaymentMetadata(
      userId,
      {
        invoiceId: invoice.id,
        paymentType: 'products',
      },
      customerDetails
    );

    // Step 6: Create PaymentIntent from invoice
    const paymentIntent = await createPaymentIntentFromInvoiceService(
      accountId,
      finalizedInvoice,
      paymentMetadata,
      customerId
    );

    // Step 7: Try to attach PaymentIntent to invoice (optional, for receipts)
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

module.exports = {
  createPaymentIntent,
  createPaymentIntentFromProducts,
  getPaymentStats,
};
