import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/ui';
import { SessionProvider } from './lib/session';
import './index.css';

// GitHub Pages has no rewrite rules: its 404.html sends deep links (e.g. a Telegram button to
// /approvals) to the app root as ?__p=<path>. Put the real path back before the router starts.
const redirected = new URLSearchParams(window.location.search).get('__p');
if (redirected !== null) {
  window.history.replaceState(null, '', import.meta.env.BASE_URL + redirected.replace(/^\//, '') + window.location.hash);
}
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <SessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
