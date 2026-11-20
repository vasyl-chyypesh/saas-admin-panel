import type { JSX } from 'react';
import { Link, Navigate, NavLink, Route, Routes } from 'react-router';
import { ClientDetailPage } from './feature/client/ClientDetailPage.tsx';
import { ClientListPage } from './feature/client/ClientListPage.tsx';
import { InvoiceCreatePage } from './feature/invoice/InvoiceCreatePage.tsx';
import { InvoiceDetailPage } from './feature/invoice/InvoiceDetailPage.tsx';
import { InvoiceListPage } from './feature/invoice/InvoiceListPage.tsx';
import { PlanCreatePage } from './feature/plan/PlanCreatePage.tsx';
import { PlanEditPage } from './feature/plan/PlanEditPage.tsx';
import { PlanListPage } from './feature/plan/PlanListPage.tsx';

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
      <aside className="sidebar">
        <Link to="/clients" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          SaaS Admin
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/clients">Clients</NavLink>
          <NavLink to="/plans">Plans</NavLink>
          <NavLink to="/invoices">Invoices</NavLink>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/clients" replace />} />
          <Route path="/clients" element={<ClientListPage />} />
          <Route path="/clients/:id" element={<ClientDetailPage />} />
          <Route path="/clients/:id/invoices/new" element={<InvoiceCreatePage />} />
          <Route path="/invoices" element={<InvoiceListPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/plans" element={<PlanListPage />} />
          <Route path="/plans/new" element={<PlanCreatePage />} />
          <Route path="/plans/:id" element={<PlanEditPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
};
