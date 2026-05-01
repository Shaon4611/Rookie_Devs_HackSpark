# RentPi Frontend

React frontend for the RentPi rental marketplace platform.

## Setup

```bash
npm install
```

## Development

```bash
npm start
```

Runs on http://localhost:3000

## Build

```bash
npm run build
```

Builds for production.

## Features

### Pages

- **Login** - User authentication
- **Register** - New user registration
- **Products** - Browse and filter rental products
- **Availability** - Check product availability for date ranges
- **Chat** - AI-powered chatbot with session management

### Features

- JWT-based authentication
- Protected routes with automatic redirection
- API gateway integration
- Loading states for all async operations
- Error handling with user-friendly messages
- Responsive design
- Session persistence
- Chat history management

## Environment Variables

Create `.env.local`:

```
REACT_APP_API_GATEWAY_URL=http://localhost:8000
```

## API Gateway

Frontend communicates exclusively through the API Gateway at port 8000:

- Login/Register: `POST /users/login`, `POST /users/register`
- Products: `GET /rentals/products`
- Availability: `GET /rentals/products/:id/availability`
- Chat: `POST /chat`

## Authentication

JWT tokens are stored in localStorage and automatically sent with all API requests via Authorization header.

## Styling

- Pure CSS with flexbox/grid layouts
- Mobile-responsive design
- Consistent color scheme and component styling
