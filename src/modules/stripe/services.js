const { stripe, STRIPE_CLIENT_ID } = require('../../config/stripe.js');
const prisma = require('../../config/database.js');
const { Buffer } = require('buffer');

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
 * Create connection token for Stripe Terminal
 * @param {string} accountId - Stripe account ID
 * @returns {Promise<object>} Connection token with secret
 */
const createConnectionTokenService = async (accountId) => {
  try {
    const connectionToken = await stripe.terminal.connectionTokens.create(
      {},
      {
        stripeAccount: accountId,
      }
    );

    if (!connectionToken.secret) {
      const error = new Error('Failed to create connection token: missing secret');
      error.statusCode = 500;
      throw error;
    }

    return {
      secret: connectionToken.secret,
    };
  } catch (error) {
    throw new Error(error.message || 'Error creating connection token');
  }
};

/**
 * Check if user already has a connected Stripe account
 * @param {string} userId - User ID
 * @returns {Promise<object|null>} User data with stripeDetails if connected, null otherwise
 */
const checkExistingAccount = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { stripeDetails: true },
    });

    if (user?.stripeAccountId && user?.stripeAccountStatus === 'active') {
      return user;
    }

    return null;
  } catch (error) {
    throw new Error(error.message || 'Error checking existing account');
  }
};

/**
 * Generate OAuth URL for Stripe Connect
 * @param {string} returnUrl - Optional return URL
 * @returns {Promise<string>} OAuth authorization URL
 */
const generateOAuthUrl = async (returnUrl) => {
  if (!STRIPE_CLIENT_ID) {
    const error = new Error('Stripe Client ID not configured');
    error.statusCode = 500;
    throw error;
  }

  const redirectUri = returnUrl || 'stripeconnect://stripe/return';
  const state = Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64');

  const oauthUrl = `https://connect.stripe.com/oauth/authorize?` +
    `response_type=code&` +
    `client_id=${STRIPE_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `scope=read_write&` +
    `state=${state}`;

  return oauthUrl;
};

/**
 * Exchange OAuth authorization code for access tokens
 * @param {string} code - Authorization code from OAuth callback
 * @returns {Promise<object>} OAuth response with tokens and account ID
 */
const exchangeOAuthCode = async (code) => {
  try {
    const oauthResponse = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code: code,
    });

    const accountId = oauthResponse.stripe_user_id;
    if (!accountId) {
      const error = new Error('Failed to retrieve Stripe account ID');
      error.statusCode = 500;
      throw error;
    }

    return {
      accountId,
      accessToken: oauthResponse.access_token,
      refreshToken: oauthResponse.refresh_token,
      scope: oauthResponse.scope,
      tokenType: oauthResponse.token_type,
      publishableKey: oauthResponse.stripe_publishable_key || null,
    };
  } catch (error) {
    throw new Error(error.message || 'Error exchanging OAuth code');
  }
};

/**
 * Retrieve Stripe account details
 * @param {string} accountId - Stripe account ID
 * @returns {Promise<object>} Stripe account object
 */
const retrieveAccount = async (accountId) => {
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return account;
  } catch (error) {
    throw new Error(error.message || 'Error retrieving Stripe account');
  }
};

/**
 * Determine account status from Stripe account object
 * @param {object} account - Stripe account object
 * @returns {string} Account status: 'active', 'disabled', or 'pending'
 */
const determineAccountStatus = (account) => {
  if (account.details_submitted && account.charges_enabled) {
    return 'active';
  } else if (account.details_submitted && !account.charges_enabled) {
    return 'disabled';
  }
  return 'pending';
};

/**
 * Find or create user and stripe details from OAuth callback
 * @param {object} oauthData - OAuth response data
 * @param {object} account - Stripe account object
 * @param {string} status - Account status
 * @returns {Promise<object>} User object and isNewUser flag
 */
const findOrCreateUserFromOAuth = async (oauthData, account, status) => {
  try {
    const { accountId, accessToken, refreshToken, scope, tokenType, publishableKey } = oauthData;
console.log("stripe details",account)
console.log("oauthData",oauthData)
    // Find existing user by Stripe Account ID
    const existingUser = await prisma.user.findUnique({
      where: { stripeAccountId: accountId },
      include: { stripeDetails: true },
    });

    let user;
    let isNewUser = false;
console.log("existingUser",existingUser)
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
            stripeAccessToken: accessToken,
            stripeRefreshToken: refreshToken,
            stripeScope: scope,
            stripeTokenType: tokenType,
            stripePublishableKey: publishableKey,
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
          stripeAccessToken: accessToken,
          stripeRefreshToken: refreshToken,
          stripeScope: scope,
          stripeTokenType: tokenType,
          stripePublishableKey: publishableKey,
        },
      });

      isNewUser = true;
    }

    return { user, isNewUser };
  } catch (error) {
    throw new Error(error.message || 'Error finding or creating user from OAuth');
  }
};

/**
 * Handle OAuth callback - complete flow
 * @param {string} code - Authorization code
 * @param {string} state - State parameter
 * @returns {Promise<object>} OAuth callback result with account and user info
 */
const handleOAuthCallbackService = async (code, state) => {
  try {
    // Exchange code for tokens
    const oauthData = await exchangeOAuthCode(code);
    const { accountId } = oauthData;

    // Get account details
    const account = await retrieveAccount(accountId);

    // Determine status
    const status = determineAccountStatus(account);

    // Find or create user
    const { user } = await findOrCreateUserFromOAuth(oauthData, account, status);

    return {
      accountId,
      userId: user.id,
      email: user.email,
      status,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
    };
   
  } catch (error) {
    console.log("ERROR FROM HANDLE OAUTH CALLBACK SERVICE",error)
    throw new Error(error.message || 'Error handling OAuth callback');
  }
};

/**
 * Get account status and update database
 * @param {string} userId - User ID
 * @returns {Promise<object>} Account status information
 */
const getAccountStatusService = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { stripeDetails: true },
    });

    if (!user?.stripeAccountId) {
      return {
        connected: false,
        status: 'not_connected',
      };
    }

    const accountId = user.stripeAccountId;

    // Get account details from Stripe
    const account = await retrieveAccount(accountId);

    // Determine status
    const status = determineAccountStatus(account);

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

    return {
      connected: true,
      status,
      accountId,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
    };
  } catch (error) {
    throw new Error(error.message || 'Error getting account status');
  }
};

module.exports = {
  validateStripeAccount,
  createConnectionTokenService,
  checkExistingAccount,
  generateOAuthUrl,
  handleOAuthCallbackService,
  getAccountStatusService,
};

