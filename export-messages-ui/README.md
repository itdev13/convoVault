# ConvoVault Dashboard

Modern React dashboard for ConvoVault - GHL Marketplace App

## 🚀 Features

- ✅ **GHL Context Integration** - Automatic authentication using GHL iframe context
- 💬 **Conversations Tab** - View and filter conversations
- ✉️ **Messages Tab** - View messages with conversation context
- 📤 **Export Tab** - Export messages as CSV or JSON with advanced filters
- 📥 **Import Tab** - Import messages from CSV/Excel files
- 🔄 **Sub-Account Selector** - Switch between multiple sub-accounts
- 🔐 **Secure** - JWT-based session management

## 📦 Installation

```bash
cd convo-vault-ui
npm install
```

## 🔧 Configuration

The app uses Vite proxy to connect to your backend API. Make sure your backend is running on `http://localhost:3003`.

If you need to change the backend URL, edit `vite.config.js`:

```javascript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3003', // Change this
      changeOrigin: true
    }
  }
}
```

## 🏃 Development

```bash
npm run dev
```

The app will start on `http://localhost:5173`

## 🏗️ Build for Production

```bash
npm run build
```

The built files will be in the `dist/` folder.

## 📱 Testing in GHL

### Development Mode

For local testing without GHL iframe:

1. Start the backend: `cd ../convo-vault && npm start`
2. Start the frontend: `npm run dev`
3. Open http://localhost:5173

The app will use mock context data in development mode.

### GHL Iframe Mode

1. Build the frontend: `npm run build`
2. Configure your GHL app to use the iframe URL
3. Set Custom Page URL in GHL Marketplace Portal

## 🎨 Tech Stack

- **React 18** - UI library
- **Vite** - Build tool
- **TailwindCSS** - Styling
- **React Query** - Data fetching
- **Axios** - HTTP client

## 📂 Project Structure

```
convo-vault-ui/
├── src/
│   ├── api/              # API service layer
│   │   ├── client.js     # Axios instance
│   │   ├── auth.js       # Auth API
│   │   ├── conversations.js
│   │   ├── messages.js
│   │   ├── export.js
│   │   └── import.js
│   ├── components/       # React components
│   │   ├── tabs/         # Tab components
│   │   ├── Dashboard.jsx
│   │   ├── Header.jsx
│   │   ├── LoadingScreen.jsx
│   │   └── ErrorScreen.jsx
│   ├── context/          # React context
│   │   └── AuthContext.jsx
│   ├── hooks/            # Custom hooks
│   │   └── useGHLContext.js
│   ├── App.jsx           # Main app
│   ├── main.jsx          # Entry point
│   └── index.css         # Global styles
├── index.html
├── vite.config.js
├── tailwind.config.js
└── package.json
```

## 🔐 Authentication Flow

1. **GHL SDK** loads and provides context (`locationId`, `userId`, `companyId`)
2. **Frontend** calls `/api/auth/verify` with context
3. **Backend** validates that sub-account has OAuth token
4. **Backend** returns JWT session token
5. **Frontend** stores JWT and makes authenticated API calls

## 🌐 API Endpoints Used

All endpoints are proxied through Vite to `http://localhost:3003/api`

- `POST /api/auth/verify` - Create session
- `POST /api/auth/refresh` - Refresh session
- `GET /api/auth/locations` - Get all sub-accounts
- `GET /api/conversations/download` - Get conversations
- `GET /api/messages/:id` - Get messages
- `GET /api/export/messages` - Export messages
- `POST /api/import/upload` - Upload CSV/Excel

## 🎯 Environment Variables

Create `.env` file (optional):

```env
VITE_API_URL=http://localhost:3003/api
```

## 📝 Notes

- The app uses GHL's JavaScript SDK for context
- In development mode, mock context data is used
- JWT tokens expire after 1 hour
- CORS is handled by Vite proxy in development
- In production, ensure your backend has proper CORS configuration

## 🆘 Troubleshooting

**"Not authenticated" error:**
- Ensure backend is running
- Check that OAuth token exists in database
- Verify JWT_SECRET is set in backend .env

**GHL context not loading:**
- Check browser console for errors
- Ensure GHL SDK script is loaded
- Try using URL parameters as fallback

**API calls failing:**
- Check Vite proxy configuration
- Verify backend is running on correct port
- Check browser network tab for errors

## 📄 License

MIT

