# Saudaa — Verified Traders Marketplace & Live Insights

Saudaa is a premium, high-performance financial platform linking novice users with verified, elite traders. Built with a stunning **Organic Minimalist Light** aesthetic (warm creams, slate shadows, and sage green accents), Saudaa features live candlestick background simulations, real-time index stock tickers, responsive user and trader dashboards, and a complete admin panel.

---

## 🚀 Live Demo & Hosting

- **Production Deployment:** [https://saudaa.vercel.app](https://saudaa.vercel.app)
- **Tech Stack:** Node.js, Express, HTML5 Canvas, Tailwind CSS / Vanilla Utility CSS.

---

## ✨ Features

- 📊 **Real-time Market Strip:** Sticky tickers showing stock exchange quotes (AAPL, MSFT, TSLA, NVDA, AMZN) powered by Alpha Vantage with automatic simulated fallback rate-limiting.
- 📈 **Candlestick Hero Animation:** Seamless interactive HTML5 canvas animation showing falling stock candlesticks matching market updates.
- 👥 **Trader Leaderboard:** Multi-dimensional ranking system comparing Win Rate, ROI, active subscribers, and customized trading strategies.
- 💬 **Complimentary Signals Chatbox:** Interactive simulated lounge bot presenting live insights and trade setups.
- 🔐 **Multi-Factor Auth (MFA):** Secure administrator logins utilizing scrypt-hashing and HMAC-SHA256 based MFA verification.
- 🛠️ **Admin Panel:** Complete interface to review transaction history, edit trader parameters, modify pricing plans, and toggle client suspension states.

---

## 🛠️ Installation & Local Setup

### Prerequisites
- Node.js (v18 or higher)
- NPM

### 1. Clone the repository
```bash
git clone https://github.com/sahil250303/Saudaa.git
cd Saudaa
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

---

## 🌍 Environment Variables

Create a `.env` file in the root directory to customize credentials and API keys:

```env
PORT=3000
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password
```

---

## 📦 Deployment Configuration

This repository is optimized for deployment to Vercel via the `vercel.json` routing configuration:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "server.js"
    }
  ]
}
```

---

## 📄 License

This project is licensed under the ISC License.
