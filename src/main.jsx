import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/funnel-display';
import '@fontsource-variable/funnel-sans';
import 'katex/dist/katex.min.css';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
