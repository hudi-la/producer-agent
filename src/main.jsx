import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import AuthGate from './components/AuthGate.jsx'
import { ModulesProvider } from './lib/ModulesContext.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>
      <ModulesProvider>
        <App />
      </ModulesProvider>
    </AuthGate>
  </React.StrictMode>,
)
