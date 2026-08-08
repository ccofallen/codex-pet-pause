import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function AndroidBootstrapPlaceholder() {
  return <main data-testid="android-bootstrap-root">Android startup placeholder</main>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AndroidBootstrapPlaceholder />
  </StrictMode>,
);
