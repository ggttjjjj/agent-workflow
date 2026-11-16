import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {NoticeProvider} from './components/FloatingNotice';
import {ConfirmProvider} from './components/Dialog';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><NoticeProvider><ConfirmProvider><App/></ConfirmProvider></NoticeProvider></React.StrictMode>);
