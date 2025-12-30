const { successResponse } = require('../../utils/response');
const { fetchStripeProducts } = require('./services');

const getProducts = async (req, res, next) => {
  try {
    console.log('user', req.user);
    const stripeAccountId = req.user.stripeAccountId;
    const userId = req.user.userId;
    if (!stripeAccountId) {
      throw new Error('Stripe account not connected');
    }
    const products = await fetchStripeProducts(stripeAccountId, userId);
    res.json(successResponse(products, 'Stripe porducts fetched successfully'));
  } catch (error) {
    next(error);
  }
};

module.exports = { getProducts };
