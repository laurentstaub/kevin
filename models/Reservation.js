const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const reservationSchema = new Schema({
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1']
  },
  cip: {
    type: String,
    required: [true, 'CIP code is required'],
    validate: {
      validator: function(v) {
        return /^\d{7}$/.test(v);
      },
      message: props => `${props.value} is not a valid CIP7 code!`
    }
  },
  pickupDate: {
    type: Date,
    required: [true, 'Pickup date is required']
  },
  deliveryType: {
    type: String,
    required: [true, 'Delivery type is required'],
    enum: {
      values: ['pickup', 'delivery', 'emergency'],
      message: '{VALUE} is not a valid delivery type'
    }
  },
  pickupTime: {
    type: String,
    required: [true, 'Pickup time is required'],
    validate: {
      validator: function(v) {
        // Validate time format (HH:mm)
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
      },
      message: props => `${props.value} is not a valid time format! Use HH:mm`
    }
  },
  comments: {
    type: String,
    trim: true,
    maxlength: [500, 'Comments cannot be longer than 500 characters']
  },
  productId: {
    type: Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Product ID is required']
  },
  pharmacyId: {
    type: Schema.Types.ObjectId,
    ref: 'Pharmacy',
    required: [true, 'Pharmacy ID is required']
  },
  status: {
    type: String,
    enum: {
      values: ['pending', 'confirmed', 'completed', 'cancelled'],
      message: '{VALUE} is not a valid status'
    },
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create compound indexes for common queries
reservationSchema.index({ pharmacyId: 1, status: 1 });
reservationSchema.index({ productId: 1, status: 1 });
reservationSchema.index({ cip: 1 });

const Reservation = mongoose.model('Reservation', reservationSchema);

module.exports = Reservation; 