const { stripe } = require('../../config/stripe.js');
const prisma = require('../../config/database.js');

/**
 * Validate user has an active Stripe account
 * @param {string} userId - User ID
 * @returns {Promise<string>} Stripe account ID
 * @throws {Error} If account is not connected or not active (with statusCode 400)
 */
const validateStripeAccount = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user?.stripeAccountId) {
    const error = new Error('Stripe account not connected. Please connect your Stripe account first.');
    error.statusCode = 400;
    error.code = 'failed-precondition';
    throw error;
  }

  if (user.stripeAccountStatus !== 'active') {
    const error = new Error('Stripe account is not active. Please complete the onboarding process.');
    error.statusCode = 400;
    error.code = 'failed-precondition';
    throw error;
  }

  return user.stripeAccountId;
};

/**
 * List all locations for a Stripe account
 * @param {string} accountId - Stripe account ID
 * @returns {Promise<Array>} Array of location objects
 */
const listLocationsService = async (accountId) => {
  try {
    const locations = await stripe.terminal.locations.list(
      {},
      { stripeAccount: accountId }
    );

    return locations.data.map(loc => ({
      id: loc.id,
      displayName: loc.display_name,
      address: loc.address,
    }));
  } catch (error) {
    throw new Error(error.message || 'Error listing locations');
  }
};

/**
 * Create a new location for a Stripe account
 * @param {string} accountId - Stripe account ID
 * @param {object} locationData - Location data
 * @param {string} locationData.displayName - Display name for the location
 * @param {object} locationData.address - Address object
 * @returns {Promise<object>} Created location object
 */
const createLocationService = async (accountId, locationData) => {
  try {
    const { displayName, address } = locationData;

    const newLocation = await stripe.terminal.locations.create(
      {
        display_name: displayName,
        address: {
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          country: address.country,
          postal_code: address.postal_code,
        },
      },
      { stripeAccount: accountId }
    );

    return {
      locationId: newLocation.id,
      displayName: newLocation.display_name,
      address: newLocation.address,
    };
  } catch (error) {
    throw new Error(error.message || 'Error creating location');
  }
};

/**
 * Get or create a location for a Stripe account
 * Returns first existing location, or creates a default one
 * @param {string} accountId - Stripe account ID
 * @returns {Promise<object>} Location object
 */
const getOrCreateLocationService = async (accountId) => {
  try {
    // List existing locations
    const locations = await stripe.terminal.locations.list(
      {},
      { stripeAccount: accountId }
    );

    // If location exists, return it
    if (locations.data.length > 0) {
      const location = locations.data[0];
      return {
        locationId: location.id,
        displayName: location.display_name,
        address: location.address,
      };
    }

    // Create a new location if none exists
    // NOTE: Hardcoded default address values (should be configurable)
    const newLocation = await stripe.terminal.locations.create(
      {
        display_name: 'Default Location',
        address: {
          line1: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          country: 'US',
          postal_code: '94102',
        },
      },
      { stripeAccount: accountId }
    );

    return {
      locationId: newLocation.id,
      displayName: newLocation.display_name,
      address: newLocation.address,
    };
  } catch (error) {
    throw new Error(error.message || 'Error getting or creating location');
  }
};

/**
 * Register a Terminal reader
 * @param {string} accountId - Stripe account ID
 * @param {object} readerData - Reader registration data
 * @param {string} readerData.registrationCode - Registration code for the reader
 * @param {string} readerData.locationId - Location ID where reader will be registered
 * @param {string} readerData.label - Optional label for the reader
 * @returns {Promise<object>} Registered reader object
 */
const registerReaderService = async (accountId, readerData) => {
  try {
    const { registrationCode, locationId, label } = readerData;

    const reader = await stripe.terminal.readers.create(
      {
        registration_code: registrationCode,
        location: locationId,
        label: label || 'Terminal Reader',
      },
      { stripeAccount: accountId }
    );

    return {
      readerId: reader.id,
      serialNumber: reader.serial_number,
      label: reader.label,
      deviceType: reader.device_type,
      locationId: reader.location,
    };
  } catch (error) {
    throw new Error(error.message || 'Error registering reader');
  }
};

module.exports = {
  validateStripeAccount,
  listLocationsService,
  createLocationService,
  getOrCreateLocationService,
  registerReaderService,
};

