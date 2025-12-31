const { successResponse, errorResponse } = require('../../utils/response.js');
const { getUserById } = require('./services.js');

/**
 * Get current authenticated user's basic profile
 * GET /api/user/me
 * Requires JWT authentication (req.user is populated by auth middleware)
 */
const getCurrentUser = async (req, res, next) => {
  try {
    const { userId } = req.user || {};

    if (!userId) {
      return res
        .status(401)
        .json(errorResponse('Authentication required', 'unauthenticated'));
    }

    // Call service to get user data
    const user = await getUserById(userId);

    if (!user) {
      return res
        .status(404)
        .json(errorResponse('User not found', 'not-found'));
    }

    return res.json(
      successResponse(
        {
          userId: user.id,
          email: user.email,
          displayName: user.displayName,
          stripeAccountId: user.stripeAccountId,
          stripeAccountStatus: user.stripeAccountStatus,
        },
        'User profile fetched successfully',
      ),
    );
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCurrentUser,
};


