// Search functionality
const searchInput = document.querySelector('.search-input');
const resultsContainer = document.getElementById('results');
const loadingIndicator = document.getElementById('loading');

function updateResults(data) {
  if (!data.results || data.results.length === 0) {
    resultsContainer.innerHTML = `
      <div class="results">
        <div class="no-results">Aucun résultat trouvé</div>
      </div>
    `;
    return;
  }

  const resultsHtml = `
    <h2 class="results-header">Résultats de la recherche</h2>
    <div class="results">
      ${data.results.map(result => `
        <a class="result-item" href="/product/${result.id}">
          <div>${result.denomination_medicament}</div>
          ${result.libelle_presentation ? `<div>${result.libelle_presentation}</div>` : ''}
        </a>
      `).join('')}
    </div>
  `;
  
  resultsContainer.innerHTML = resultsHtml;
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

async function performSearch(query) {
  if (!query.trim()) {
    resultsContainer.innerHTML = '';
    sessionStorage.removeItem('lastSearchQuery');
    sessionStorage.removeItem('lastSearchResults');
    return;
  }

  // Only search if query has at least 3 characters
  if (query.trim().length < 3) {
    resultsContainer.innerHTML = `
      <div class="results">
        <div class="no-results">Veuillez entrer au moins 3 caractères</div>
      </div>
    `;
    return;
  }

  loadingIndicator.classList.add('visible');
  
  try {
    const response = await fetch(`/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Erreur réseau');
    }
    
    const data = await response.json();
    updateResults(data);
    
    // Store the search results and query
    sessionStorage.setItem('lastSearchQuery', query);
    sessionStorage.setItem('lastSearchResults', JSON.stringify(data.results));
  } catch (error) {
    resultsContainer.innerHTML = `
      <div class="error">Une erreur est survenue lors de la recherche</div>
    `;
  } finally {
    loadingIndicator.classList.remove('visible');
  }
}

// Debounced search function
const debouncedSearch = debounce(performSearch, 300);

// Initialize page with stored results if they exist
document.addEventListener('DOMContentLoaded', () => {
  const storedQuery = sessionStorage.getItem('lastSearchQuery');
  const storedResults = sessionStorage.getItem('lastSearchResults');
  
  if (storedQuery && storedResults) {
    searchInput.value = storedQuery;
    updateResults({ results: JSON.parse(storedResults) });
  }

  // Listen for input changes
  searchInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });

  // Handle form submission
  document.querySelector('.search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    performSearch(searchInput.value);
  });
});
