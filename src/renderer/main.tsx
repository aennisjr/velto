import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import App from './App.js';
import QuickCapture from './QuickCapture.js';
import QuickSearch from './QuickSearch.js';
import './styles.css';
import { initTheme } from './ThemeMenu.js';

initTheme();

const isQuick = window.location.hash.startsWith('#/quick');
const isCapture = window.location.hash.startsWith('#/capture');
document.body.classList.toggle('quick-body', isQuick || isCapture);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>{isQuick ? <QuickSearch /> : isCapture ? <QuickCapture /> : <App />}</StrictMode>,
);
