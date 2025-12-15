const express = require('express');
const { authenticate } = require('../../middleware/auth.js');
const { getCurrentUser } = require('./controller.js');

const router = express.Router();

// Get current authenticated user's basic profile
router.get('/me', authenticate, getCurrentUser);

module.exports = router;


