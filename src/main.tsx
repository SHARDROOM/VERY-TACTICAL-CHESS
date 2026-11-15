import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/hahmlet';
import '@fontsource/gowun-dodum/400.css';
import '@fontsource/nanum-pen-script/400.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
