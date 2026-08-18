import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initNativeAppUrlOpen } from './lib/appUrlOpen';
import { registerAutoUpdatingServiceWorker, unregisterNativeServiceWorkers } from './registerServiceWorker';

function renderApp() {
  if (import.meta.env.VITE_CAPACITOR !== 'true') {
    registerAutoUpdatingServiceWorker();
  }
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}

async function boot() {
  // Quitar SW viejos ANTES del primer fetch: si no, el login recibe index.html
  // y JSON.parse lanza Unexpected token '<'.
  if (import.meta.env.VITE_CAPACITOR === 'true') {
    await unregisterNativeServiceWorkers();
  }
  // Consumir App Link (launch URL) antes del primer render para no perder el
  // token SSO HMAC (~60s). En web/PWA initNativeAppUrlOpen es no-op.
  await initNativeAppUrlOpen();
  renderApp();
}

boot();
