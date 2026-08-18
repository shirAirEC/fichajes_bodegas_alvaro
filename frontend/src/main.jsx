import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initNativeAppUrlOpen } from './lib/appUrlOpen';
import { registerAutoUpdatingServiceWorker } from './registerServiceWorker';

function renderApp() {
  registerAutoUpdatingServiceWorker();
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}

// Consumir App Link (launch URL) antes del primer render para no perder el
// token SSO HMAC (~60s). En web/PWA initNativeAppUrlOpen es no-op.
initNativeAppUrlOpen().finally(renderApp);
