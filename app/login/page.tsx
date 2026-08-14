"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo iniciar sesión.");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") || "/copiloto";
      // Sólo rutas relativas, para no permitir redirecciones a otro dominio.
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/copiloto";
    } catch {
      setError("Error de red al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="center-screen">
      <form className="card stack" style={{ width: "min(420px, 100%)" }} onSubmit={submit}>
        <div>
          <a href="/" aria-label="Ir al dashboard">
            <img
              className="topbar__logo"
              src="/logos argentina/PNG/SIN BAJADA/02.png"
              alt="eCommerce DAY Argentina"
              style={{ marginBottom: 18 }}
            />
          </a>
          <h1 style={{ fontSize: "var(--fs-xl)", fontWeight: 800 }}>Acceso al Copiloto</h1>
          <p className="soft" style={{ fontSize: "var(--fs-xs)", marginTop: 6 }}>
            Panel del operador · eCommerce StartUp Competition Argentina 2026
          </p>
        </div>

        <div>
          <label className="label" htmlFor="pw">Contraseña</label>
          <input
            id="pw"
            className="input"
            type="password"
            value={password}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <div className="notice notice--bad">{error}</div>}

        <button className="btn btn--primary btn--block" type="submit" disabled={loading || !password}>
          {loading ? "Verificando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
