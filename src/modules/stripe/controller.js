const { successResponse, errorResponse } = require('../../utils/response.js');
const { generateToken } = require('../../middleware/auth.js');
const {
  validateStripeAccount,
  createConnectionTokenService,
  checkExistingAccount,
  generateOAuthUrl,
  handleOAuthCallbackService,
  getAccountStatusService,
} = require('./services.js');

/**
 * Create connection token for Stripe Terminal
 * POST /api/stripe/connection-token
 */
const createConnectionToken = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // Validate Stripe account and get account ID
    const accountId = await validateStripeAccount(userId);

    // Call service to create connection token
    const connectionToken = await createConnectionTokenService(accountId);

    res.json(successResponse(connectionToken, 'Connection token created successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Get Stripe OAuth authorization URL
 * GET /api/stripe/oauth-url
 */
const getOAuthUrl = async (req, res, next) => {
  try {
    const { returnUrl } = req.query;

    // If user is authenticated, check if account already connected
    if (req.user) {
      const user = await checkExistingAccount(req.user.userId);

      if (user) {
        const token = generateToken({
          userId: user.id,
          email: user.email,
        });
        return res.json(successResponse({
          url: null,
          alreadyConnected: true,
          accountId: user.stripeAccountId,
          userId: user.id, // Include userId for frontend
          email: user.email, // Include email for frontend
          status: user.stripeAccountStatus,
          chargesEnabled: user.stripeDetails?.charges_enabled,
          detailsSubmitted: user.stripeDetails?.details_submitted,
          token // JWT token instead of Firebase custom token
        }, 'Stripe account already connected'));
      }
    }

    // Generate OAuth URL
    const oauthUrl = await generateOAuthUrl(returnUrl);

    res.json(successResponse({
      url: oauthUrl,
      alreadyConnected: false,
    }, 'OAuth URL generated successfully'));
  } catch (error) {
    next(error);
  }
};

/**
 * Handle Stripe OAuth callback
 * POST /api/stripe/oauth-callback
 */
const handleOAuthCallback = async (req, res, next) => {
  try {
    const { code, state } = req.body;

    // Input validation
    if (!code) {
      return res.status(400).json(errorResponse('Authorization code is required', 'invalid-argument'));
    }

    if (!state) {
      return res.status(400).json(errorResponse('State parameter is required', 'invalid-argument'));
    }

    // Call service to handle OAuth callback
    const result = await handleOAuthCallbackService(code, state);

    // Generate JWT token for authentication
    // Note: stripeAccountId is NOT included in token - it's fetched from DB during auth
    const token = generateToken({
      userId: result.userId,
      email: result.email,
    });

    res.json(successResponse({
      ...result,
      token, // JWT token instead of Firebase custom token
    }, 'Stripe account connected successfully'));
  } catch (error) {
    console.error('OAuth callback error:', error);
    next(error);
  }
};

/**
 * Get Stripe account status
 * GET /api/stripe/account-status
 */
const getAccountStatus = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    // Call service to get account status
    const accountStatus = await getAccountStatusService(userId);

    res.json(successResponse(accountStatus, 'Stripe account status retrieved successfully'));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOAuthUrl,
  handleOAuthCallback,
  getAccountStatus,
  createConnectionToken,
};
