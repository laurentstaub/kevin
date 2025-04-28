const express = require('express');
const router = express.Router();
const Pharmacy = require('../models/Pharmacy');
const Product = require('../models/Product');
const Reservation = require('../models/Reservation');

/**
 * POST /api/reservations
 * Creates a new reservation
 */
router.post('/reservations', async (req, res) => {
  try {
    const {
      quantity,
      pickupDate,
      pickupTime,
      comments,
      productId,
      pharmacyId
    } = req.body;
    
    // Validate required fields
    if (!quantity || !pickupDate || !pickupTime || !productId || !pharmacyId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    // Validate pickup date is in the future
    const now = new Date();
    const pickup = new Date(pickupDate);
    if (pickup < now) {
      return res.status(400).json({
        success: false,
        message: 'Pickup date must be in the future'
      });
    }
    
    // Validate product and pharmacy exist
    try {
      const [product, pharmacy] = await Promise.all([
        Product.findById(productId),
        Pharmacy.findById(pharmacyId)
      ]);
      
      if (!product || !pharmacy) {
        return res.status(404).json({
          success: false,
          message: 'Product or pharmacy not found'
        });
      }
      
      // Create and save the reservation
      const reservation = new Reservation({
        quantity,
        pickupDate,
        pickupTime,
        comments,
        productId,
        pharmacyId
      });
      
      await reservation.save();
      
      // TODO: Send confirmation email
      
      res.status(201).json({
        success: true,
        message: 'Reservation created successfully',
        data: reservation
      });
      
    } catch (error) {
      console.error('Error validating product/pharmacy:', error);
      return res.status(500).json({
        success: false,
        message: 'Error validating product or pharmacy'
      });
    }
    
  } catch (error) {
    console.error('Error creating reservation:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating reservation',
      error: error.message
    });
  }
});

router.get('/reservations/:pharmacyId', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { status } = req.query;

    // Validate pharmacy exists
    const pharmacy = await Pharmacy.findById(pharmacyId);
    if (!pharmacy) {
      return res.status(404).json({
        success: false,
        message: 'Pharmacy not found'
      });
    }

    // Build query
    const query = { pharmacyId };
    if (status) {
      query.status = status;
    }

    // Fetch reservations with product details
    const reservations = await Reservation.find(query)
      .populate('productId', 'name description')
      .sort({ pickupDate: 1, pickupTime: 1 })
      .lean();

    res.json({
      success: true,
      data: reservations
    });

  } catch (error) {
    console.error('Error fetching reservations:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reservations',
      error: error.message
    });
  }
});

module.exports = router; 