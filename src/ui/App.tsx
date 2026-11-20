import type { JSX } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router';
import { ClientDetailPage } from './feature/client/ClientDetailPage.tsx';
import { ClientListPage } from './feature/client/ClientListPage.tsx';

const NotFoundPage = (): JSX.Element => (
  <section>
    <title>Not found · SaaS Admin Panel</title>
    <h1>Page not found</h1>
    <p>
      <Link to="/clients">Go to clients</Link>
    </p>
  </section>
);

export const App = (): JSX.Element => {
  return (
    <div className="layout">
      <header className="topbar">
        <span className="brand">SaaS Admin</span>
        <nav>
          <NavLink to="/clients">Clients</NavLink>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/clients" replace />} />
          <Route path="/clients" element={<ClientListPage />} />
          <Route path="/clients/:id" element={<ClientDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
};
