const express = require('express');
const { authenticate } = require('../../middleware/auth.js');
const {
  registerReader,
  listLocations,
  createLocation,
  getOrCreateLocation,
} = require('./controller.js');

const router = express.Router();

// Reader routes
router.post('/register', authenticate, registerReader);

// Location routes
router.get('/locations', authenticate, listLocations);
router.post('/locations', authenticate, createLocation);
router.get('/locations/get-or-create', authenticate, getOrCreateLocation);

module.exports = router;
