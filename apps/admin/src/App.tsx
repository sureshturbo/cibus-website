import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { adminApi, setUnauthorizedHandler } from "./api.js";
import type { Admin } from "./types.js";
import Login from "./pages/Login.js";
import Dashboard from "./pages/Dashboard.js";
import Products from "./pages/Products.js";
import Orders from "./pages/Orders.js";
import Categories from "./pages/Categories.js";
import Enquiries from "./pages/Enquiries.js";

interface SessionState {
  admin: Admin | null;
  checking: boolean;
}

export default function App() {
  const [session, setSession] = useState<SessionState>({ admin: null, checking: true });

  const refresh = useCallback(async () => {
    try {
      setSession({ admin: await adminApi.session(), checking: false });
    } catch {
      // A missing or expired session simply means "show the login form".
      setSession({ admin: null, checking: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any 401 anywhere in the app returns the operator to the login screen rather
  // than leaving a half-rendered page behind.
  useEffect(() => {
    setUnauthorizedHandler(() => setSession({ admin: null, checking: false }));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await adminApi.logout();
    } finally {
      setSession({ admin: null, checking: false });
    }
  }, []);

  if (session.checking) return <p className="loading">Checking your session…</p>;
  if (!session.admin) return <Login onSignedIn={(admin) => setSession({ admin, checking: false })} />;

  return (
    <div className="shell">
      <header className="masthead">
        <span className="brand">
          Cibus<span>Admin</span>
        </span>

        <nav className="nav">
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/orders">Orders</NavLink>
          <NavLink to="/products">Products</NavLink>
          <NavLink to="/categories">Categories</NavLink>
          <NavLink to="/enquiries">Enquiries</NavLink>
        </nav>

        <div className="session">
          <span className="who">{session.admin.fullName}</span>
          <button type="button" className="link-button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/products" element={<Products />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/enquiries" element={<Enquiries />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}