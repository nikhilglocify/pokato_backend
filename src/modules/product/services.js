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
  
      // Filter to only include products with one-time prices (not recurring)
      // InvoiceItems only accept one-time prices
      const oneTimeProducts = products.data
        .filter((product) => {
          // Only include products with a default_price that is one-time
          if (!product.default_price) return false;
          
          // If default_price is expanded, check type directly
          if (typeof product.default_price === 'object') {
            return product.default_price.type === 'one_time';
          }
          
          // If it's just an ID, we'll need to fetch it, but for now assume it's valid
          // We'll filter it out if it's recurring when we try to use it
          return true;
        })
        .map((product) => {
          const defaultPrice = product.default_price;
          
          // Double-check price type if it's an object
          if (typeof defaultPrice === 'object' && defaultPrice.type !== 'one_time') {
            return null;
          }
          
          return {
            id: product.id,
            name: product.name,
            description: product.description,
            price: defaultPrice && typeof defaultPrice === 'object'
              ? defaultPrice.unit_amount / 100
              : 0,
            currency: defaultPrice && typeof defaultPrice === 'object'
              ? defaultPrice.currency
              : "usd",
            priceId: defaultPrice && typeof defaultPrice === 'object'
              ? defaultPrice.id
              : (typeof defaultPrice === 'string' ? defaultPrice : null),
            image: product.images?.[0] || "",
          };
        })
        .filter((product) => product !== null && product.priceId !== null); // Remove null entries
  
      return oneTimeProducts;
    } catch (error) {
      throw new Error(error.message || "Error fetching Stripe products");
    }
  };
  

module.exports = {
  fetchStripeProducts,
};
