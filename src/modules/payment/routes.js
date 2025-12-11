const express = require('express');
const { authenticate } = require('../../middleware/auth.js');
const { createPaymentIntent, getPaymentStats } = require('./controller.js');

const router = express.Router();

// Create payment intent - requires authentication
router.post('/create-intent', authenticate, createPaymentIntent);

// Get payment statistics - requires authentication
router.get('/stats', authenticate, getPaymentStats);

module.exports = router;
