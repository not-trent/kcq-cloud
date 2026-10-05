import React from 'react';
import ReactDOM from 'react-dom/client';
import KcqApp from './KcqApp';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('KCQ Cloud could not register its offline app shell.', error);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <KcqApp />
  </React.StrictMode>
);
