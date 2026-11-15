import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/hahmlet';
import '@fontsource/gowun-dodum/400.css';
import '@fontsource/nanum-pen-script/400.css';
import App from './App';

// Dev-only effects lab (?fxlab): not part of the production build.
const FxLab = import.meta.env.DEV && new URLSearchParams(location.search).has('fxlab') ? lazy(() => import('./dev/FxLab')) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {FxLab ? (
      <Suspense>
        <FxLab />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
