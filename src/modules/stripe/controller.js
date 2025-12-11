const { stripe, STRIPE_CLIENT_ID } = require('../../config/stripe.js');
const prisma = require('../../config/database.js');
const { successResponse, errorResponse } = require('../../utils/response.js');
const { generateToken } = require('../../middleware/auth.js');
const { Buffer } = require('buffer');

/**
 * Create connection token for Stripe Terminal
 * POST /api/stripe/connection-token
 */
const createConnectionToken = async (req, res, next) => {
  try {
    const userId = req.user.userId;

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

    // Create connection token using the user's Stripe account
    const connectionToken = await stripe.terminal.connectionTokens.create(
      {},
      {
        stripeAccount: accountId,
      }
    );

    if (!connectionToken.secret) {
      return res.status(500).json(errorResponse('Failed to create connection token: missing secret'));
    }

    res.json(successResponse({
      secret: connectionToken.secret,
    }, 'Connection token created successfully'));
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

    if (!STRIPE_CLIENT_ID) {
      return res.status(500).json(errorResponse('Stripe Client ID not configured'));
    }

    // If user is authenticated, check if account already connected
    if (req.user) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        include: { stripeDetails: true },
      });

      if (user?.stripeAccountId && user?.stripeAccountStatus === 'active') {
        return res.json(successResponse({
          url: null,
          alreadyConnected: true,
          accountId: user.stripeAccountId,
        }, 'Stripe account already connected'));
      }
    }

    const redirectUri = returnUrl || 'stripeconnect://stripe/return';
    const state = Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64');

    const oauthUrl = `https://connect.stripe.com/oauth/authorize?` +
      `response_type=code&` +
      `client_id=${STRIPE_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=read_write&` +
      `state=${state}`;

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

    if (!code) {
      return res.status(400).json(errorResponse('Authorization code is required', 'invalid-argument'));
    }

    if (!state) {
      return res.status(400).json(errorResponse('State parameter is required', 'invalid-argument'));
    }

    // Exchange authorization code for tokens
    const oauthResponse = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code: code,
    });

    const accountId = oauthResponse.stripe_user_id;
    if (!accountId) {
      return res.status(500).json(errorResponse('Failed to retrieve Stripe account ID'));
    }

    // Get account details
    const account = await stripe.accounts.retrieve(accountId);

    // Determine account status
    let status = 'pending';
    if (account.details_submitted && account.charges_enabled) {
      status = 'active';
    } else if (account.details_submitted && !account.charges_enabled) {
      status = 'disabled';
    }

    // Find existing user by Stripe Account ID
    const existingUser = await prisma.user.findUnique({
      where: { stripeAccountId: accountId },
      include: { stripeDetails: true },
    });

    let user;
    let isNewUser = false;

    if (existingUser) {
      // Existing user - update
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          stripeAccountStatus: status,
          updatedAt: new Date(),
        },
      });

      // Update stripe details
      if (existingUser.stripeDetails) {
        await prisma.stripeDetails.update({
          where: { userId: user.id },
          data: {
            stripeAccountStatus: status,
            stripeAccessToken: oauthResponse.access_token,
            stripeRefreshToken: oauthResponse.refresh_token,
            stripeScope: oauthResponse.scope,
            stripeTokenType: oauthResponse.token_type,
            stripePublishableKey: oauthResponse.stripe_publishable_key || null,
            updatedAt: new Date(),
          },
        });
      }
    } else {
      // New user - create
      const userEmail = account.email || `stripe_${accountId}@temp.com`;
      const userDisplayName = account.business_profile?.name || null;

      user = await prisma.user.create({
        data: {
          email: userEmail,
          displayName: userDisplayName,
          stripeAccountId: accountId,
          stripeAccountStatus: status,
        },
      });

      // Create stripe details
      await prisma.stripeDetails.create({
        data: {
          userId: user.id,
          stripeAccountId: accountId,
          stripeAccountStatus: status,
          stripeAccessToken: oauthResponse.access_token,
          stripeRefreshToken: oauthResponse.refresh_token,
          stripeScope: oauthResponse.scope,
          stripeTokenType: oauthResponse.token_type,
          stripePublishableKey: oauthResponse.stripe_publishable_key || null,
        },
      });

      isNewUser = true;
    }

    // Generate JWT token for authentication
    // Note: stripeAccountId is NOT included in token - it's fetched from DB during auth
    const token = generateToken({
      userId: user.id,
      email: user.email,
    });

    res.json(successResponse({
      accountId,
      userId: user.id, // Include userId for frontend
      email: user.email, // Include email for frontend
      status,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { stripeDetails: true },
    });

    if (!user?.stripeAccountId) {
      return res.json(successResponse({
        connected: false,
        status: 'not_connected',
      }, 'Stripe account not connected'));
    }

    const accountId = user.stripeAccountId;

    // Get account details from Stripe
    const account = await stripe.accounts.retrieve(accountId);

    // Determine status
    let status = 'pending';
    if (account.details_submitted && account.charges_enabled) {
      status = 'active';
    } else if (account.details_submitted && !account.charges_enabled) {
      status = 'disabled';
    }

    // Update user status in database
    await prisma.user.update({
      where: { id: userId },
      data: {
        stripeAccountStatus: status,
        updatedAt: new Date(),
      },
    });

    if (user.stripeDetails) {
      await prisma.stripeDetails.update({
        where: { userId },
        data: {
          stripeAccountStatus: status,
          updatedAt: new Date(),
        },
      });
    }

    res.json(successResponse({
      connected: true,
      status,
      accountId,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
    }, 'Stripe account status retrieved successfully'));
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
