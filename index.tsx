import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

try {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (e: any) {
  // Záchranná brzda: Pokud React selže při startu, vypíšeme chybu na obrazovku
  console.error("Application Crash:", e);
  rootElement.innerHTML = `
    <div style="padding: 20px; color: red; font-family: sans-serif;">
      <h1>Critical Error</h1>
      <p>Aplikace se nemohla spustit.</p>
      <pre style="background: #f0f0f0; padding: 10px; border-radius: 5px; overflow: auto;">${e.message || String(e)}</pre>
    </div>
  `;
}