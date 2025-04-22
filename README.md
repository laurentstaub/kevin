# Medication Search Application

A web application for searching medications and finding nearby pharmacies in France. Built with Node.js, Express, and PostgreSQL.

## Features

- 🔍 Advanced medication search functionality
- 🏥 Nearby pharmacy locator
- 📊 Detailed product information
- 🗺️ Pharmacy distance calculation
- 🌐 REST API endpoints
- 📱 Responsive web interface

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm (comes with Node.js)

## Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd 00_kevin
```

2. Install dependencies:
```bash
npm install
```

3. Set up the PostgreSQL database:
- Create a database named `incidents_json`
- Import the required schema and data (see Database Setup section)

4. Configure the database connection:
Update the database configuration in `index.js` with your credentials:
```javascript
const pool = new Pool({
  user: 'your_username',
  host: 'localhost',
  database: 'incidents_json',
  port: 5432,
});
```

## Running the Application

### Development Mode
```bash
npm run dev
```
This will start the server with nodemon for automatic reloading.

### Production Mode
```bash
npm start
```

The application will be available at `http://localhost:3000`

## API Endpoints

### Search Medications
```
GET /search?q=[query]&filter=[filter]
```
- `query`: Search term
- `filter`: Optional filter parameter (default: 'all')

### Get Product Details
```
GET /product/:id
```
- `id`: Product CIS code
- Query parameters:
  - `radius`: Search radius in km (default: 5)
  - `lat`: Latitude for pharmacy search
  - `lng`: Longitude for pharmacy search

### Find Nearby Pharmacies
```
GET /api/nearby-pharmacies
```
Query parameters:
- `lat`: Latitude
- `lng`: Longitude
- `radius`: Search radius in km (default: 5)

## Project Structure

```
project-root/
├── src/
│   └── search.js       # Search functionality
├── views/
│   ├── search_page.pug # Search page template
│   └── product.pug     # Product details template
├── public/             # Static assets
├── index.js           # Main application file
└── package.json       # Project dependencies
```

## Testing

Run the test suite:
```bash
npm test
```

## Development

### Code Style
- Follow the established code style guidelines in `.cursor/rules`
- Use 2 spaces for indentation
- Maximum line length of 80 characters
- Use ES6+ features

### Contributing
1. Create a feature branch
2. Make your changes
3. Write/update tests
4. Submit a pull request

## Database Schema

The application uses the following main tables:
- `dbpm.cis_bdpm`: Medication information
- `dbpm.cis_compo_bdpm`: Medication compositions
- `dbpm.cis_cip_bdpm`: Product presentations
- `officines.etablissements`: Pharmacy information

## License

ISC License

## Author

[Your Name]

## Support

For support, please open an issue in the repository or contact [contact information].
