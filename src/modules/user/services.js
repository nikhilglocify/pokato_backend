const prisma = require('../../config/database.js');

/**
 * Get user profile by user ID
 * @param {string} userId - User ID
 * @returns {Promise<object|null>} User profile data or null if not found
 */
const getUserById = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        stripeAccountId: true,
        stripeAccountStatus: true,
      },
    });

    return user;
  } catch (error) {
    throw new Error(error.message || 'Error fetching user profile');
  }
};

module.exports = {
  getUserById,
};

