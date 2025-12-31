const express = require('express');
const { authenticate } = require('../../middleware/auth.js');
const { createPaymentIntent, createPaymentIntentFromProducts, getPaymentStats } = require('./controller.js');

const router = express.Router();

// Create payment intent for custom amount - requires authentication
router.post('/create-intent', authenticate, createPaymentIntent);

// Create payment intent from products (Invoice-based) - requires authentication
router.post('/create-intent-from-products', authenticate, createPaymentIntentFromProducts);

// Get payment statistics - requires authentication
router.get('/stats', authenticate, getPaymentStats);

module.exports = router;
