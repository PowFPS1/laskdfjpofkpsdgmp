
import React from 'react'; // Correct import for new JSX transform
import ReactDOM from 'react-dom/client';
import App from './App';

// Fix: Removed window.process polyfill and manual API key setup instructions
// to adhere to API key handling guidelines (must use process.env.API_KEY set externally).
// The application should assume process.env.API_KEY is available in the execution environment.

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);