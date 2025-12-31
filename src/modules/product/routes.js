const express = require('express');
const { authenticate } = require('../../middleware/auth.js');
const { getProducts } = require('./controller.js');

const router = express.Router();

router.get('/', authenticate, getProducts);

module.exports = router;