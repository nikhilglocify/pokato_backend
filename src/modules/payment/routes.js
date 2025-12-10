const express = require('express');
const { authenticate } = require('../../middleware/auth.js');
const { createPaymentIntent } = require('./controller.js');

const router = express.Router();

// Create payment intent - requires authentication
router.post('/create-intent', authenticate, createPaymentIntent);

module.exports = router;
