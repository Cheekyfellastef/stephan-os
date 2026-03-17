import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AIStoreProvider } from './state/aiStore';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AIStoreProvider>
      <App />
    </AIStoreProvider>
  </React.StrictMode>,
);
