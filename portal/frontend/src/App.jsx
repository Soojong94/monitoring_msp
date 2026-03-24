import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Servers from './pages/Servers.jsx';
import AlertConfig from './pages/AlertConfig.jsx';
import System from './pages/System.jsx';
import Layout from './components/Layout.jsx';
import Users from './pages/Users.jsx';
import GrafanaUsers from './pages/GrafanaUsers.jsx';
import AlertHistory from './pages/AlertHistory.jsx';
import Reports from './pages/Reports.jsx';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="servers" element={<Servers />} />
          <Route path="alerts" element={<AlertConfig />} />
          <Route path="system" element={<System />} />
          <Route path="users" element={<Users />} />
          <Route path="grafana-users" element={<GrafanaUsers />} />
          <Route path="alert-history" element={<AlertHistory />} />
          <Route path="reports" element={<Reports />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
