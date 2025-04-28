/**
 * Handles the reservation form submission
 * @param {Event} event - The form submission event
 */
const handleReservationSubmit = async function(event) {
  event.preventDefault();
  
  const form = event.target;
  const submitButton = form.querySelector('.submit-reservation');
  
  // Disable submit button while processing
  submitButton.disabled = true;
  
  try {
    const formData = {
      quantity: form.querySelector('#quantity').value,
      cip: form.querySelector('#cip').value,
      pickupDate: form.querySelector('#pickup-date').value,
      deliveryType: form.querySelector('#delivery-type').value,
      comments: form.querySelector('#comments').value,
      productId: window.productId, // Assuming productId is set in the template
      pharmacyId: window.selectedPharmacyId // From mapping.js
    };
    
    // Validate required fields
    if (!formData.quantity || !formData.cip || !formData.pickupDate || !formData.deliveryType) {
      throw new Error('Veuillez remplir tous les champs obligatoires');
    }
    
    // Validate pharmacy selection
    if (!formData.pharmacyId) {
      throw new Error('Veuillez sélectionner une pharmacie');
    }
    
    const response = await fetch('/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(formData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Erreur lors de la réservation');
    }
    
    const result = await response.json();
    
    // Show success message
    alert('Réservation effectuée avec succès !');
    
    // Reset form
    form.reset();
    
  } catch (error) {
    // Show error message
    alert(error.message || 'Une erreur est survenue');
    
  } finally {
    // Re-enable submit button
    submitButton.disabled = false;
  }
};

/**
 * Sets minimum date for pickup to tomorrow
 */
const setMinimumPickupDate = function() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const dateInput = document.querySelector('#pickup-date');
  if (dateInput) {
    dateInput.min = tomorrow.toISOString().split('T')[0];
  }
};

// Initialize reservation form
document.addEventListener('DOMContentLoaded', function() {
  const reservationForm = document.querySelector('.reservation-form');
  if (reservationForm) {
    reservationForm.addEventListener('submit', handleReservationSubmit);
    setMinimumPickupDate();
  }
}); 