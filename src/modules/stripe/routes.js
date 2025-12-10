const express = require('express');
const { authenticate, optionalAuth } = require('../../middleware/auth.js');
const {
  getOAuthUrl,
  handleOAuthCallback,
  getAccountStatus,
  createConnectionToken,
} = require('./controller.js');

const router = express.Router();

// OAuth URL - optional auth (for login flow)
router.get('/oauth-url', optionalAuth, getOAuthUrl);

// OAuth callback - no auth required (creates user)
router.post('/oauth-callback', handleOAuthCallback);

// Account status - requires authentication
router.get('/account-status', authenticate, getAccountStatus);

// Connection token - requires authentication
router.post('/connection-token', authenticate, createConnectionToken);

module.exports = router;
