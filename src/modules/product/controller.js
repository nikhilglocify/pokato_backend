const { successResponse, errorResponse } = require('../../utils/response.js');
const { fetchStripeProducts } = require('./services.js');

/**
 * Get Stripe products with one-time prices
 * GET /api/products
 */
const getProducts = async (req, res, next) => {
  try {
    const stripeAccountId = req.user.stripeAccountId;

    if (!stripeAccountId) {
      return res.status(400).json(errorResponse(
        'Stripe account not connected. Please connect your Stripe account first.',
        'failed-precondition'
      ));
    }

    // Call service to fetch products
    const products = await fetchStripeProducts(stripeAccountId);

    res.json(successResponse(products, 'Stripe products fetched successfully'));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
};
