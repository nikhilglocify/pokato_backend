const { stripe } = require("../../config/stripe");

const fetchStripeProducts = async (stripeAccountId) => {
    try {
      const products = await stripe.products.list(
        {
          limit: 100,
          expand: ["data.default_price"],
        },
        {
          stripeAccount: stripeAccountId,
        }
      );
  
      return products.data.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.default_price
          ? product.default_price.unit_amount / 100
          : 0,
        currency: product.default_price?.currency || "usd",
        priceId: product.default_price?.id || null,
        image: product.images?.[0] || "",
      }));
    } catch (error) {
      throw new Error(error.message || "Error fetching Stripe products");
    }
  };
  

module.exports = {
  fetchStripeProducts,
};
