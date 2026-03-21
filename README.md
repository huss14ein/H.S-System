<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Finova - Financial Management System

A comprehensive personal finance management application with AI-powered insights, budget automation, goal tracking, and investment planning.

## Quick Start

### Local Development

**Prerequisites:** Node.js 20+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env.local
   ```

3. Configure Supabase:
   - Get your Supabase URL and anon key from your project dashboard
   - Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`
   - For local AI testing, optionally set `VITE_GEMINI_API_KEY` (not required if using Supabase Edge Function)

4. Run the app:
   ```bash
   npm run dev
   ```

### Production Deployment

See **[`docs/DEPLOYMENT_CHECKLIST.md`](docs/DEPLOYMENT_CHECKLIST.md)** for the complete deployment guide.

**Quick summary:**
1. Set environment variables in Netlify and Supabase
2. Run database migrations in Supabase SQL editor
3. Deploy Edge Functions (`gemini-proxy`, `send-weekly-digest`)
4. Deploy to Netlify
5. Verify deployment

---

## Features

- **Budget Management:** Household budget engine, KSA-specific categories, AI-powered recommendations
- **Goal Tracking:** Goal funding router, waterfall allocation, progress tracking
- **Investment Planning:** Portfolio construction, risk analysis, recovery planning
- **AI Insights:** Financial persona, spending analysis, transaction categorization
- **Forecasting:** Scenario planning, net worth projections, goal outlook
- **Wealth Ultra:** Institutional-grade allocation, sleeve drift analysis, order planning

---

## Documentation

- **[Deployment Checklist](docs/DEPLOYMENT_CHECKLIST.md)** - Production deployment guide
- **[Deployment Summary](docs/DEPLOYMENT_SUMMARY.md)** - What's ready for deployment
- **[Implementation Status](docs/IMPLEMENTATION_STATUS.md)** - System enhancement status
- **[System Architecture](docs/SYSTEM_ARCHITECTURE.md)** - Architecture overview
- **[Pages & services wiring](docs/PAGES_SERVICES_WIRING.md)** - Routes, providers, cross-page actions
- **[Full UI sections wiring](docs/FULL_UI_SECTIONS_WIRING.md)** - Page-by-page cards, tabs, and data sources (companion to the wiring doc)
- **[Weekly Email Setup](docs/weekly_email_implementation.md)** - Email digest configuration

---

## Version

**Current Version:** 1.0.0.0

---

## License

Private - All rights reserved
