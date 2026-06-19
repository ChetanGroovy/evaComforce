import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { applyTheme, getInitialTheme, applyTextSize, getInitialTextSize } from './useTheme';

applyTheme(getInitialTheme()); // set <html data-theme> before first paint
applyTextSize(getInitialTextSize()); // set <html data-textsize> before first paint

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
