const Stripe = require('stripe');

// Note: Make sure env.js is imported before this file
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables. Make sure .env file exists in server/ directory.');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

const STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID;
if (!STRIPE_CLIENT_ID) {
  console.warn('⚠️  STRIPE_CLIENT_ID is not set. Stripe OAuth will not work.');
}

module.exports = {
  stripe,
  STRIPE_CLIENT_ID,
};
