document.addEventListener('DOMContentLoaded', function() {
  // Initialize map
  const map = L.map('map').setView([46.603354, 1.888334], 6);
  const markers = L.layerGroup().addTo(map);

  // Define custom icons
  const selectedIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    shadowSize: [41, 41]
  });

  const nearbyIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    shadowSize: [41, 41]
  });

  // Define base layers
  const baseLayers = {
    'Carto Light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors, © CARTO'
    }),
    'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }),
    'Carto Dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors, © CARTO'
    }),
    'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenTopoMap contributors'
    })
  };

  // Add default layer
  baseLayers['Carto Light'].addTo(map);

  // Add layer control
  L.control.layers(baseLayers).addTo(map);

  let currentMarker = null;
  let circle = null;

  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Chat state management
  const chatState = {
    currentPharmacy: null,
    messages: {},  // Store messages for each pharmacy
    initialized: false
  };

  function createPharmacyItem(pharmacy) {
    const pharmacyItem = document.createElement('div');
    pharmacyItem.className = 'pharmacy-item';
    
    // Get stock information for Befizal
    const stockInfo = pharmacy.stock && pharmacy.stock['3717709']
        ? `<div class="pharmacy-stock">
             Stock: ${pharmacy.stock['3717709'].quantity} unités
           </div>`
        : '<div class="pharmacy-stock">Stock non disponible</div>';

    pharmacyItem.innerHTML = `
        <div class="pharmacy-info">
            <div class="pharmacy-header">
                <div class="pharmacy-name">${pharmacy.raison_sociale || pharmacy.name}</div>
                <div class="pharmacy-distance">${(pharmacy.distance_km || pharmacy.distance).toFixed(1)} km</div>
            </div>
            <div class="pharmacy-address">${pharmacy.adresse || pharmacy.address}</div>
            ${stockInfo}
        </div>
    `;

    pharmacyItem.addEventListener('click', () => {
        // Remove active class from all pharmacy items
        document.querySelectorAll('.pharmacy-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Add active class to clicked item
        pharmacyItem.classList.add('active');
        
        // Center map on this pharmacy
        const lat = parseFloat(pharmacy.latitude || pharmacy.lat);
        const lng = parseFloat(pharmacy.longitude || pharmacy.lng);
        if (lat && lng) {
            map.setView([lat, lng], 15);
            pharmacy.marker && pharmacy.marker.openPopup();
        }
        
        // Initialize chat for this pharmacy
        initializePharmacyChat(pharmacy);
    });

    return pharmacyItem;
  }

  function updatePharmacyList(nearbyPharmacies) {
    const pharmacyList = document.getElementById('pharmacy-list');
    pharmacyList.innerHTML = '';
    
    if (!nearbyPharmacies || nearbyPharmacies.length === 0) {
        pharmacyList.innerHTML = '<div class="no-pharmacies">Aucune pharmacie trouvée dans ce rayon</div>';
        return;
    }
    
    nearbyPharmacies.forEach(pharmacy => {
        const item = createPharmacyItem(pharmacy);
        pharmacyList.appendChild(item);
    });
  }

  function initializePharmacyChat(pharmacy) {
    chatState.currentPharmacy = pharmacy;
    
    // Update chat header
    const chatTitle = document.querySelector('.chat-title');
    const chatSubtitle = document.querySelector('.chat-subtitle');
    const chatContainer = document.querySelector('.chat-container');
    
    chatTitle.textContent = pharmacy.name;
    chatSubtitle.textContent = pharmacy.address;
    chatContainer.style.display = 'flex';

    // Load existing messages for this pharmacy
    const chatMessages = document.querySelector('.chat-messages');
    chatMessages.innerHTML = '';
    
    if (chatState.messages[pharmacy.name]) {
      chatState.messages[pharmacy.name].forEach(msg => {
        addMessage(msg.text, msg.isSent, false);
      });
    }

    // Scroll to bottom of messages
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addMessage(message, isSent = true, store = true) {
    if (!chatState.currentPharmacy) return;

    const messageElement = document.createElement('div');
    messageElement.className = `message ${isSent ? 'message-sent' : 'message-received'}`;
    
    const now = new Date();
    const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    
    messageElement.innerHTML = `
      ${message}
      <div class="message-time">${time}</div>
    `;
    
    const chatMessages = document.querySelector('.chat-messages');
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Store the message if needed
    if (store) {
      const pharmacyName = chatState.currentPharmacy.name;
      if (!chatState.messages[pharmacyName]) {
        chatState.messages[pharmacyName] = [];
      }
      chatState.messages[pharmacyName].push({
        text: message,
        isSent,
        timestamp: now
      });
    }
  }

  function initializeChat() {
    if (chatState.initialized) return;
    
    const chatInput = document.querySelector('.chat-input');
    const sendButton = document.querySelector('.send-button');
    const chatContainer = document.querySelector('.chat-container');
    
    // Initially hide the chat container until a pharmacy is selected
    chatContainer.style.display = 'none';

    function handleSendMessage() {
      const message = chatInput.value.trim();
      if (message && chatState.currentPharmacy) {
        addMessage(message, true);
        chatInput.value = '';
        
        // Simulate received message (remove in production)
        setTimeout(() => {
          addMessage(`Message bien reçu. La pharmacie ${chatState.currentPharmacy.name} reviendra vers vous dans les plus brefs délais.`, false);
        }, 1000);
      }
    }

    // Event listeners
    sendButton.addEventListener('click', handleSendMessage);
    
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    chatInput.addEventListener('input', () => {
      sendButton.disabled = chatInput.value.trim() === '';
    });

    chatState.initialized = true;
  }

  // Update nearby pharmacies
  function updateNearbyPharmacies(lat, lng, radius) {
    // Clear existing markers
    markers.clearLayers();
    if (circle) map.removeLayer(circle);
    
    // Add marker for selected pharmacy
    currentMarker = L.marker([lat, lng], { icon: selectedIcon })
      .bindPopup('<strong>Pharmacie sélectionnée</strong>')
      .addTo(markers);
    
    // Add radius circle
    circle = L.circle([lat, lng], {
      radius: radius * 1000,
      fillColor: '#0066cc',
      fillOpacity: 0.1,
      color: '#0066cc',
      opacity: 0.3
    }).addTo(map);

    // Find nearby pharmacies
    const pharmacySelect = document.getElementById('pharmacy');
    const selected = pharmacySelect.selectedOptions[0];
    
    // Get stock data
    fetch(`/api/nearby-pharmacies?lat=${lat}&lng=${lng}&radius=${radius}`)
      .then(response => response.json())
      .then(data => {
        console.log('Pharmacy data received:', data);
        
        const nearbyPharmacies = Array.from(pharmacySelect.options)
          .filter(option => option.value && option !== selected)
          .map(option => {
            const pharmacy = {
              name: option.value,
              lat: parseFloat(option.dataset.lat),
              lng: parseFloat(option.dataset.lng),
              address: option.dataset.address,
              dept: option.dataset.dept,
              distance: getDistance(
                lat, 
                lng, 
                parseFloat(option.dataset.lat), 
                parseFloat(option.dataset.lng)
              )
            };

            // Add stock data if available
            const stockData = data.find(p => p.id === parseInt(option.dataset.id));
            if (stockData && stockData.stock) {
              pharmacy.stock = stockData.stock;
            }

            return pharmacy;
          })
          .filter(pharmacy => pharmacy.distance <= radius)
          .sort((a, b) => a.distance - b.distance);

        // Update markers and list
        nearbyPharmacies.forEach(pharmacy => {
          const marker = L.marker([pharmacy.lat, pharmacy.lng], { icon: nearbyIcon })
            .bindPopup(`
              <strong>${pharmacy.name}</strong><br>
              ${pharmacy.address}<br>
              <em>${pharmacy.distance.toFixed(1)} km</em>
            `)
            .addTo(markers);
          pharmacy.marker = marker;
        });

        updatePharmacyList(nearbyPharmacies);
        
        // Fit map bounds
        const bounds = L.featureGroup(markers.getLayers()).getBounds();
        map.fitBounds(bounds.pad(0.1));
      })
      .catch(error => {
        console.error('Error fetching stock data:', error);
      });
  }

  // Handle pharmacy selection
  document.getElementById('pharmacy').addEventListener('change', function() {
    const selectedOption = this.options[this.selectedIndex];
    
    if (this.value) {
      const lat = parseFloat(selectedOption.dataset.lat);
      const lng = parseFloat(selectedOption.dataset.lng);
      const radius = document.getElementById('radius').value;
      updateNearbyPharmacies(lat, lng, radius);
    } else {
      markers.clearLayers();
      if (circle) map.removeLayer(circle);
      map.setView([46.603354, 1.888334], 6);
      document.getElementById('pharmacy-list').innerHTML = '';
    }
  });

  // Handle radius change
  document.getElementById('radius').addEventListener('input', function() {
    document.getElementById('radius-value').textContent = this.value;
    
    const selectedOption = document.getElementById('pharmacy').options[
      document.getElementById('pharmacy').selectedIndex
    ];
    
    if (selectedOption.value) {
      const lat = parseFloat(selectedOption.dataset.lat);
      const lng = parseFloat(selectedOption.dataset.lng);
      updateNearbyPharmacies(lat, lng, this.value);
    }
  });

  // Initial update if a pharmacy is pre-selected
  const pharmacySelect = document.getElementById('pharmacy');
  if (pharmacySelect.value) {
    const selectedOption = pharmacySelect.options[pharmacySelect.selectedIndex];
    const lat = parseFloat(selectedOption.dataset.lat);
    const lng = parseFloat(selectedOption.dataset.lng);
    const radius = document.getElementById('radius').value;
    updateNearbyPharmacies(lat, lng, radius);
  }

  initializeChat();
}); 