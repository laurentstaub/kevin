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

  // Update nearby pharmacies
  async function updateNearbyPharmacies(lat, lng, radius) {
    try {
      const response = await fetch(`/api/nearby-pharmacies?lat=${lat}&lng=${lng}&radius=${radius}`);
      const pharmacies = await response.json();
      
      // Clear existing markers
      markers.clearLayers();
      
      // Add marker for selected pharmacy
      currentMarker = L.marker([lat, lng], { icon: selectedIcon })
        .bindPopup('<strong>Pharmacie sélectionnée</strong>')
        .addTo(markers);
      
      // Update nearby list
      const nearbyList = document.getElementById('nearby-list');
      nearbyList.innerHTML = pharmacies
        .filter(p => p.distance_km > 0) // Exclude selected pharmacy
        .map(p => `
          <div class="nearby-item">
            <strong>${p.raison_sociale}</strong>
            <div>${p.adresse}</div>
            <div>${p.code_postal} ${p.ville}</div>
            <div class="distance">${p.distance_km.toFixed(1)} km</div>
          </div>
        `)
        .join('');
      
      // Add markers for nearby pharmacies
      pharmacies.forEach(p => {
        if (p.distance_km > 0) { // Exclude selected pharmacy
          L.marker([p.latitude, p.longitude], { icon: nearbyIcon })
            .bindPopup(`
              <strong>${p.raison_sociale}</strong><br>
              ${p.adresse}<br>
              ${p.code_postal} ${p.ville}<br>
              <em>${p.distance_km.toFixed(1)} km</em>
            `)
            .addTo(markers);
        }
      });
      
      // Fit map bounds to show all markers
      const bounds = L.featureGroup(markers.getLayers()).getBounds();
      map.fitBounds(bounds, { padding: [50, 50] });
      
    } catch (error) {
      console.error('Error fetching nearby pharmacies:', error);
    }
  }

  // Handle pharmacy selection
  document.getElementById('pharmacy').addEventListener('change', function() {
    const selectedOption = this.options[this.selectedIndex];
    const details = document.getElementById('pharmacy-details');
    const nameElement = document.getElementById('pharmacy-name');
    const addressElement = document.getElementById('pharmacy-address');
    const locationElement = document.getElementById('pharmacy-location');
    
    if (this.value) {
      const lat = parseFloat(selectedOption.dataset.lat);
      const lng = parseFloat(selectedOption.dataset.lng);
      const address = selectedOption.dataset.address;
      const dept = selectedOption.dataset.dept;
      
      // Update pharmacy details
      details.style.display = 'block';
      nameElement.textContent = this.value;
      addressElement.textContent = address;
      locationElement.textContent = `Département : ${dept}`;
      
      // Update nearby pharmacies
      const radius = document.getElementById('radius').value;
      updateNearbyPharmacies(lat, lng, radius);
      
    } else {
      details.style.display = 'none';
      markers.clearLayers();
      map.setView([46.603354, 1.888334], 6);
    }
  });

  // Handle radius change
  document.getElementById('radius').addEventListener('input', function() {
    const selectedOption = document.getElementById('pharmacy').options[
      document.getElementById('pharmacy').selectedIndex
    ];
    
    if (selectedOption.value) {
      const lat = parseFloat(selectedOption.dataset.lat);
      const lng = parseFloat(selectedOption.dataset.lng);
      
      document.getElementById('radius-value').textContent = this.value;
      updateNearbyPharmacies(lat, lng, this.value);
    }
  });
}); 