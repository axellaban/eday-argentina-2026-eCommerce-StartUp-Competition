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
      // Ruta relativa únicamente, para no permitir redirecciones a otro dominio.
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/copiloto";
    } catch {
      setError("Error de red al iniciar sesión.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #011929 0%, #022840 50%, #063454 100%)",
        color: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div className="ambient-orb orb-1"></div>
      <div className="ambient-orb orb-2"></div>

      <form
        onSubmit={submit}
        style={{
          position: "relative",
          zIndex: 10,
          width: "100%",
          maxWidth: "420px",
          background: "rgba(7, 36, 61, 0.85)",
          border: "1px solid rgba(69, 119, 178, 0.28)",
          borderRadius: "20px",
          padding: "32px",
          backdropFilter: "blur(20px)",
        }}
      >
        <img
          src="/logos argentina/PNG/SIN BAJADA/02.png"
          alt="eCommerce DAY Argentina"
          style={{ height: "34px", width: "auto", marginBottom: "20px" }}
        />
        <h1 style={{ fontSize: "1.35rem", fontWeight: 800, marginBottom: "6px" }}>
          Acceso al Copiloto
        </h1>
        <p style={{ fontSize: "0.85rem", color: "#D5DCF2", marginBottom: "22px" }}>
          Panel del operador · eCommerce StartUp Competition Argentina 2026
        </p>

        <label
          style={{
            display: "block",
            fontSize: "0.75rem",
            fontWeight: 700,
            textTransform: "uppercase",
            color: "#859CC2",
            marginBottom: "8px",
          }}
        >
          Contraseña
        </label>
        <input
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: "12px",
            background: "#0B3552",
            border: "1px solid rgba(0, 168, 255, 0.3)",
            color: "#FFFFFF",
            fontSize: "0.95rem",
            outline: "none",
            marginBottom: "16px",
          }}
        />

        {error && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.12)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "#EF4444",
              borderRadius: "10px",
              padding: "10px 14px",
              fontSize: "0.82rem",
              marginBottom: "16px",
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            background: "linear-gradient(135deg, #00A8FF, #18A0D8)",
            color: "#FFFFFF",
            fontSize: "0.95rem",
            fontWeight: 800,
            border: "none",
            opacity: loading || !password ? 0.6 : 1,
          }}
        >
          {loading ? "Verificando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
