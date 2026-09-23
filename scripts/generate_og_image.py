import base64
import subprocess
import os

with open('public/logos/eday-latam-02.png', 'rb') as f:
    logo_b64 = base64.b64encode(f.read()).decode('utf-8')

html_content = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;600;700&display=swap');

    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}

    body {{
      width: 1200px;
      height: 630px;
      overflow: hidden;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: #011320;
      background-image: 
        radial-gradient(circle at 12% 18%, rgba(0, 168, 255, 0.22) 0%, transparent 45%),
        radial-gradient(circle at 88% 82%, rgba(34, 197, 94, 0.15) 0%, transparent 48%),
        radial-gradient(circle at 72% 16%, rgba(167, 139, 250, 0.14) 0%, transparent 40%),
        linear-gradient(155deg, #01101b 0%, #02263e 52%, #031828 100%);
      color: #ffffff;
      padding: 44px 54px;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }}

    /* Subtle grid overlay */
    body::before {{
      content: "";
      position: absolute;
      inset: 0;
      background-image: 
        linear-gradient(to right, rgba(69, 119, 178, 0.06) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(69, 119, 178, 0.06) 1px, transparent 1px);
      background-size: 32px 32px;
      pointer-events: none;
    }}

    /* Sleek outer border frame */
    .frame-border {{
      position: absolute;
      inset: 16px;
      border: 1px solid rgba(69, 119, 178, 0.24);
      border-radius: 20px;
      pointer-events: none;
    }}

    /* Header */
    .header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
      z-index: 2;
    }}

    .logo-img {{
      height: 52px;
      width: auto;
      object-fit: contain;
      filter: drop-shadow(0 4px 16px rgba(0, 0, 0, 0.5));
    }}

    .header-badges {{
      display: flex;
      align-items: center;
      gap: 14px;
    }}

    .organizer-tag {{
      font-size: 13px;
      font-weight: 500;
      color: #94A3B8;
      letter-spacing: 0.02em;
    }}

    .organizer-tag strong {{
      color: #FFFFFF;
      font-weight: 700;
    }}

    .live-chip {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.4);
      border-radius: 999px;
      padding: 6px 14px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 600;
      color: #4ade80;
      letter-spacing: 0.06em;
      box-shadow: 0 0 15px rgba(34, 197, 94, 0.15);
    }}

    .live-dot {{
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 10px #22c55e;
    }}

    /* Main Grid */
    .main-grid {{
      display: grid;
      grid-template-columns: 1.18fr 0.82fr;
      gap: 36px;
      align-items: center;
      position: relative;
      z-index: 2;
      margin: auto 0;
    }}

    /* Left Column */
    .left-col {{
      display: flex;
      flex-direction: column;
      gap: 14px;
    }}

    .badge-event {{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      align-self: flex-start;
      background: rgba(0, 168, 255, 0.12);
      border: 1px solid rgba(0, 168, 255, 0.35);
      border-radius: 999px;
      padding: 5px 14px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: #38bdf8;
      text-transform: uppercase;
    }}

    .hero-title {{
      font-size: 64px;
      font-weight: 900;
      line-height: 1.0;
      letter-spacing: -0.04em;
      color: #ffffff;
      margin-top: 2px;
    }}

    .hero-subtitle-block {{
      display: flex;
      flex-direction: column;
      gap: 4px;
    }}

    .hero-gradient-sub {{
      font-size: 32px;
      font-weight: 800;
      line-height: 1.15;
      letter-spacing: -0.02em;
      background: linear-gradient(90deg, #00A8FF 0%, #38bdf8 45%, #34d399 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }}

    .hero-desc {{
      font-size: 16.5px;
      line-height: 1.45;
      color: #94A3B8;
      max-width: 530px;
      margin-top: 4px;
    }}

    /* Competition Badges */
    .comp-tags {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 8px;
    }}

    .tag-item {{
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(9, 42, 68, 0.65);
      border: 1px solid rgba(69, 119, 178, 0.3);
      border-radius: 10px;
      padding: 7px 13px;
      font-size: 12.5px;
      font-weight: 600;
      color: #E2E8F0;
      backdrop-filter: blur(8px);
    }}

    .tag-dot {{
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }}

    .tag-dot.c1 {{ background: #a78bfa; box-shadow: 0 0 8px #a78bfa; }}
    .tag-dot.c2 {{ background: #34d399; box-shadow: 0 0 8px #34d399; }}
    .tag-dot.c3 {{ background: #fb923c; box-shadow: 0 0 8px #fb923c; }}

    /* Right Column - Mock Dashboard Card */
    .dashboard-preview {{
      background: rgba(8, 36, 58, 0.85);
      border: 1px solid rgba(69, 119, 178, 0.38);
      border-radius: 20px;
      padding: 22px 24px;
      box-shadow: 
        0 20px 50px rgba(1, 18, 30, 0.65),
        0 0 0 1px rgba(255, 255, 255, 0.05),
        inset 0 1px 0 rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(12px);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }}

    .card-top {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(69, 119, 178, 0.2);
    }}

    .card-tag {{
      display: flex;
      align-items: center;
      gap: 7px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 700;
      color: #38bdf8;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }}

    .card-status {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 600;
      color: #4ade80;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.25);
      border-radius: 6px;
      padding: 2px 8px;
    }}

    .pitch-score-row {{
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}

    .pitch-info {{
      display: flex;
      flex-direction: column;
      gap: 4px;
    }}

    .pitch-label {{
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748B;
      font-weight: 600;
    }}

    .pitch-name {{
      font-size: 18px;
      font-weight: 700;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      gap: 8px;
    }}

    .podium-tag {{
      font-size: 11px;
      background: rgba(246, 180, 14, 0.18);
      color: #F6B40E;
      border: 1px solid rgba(246, 180, 14, 0.4);
      border-radius: 4px;
      padding: 1px 6px;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
    }}

    .score-badge {{
      display: flex;
      align-items: baseline;
      gap: 3px;
      background: linear-gradient(135deg, rgba(0, 168, 255, 0.22), rgba(34, 197, 94, 0.16));
      border: 1px solid rgba(0, 168, 255, 0.45);
      padding: 8px 14px;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0, 168, 255, 0.18);
    }}

    .score-val {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 26px;
      font-weight: 800;
      color: #38bdf8;
      line-height: 1;
    }}

    .score-max {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 600;
      color: #94A3B8;
    }}

    /* Indicator Progress Bars */
    .card-indicators {{
      display: flex;
      flex-direction: column;
      gap: 9px;
    }}

    .ind-row {{
      display: flex;
      flex-direction: column;
      gap: 4px;
    }}

    .ind-labels {{
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      font-weight: 600;
      color: #CBD5E1;
    }}

    .ind-track {{
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 99px;
      overflow: hidden;
    }}

    .ind-prog {{
      height: 100%;
      border-radius: 99px;
    }}

    .prog-1 {{ width: 96%; background: linear-gradient(90deg, #00A8FF, #38bdf8); }}
    .prog-2 {{ width: 92%; background: linear-gradient(90deg, #34d399, #10b981); }}
    .prog-3 {{ width: 88%; background: linear-gradient(90deg, #a78bfa, #8b5cf6); }}
    .prog-4 {{ width: 94%; background: linear-gradient(90deg, #fb923c, #f97316); }}

    .card-footer {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 10px;
      border-top: 1px solid rgba(69, 119, 178, 0.2);
      font-size: 11px;
      color: #64748B;
      font-weight: 600;
    }}

    .card-footer span {{
      color: #94A3B8;
    }}

    /* Global Bottom Features Bar */
    .bottom-features {{
      position: relative;
      z-index: 2;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid rgba(69, 119, 178, 0.2);
      padding-top: 16px;
    }}

    .feat-group {{
      display: flex;
      align-items: center;
      gap: 28px;
    }}

    .feat-item {{
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      color: #94A3B8;
    }}

    .feat-icon {{
      color: #00A8FF;
      font-size: 14px;
    }}

    .feat-right {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 600;
      color: #64748B;
    }}
  </style>
</head>
<body>
  <div class="frame-border"></div>

  <!-- Header -->
  <div class="header">
    <img src="data:image/png;base64,{logo_b64}" alt="eCommerce DAY" class="logo-img" />
    <div class="header-badges">
      <span class="organizer-tag">Organiza <strong>eCommerce Institute</strong></span>
      <div class="live-chip">
        <span class="live-dot"></span>
        EN VIVO
      </div>
    </div>
  </div>

  <!-- Main Grid -->
  <div class="main-grid">
    <!-- Left Column: Branding & Value Prop -->
    <div class="left-col">
      <div class="badge-event">
        <span>⚡</span> DEMO DAY · 2026
      </div>

      <div class="hero-subtitle-block">
        <h1 class="hero-title">Demo Day</h1>
        <div class="hero-gradient-sub">Evaluación en Vivo con IA</div>
      </div>

      <p class="hero-desc">
        Plataforma oficial de evaluación en tiempo real con Copiloto de Inteligencia Artificial y jurado de líderes del ecosistema.
      </p>

      <!-- Competitions -->
      <div class="comp-tags">
        <div class="tag-item">
          <span class="tag-dot c1"></span>
          StartUp Competition
        </div>
        <div class="tag-item">
          <span class="tag-dot c2"></span>
          AI Unified Commerce
        </div>
        <div class="tag-item">
          <span class="tag-dot c3"></span>
          AI Agentic MVP
        </div>
      </div>
    </div>

    <!-- Right Column: Dashboard Card Preview -->
    <div class="dashboard-preview">
      <div class="card-top">
        <div class="card-tag">
          <span>●</span> Copiloto IA · Scoring
        </div>
        <div class="card-status">
          Radar Dinámico
        </div>
      </div>

      <div class="pitch-score-row">
        <div class="pitch-info">
          <span class="pitch-label">Pitch en Evaluación</span>
          <span class="pitch-name">
            Líder Provisional
            <span class="podium-tag">1º</span>
          </span>
        </div>
        <div class="score-badge">
          <span class="score-val">4.88</span>
          <span class="score-max">/ 5.0</span>
        </div>
      </div>

      <div class="card-indicators">
        <div class="ind-row">
          <div class="ind-labels">
            <span>Potencial de Mercado</span>
            <span style="color: #38bdf8;">4.9</span>
          </div>
          <div class="ind-track"><div class="ind-prog prog-1"></div></div>
        </div>

        <div class="ind-row">
          <div class="ind-labels">
            <span>Innovación Agéntica</span>
            <span style="color: #34d399;">4.8</span>
          </div>
          <div class="ind-track"><div class="ind-prog prog-2"></div></div>
        </div>

        <div class="ind-row">
          <div class="ind-labels">
            <span>Gobernanza &amp; Seguridad</span>
            <span style="color: #a78bfa;">4.7</span>
          </div>
          <div class="ind-track"><div class="ind-prog prog-3"></div></div>
        </div>

        <div class="ind-row">
          <div class="ind-labels">
            <span>Impacto Medible</span>
            <span style="color: #fb923c;">4.9</span>
          </div>
          <div class="ind-track"><div class="ind-prog prog-4"></div></div>
        </div>
      </div>

      <div class="card-footer">
        <div>Sincronización: <span>Instantánea</span></div>
        <div>Jurados: <span>Múltiples</span></div>
      </div>
    </div>
  </div>

  <!-- Bottom Features -->
  <div class="bottom-features">
    <div class="feat-group">
      <div class="feat-item">
        <span class="feat-icon">✓</span> Transcripción &amp; Análisis en Vivo
      </div>
      <div class="feat-item">
        <span class="feat-icon">✓</span> Radar de Competencias
      </div>
      <div class="feat-item">
        <span class="feat-icon">✓</span> Podio Automatizado
      </div>
    </div>
    <div class="feat-right">
      LATAM 2026 · LIVE PLATFORM
    </div>
  </div>
</body>
</html>
"""

with open('/tmp/og_template_v3.html', 'w') as f:
    f.write(html_content)

print("Template v3 generated successfully")
