// Saudaa Frontend Controller

// State
let tradersList = [];
let livePrices = {
  AAPL: { price: 189.84, change: 1.24, changePercent: 0.66 },
  MSFT: { price: 421.90, change: -0.85, changePercent: -0.20 },
  TSLA: { price: 174.60, change: 2.45, changePercent: 1.42 },
  NVDA: { price: 948.79, change: 15.30, changePercent: 1.64 },
  AMZN: { price: 181.28, change: -1.12, changePercent: -0.61 }
};
let discordActiveChannel = 'welcome';
let generalChatInterval = null;
let compareSelectedTraders = [];
let compareCurrentStep = 1;

// Initial Preload languages
const saLanguages = ["Sa", "सा", "سا", "Са", "Σα", "サ", "ס", "萨"];
let langIndex = 0;

let plansList = [];

async function fetchPlans() {
  try {
    const res = await fetch('/api/plans');
    if (!res.ok) throw new Error('Failed to fetch plans');
    const plans = await res.json();
    plansList = plans;
    
    // Update pricing cards on homepage
    plans.forEach(plan => {
      const priceEl = document.getElementById(`price-${plan.id}`);
      if (priceEl) {
        priceEl.innerHTML = `₹${plan.price}<span class="text-xs font-normal text-outline">/mo</span>`;
      }
    });

    // Update the dropdown option labels in the checkout plan select
    const planSelect = document.getElementById('checkout-plan-select');
    if (planSelect) {
      planSelect.innerHTML = plans.map(plan => 
        `<option value="${plan.id}">${plan.name} (₹${plan.price}/mo)</option>`
      ).join('');
    }
  } catch (err) {
    console.error('Error fetching plans:', err);
  }
}

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
  initPreloader();
  startLiveTicker();
  fetchPlans();
  fetchTraders();
  initDiscordBot();
  setupEventListeners();
  initStatsAnimation();
  initHeroCandlesAnimation();
  setupMobileMenu();
  initStickyMobileCta();
});

// 1. Multilingual Preloader Animation
function initPreloader() {
  const saEl = document.getElementById('preloader-sa');
  const barEl = document.getElementById('preloader-bar');
  const preloaderEl = document.getElementById('preloader');

  if (!saEl) return;

  // Cycle languages immediately
  const cycleInterval = setInterval(() => {
    langIndex = (langIndex + 1) % saLanguages.length;
    saEl.textContent = saLanguages[langIndex];
  }, 180);

  // Progress Bar Animation
  let progress = 0;
  const progressInterval = setInterval(() => {
    progress += 5;
    if (barEl) barEl.style.width = `${progress}%`;
    
    if (progress >= 100) {
      clearInterval(progressInterval);
      clearInterval(cycleInterval);
      
      // Finalize text to English and fade out
      saEl.textContent = "Sa";
      setTimeout(() => {
        preloaderEl.classList.add('preloader-hidden');
        setTimeout(() => preloaderEl.style.display = 'none', 500);
      }, 200);
    }
  }, 100);
}

// 2. Live Market Pricing Strip - API Poller
async function fetchStockPrices() {
  try {
    const res = await fetch('/api/market-strip');
    if (!res.ok) throw new Error('API fetch failed');
    const data = await res.json();
    
    if (data.source === 'simulated') {
      console.warn('Live Stock Strip is running on simulated fallback data.');
    } else {
      console.log('Live Stock Strip updated via Alpha Vantage API.');
    }
    
    // Update livePrices cache
    livePrices = data.data;
    updateTickerUI();
  } catch (error) {
    console.error('Error fetching live stock prices:', error);
  }
}

function startLiveTicker() {
  fetchStockPrices();
  // Poll every 10 seconds
  setInterval(fetchStockPrices, 10000);
}

function updateTickerUI() {
  Object.keys(livePrices).forEach(ticker => {
    const priceEl = document.getElementById(`price-${ticker}`);
    const changeEl = document.getElementById(`change-${ticker}`);

    if (priceEl && changeEl) {
      const val = livePrices[ticker];
      const changePct = val.changePercent !== undefined ? val.changePercent : val.change;
      const isUp = changePct >= 0;
      
      priceEl.textContent = `₹${val.price.toFixed(2)}`;
      changeEl.textContent = `${isUp ? '+' : ''}${changePct.toFixed(2)}%`;
      changeEl.className = `font-mono text-xs font-semibold ${isUp ? 'text-primary' : 'text-error'}`;
    }
  });
}

// 3. Fetch Traders & Leaderboard Ranking System
async function fetchTraders() {
  try {
    const res = await fetch('/api/traders');
    if (!res.ok) throw new Error('Failed to fetch traders profile list.');
    tradersList = await res.json();
    
    renderLeaderboard();
    populateTraderSelect();
    initChatBox(); // Load the interactive complimentary chat box
  } catch (error) {
    console.error('Error fetching traders list:', error);
    const body = document.getElementById('leaderboard-body');
    if (body) {
      body.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-error font-semibold">Error loading leaderboard metrics. Check backend connectivity.</td></tr>`;
    }
  }
}

function renderLeaderboard() {
  const body = document.getElementById('leaderboard-body');
  const searchVal = document.getElementById('leaderboard-search').value.toLowerCase();
  const strategyVal = document.getElementById('leaderboard-strategy').value;
  const sortVal = document.getElementById('leaderboard-sort').value;

  if (!body) return;

  // Filter
  let filtered = tradersList.filter(trader => {
    const matchesSearch = trader.name.toLowerCase().includes(searchVal) || trader.strategy.toLowerCase().includes(searchVal);
    
    let matchesStrategy = true;
    if (strategyVal !== 'all') {
      matchesStrategy = trader.strategy.toLowerCase().includes(strategyVal);
    }
    
    return matchesSearch && matchesStrategy;
  });

  // Sort
  filtered.sort((a, b) => {
    if (sortVal === 'rank') return a.rank - b.rank;
    if (sortVal === 'roi') return b.roi - a.roi;
    if (sortVal === 'winrate') return b.winRate - a.winRate;
    if (sortVal === 'subs') return b.subscribers - a.subscribers;
    return 0;
  });

  const mobileBody = document.getElementById('leaderboard-mobile');

  // Render Rows
  if (filtered.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-outline">No traders matching current criteria.</td></tr>`;
    if (mobileBody) {
      mobileBody.innerHTML = `<div class="py-12 text-center text-outline text-sm">No traders matching current criteria.</div>`;
    }
    return;
  }

  body.innerHTML = filtered.map(t => {
    return `
      <tr class="hover:bg-surface-container-low/50 transition-colors">
        <td class="py-4 px-6 text-center font-mono font-bold text-on-surface">
          ${t.rank <= 3 ? `<span class="bg-primary-container/30 text-primary px-2.5 py-1 rounded-md">${t.rank}</span>` : t.rank}
        </td>
        <td class="py-4 px-6">
          <div class="flex items-center gap-3">
            <img src="${t.avatar}" alt="${t.name}" class="w-9 h-9 rounded-full object-cover border border-outline-variant/30"/>
            <div>
              <span class="block font-bold text-on-surface text-sm">${t.name}</span>
              <span class="block text-[11px] text-outline line-clamp-1">${t.description.substring(0, 48)}...</span>
            </div>
          </div>
        </td>
        <td class="py-4 px-6 font-semibold text-xs text-on-surface-variant">${t.strategy}</td>
        <td class="py-4 px-6 text-right font-mono text-xs text-on-surface">${t.winRate.toFixed(1)}%</td>
        <td class="py-4 px-6 text-right font-mono text-xs text-primary font-bold">+${t.roi.toFixed(1)}%</td>
        <td class="py-4 px-6 text-right font-mono text-xs text-on-surface-variant">${t.subscribers.toLocaleString()}</td>
        <td class="py-4 px-6 text-center">
          <button onclick="openCheckout('${t.id}', 'pro')" class="trader-row-btn bg-primary hover:bg-primary-container text-on-primary text-xs font-bold px-4 py-2 rounded-lg shadow-sm">
            Copy Inside suggestions
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (mobileBody) {
    mobileBody.innerHTML = filtered.map(t => {
      return `
        <div class="bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-5 flex flex-col gap-4 shadow-sm hover:border-primary-container transition-all">
          <div class="flex justify-between items-center">
            <div class="flex items-center gap-3">
              <div class="font-mono font-bold text-sm">
                ${t.rank <= 3 
                  ? `<span class="bg-primary-container/20 text-primary px-2.5 py-1 rounded-md text-xs">Rank ${t.rank}</span>` 
                  : `<span class="text-outline text-xs">Rank #${t.rank}</span>`}
              </div>
              <div class="flex items-center gap-2.5">
                <img src="${t.avatar}" alt="${t.name}" class="w-9 h-9 rounded-full object-cover border border-outline-variant/30"/>
                <div>
                  <span class="block font-bold text-on-surface text-sm leading-tight">${t.name}</span>
                  <span class="block text-[10px] text-outline mt-0.5">${t.strategy}</span>
                </div>
              </div>
            </div>
            <div class="text-right">
              <span class="block text-[9px] font-sans text-on-surface-variant/50 tracking-wider uppercase">Active Subs</span>
              <span class="block font-mono text-xs text-on-surface-variant font-bold mt-0.5">${t.subscribers.toLocaleString()}</span>
            </div>
          </div>
          
          <div class="grid grid-cols-2 gap-3 bg-surface-container-low border border-outline-variant/10 rounded-xl p-3 text-center">
            <div>
              <span class="text-[9px] text-outline block">WIN RATE</span>
              <span class="font-mono text-xs font-bold text-on-surface">${t.winRate.toFixed(1)}%</span>
            </div>
            <div>
              <span class="text-[9px] text-outline block">30d ROI</span>
              <span class="font-mono text-xs font-bold text-primary font-extrabold">+${t.roi.toFixed(1)}%</span>
            </div>
          </div>
          
          <button onclick="openCheckout('${t.id}', 'pro')" class="w-full bg-primary hover:bg-primary-container text-on-primary text-xs font-bold py-3.5 rounded-xl shadow-sm transition-all text-center">
            Copy Inside suggestions
          </button>
        </div>
      `;
    }).join('');
  }
}

function populateTraderSelect() {
  const select = document.getElementById('checkout-trader-select');
  if (!select) return;
  
  select.innerHTML = tradersList.map(t => `<option value="${t.id}">${t.name} (${t.strategy})</option>`).join('');
}

// 4. Checkout Gateway Modal & Authentication Pipeline
window.openCheckout = function(traderId = '', planTier = 'pro') {
  const modal = document.getElementById('checkout-modal');
  const select = document.getElementById('checkout-trader-select');
  const planSelect = document.getElementById('checkout-plan-select');
  
  if (!modal) return;

  if (traderId) {
    select.value = traderId;
  } else if (tradersList.length > 0) {
    select.value = tradersList[0].id;
  }

  planSelect.value = planTier;

  // Reset form status
  document.getElementById('checkout-form').classList.remove('hidden');
  document.getElementById('checkout-success').classList.add('hidden');
  document.getElementById('checkout-error').classList.add('hidden');

  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    const dialog = modal.querySelector('.scale-95') || modal.firstElementChild;
    if (dialog) dialog.classList.remove('scale-95');
  }, 50);
};

window.closeCheckout = function() {
  const modal = document.getElementById('checkout-modal');
  if (!modal) return;

  modal.classList.add('opacity-0');
  const dialog = modal.querySelector('.scale-95') || modal.firstElementChild;
  if (dialog) dialog.classList.add('scale-95');
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 300);
};

window.handleCheckout = async function(event) {
  event.preventDefault();
  
  const errorEl = document.getElementById('checkout-error');
  const submitBtn = document.getElementById('checkout-submit');
  
  const traderId = document.getElementById('checkout-trader-select').value;
  const plan = document.getElementById('checkout-plan-select').value;
  const email = document.getElementById('checkout-email').value;
  const password = document.getElementById('checkout-password').value;
  
  const cardNumber = document.getElementById('checkout-card').value;
  const expiry = document.getElementById('checkout-expiry').value;
  const cvc = document.getElementById('checkout-cvc').value;

  errorEl.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing Transaction...';

  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, traderId, plan, cardNumber, expiry, cvc })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Checkout process failed.');

    // Show Success screen
    document.getElementById('checkout-form').classList.add('hidden');
    document.getElementById('checkout-success').classList.remove('hidden');
    
    document.getElementById('success-subid').textContent = data.subId;
    document.getElementById('success-email').textContent = data.email;
    document.getElementById('success-password').textContent = data.password;

  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span class="material-symbols-outlined text-[16px]">lock</span> Process Payment & Subscribe`;
  }
};

// 5. Discord-style Support Chatbot
function initDiscordBot() {
  switchDiscordChannel('welcome');
}

window.toggleDiscordBot = function() {
  const win = document.getElementById('discord-bot-window');
  if (!win) return;
  
  if (win.classList.contains('hidden')) {
    win.classList.remove('hidden');
    setTimeout(() => {
      win.classList.remove('opacity-0');
    }, 50);
    
    // Start active general chat channel streamer if General is open
    if (discordActiveChannel === 'general') {
      startGeneralChatStream();
    }
  } else {
    win.classList.add('opacity-0');
    setTimeout(() => {
      win.classList.add('hidden');
    }, 300);
    stopGeneralChatStream();
  }
};

window.switchDiscordChannel = function(channel) {
  discordActiveChannel = channel;
  
  // Highlight sidebar selected
  const channels = ['welcome', 'announcements', 'support', 'general'];
  channels.forEach(ch => {
    const btn = document.getElementById(`chan-${ch}`);
    if (btn) {
      if (ch === channel) {
        btn.className = "w-full flex items-center gap-1 px-1.5 py-1.5 rounded text-[10px] text-primary font-bold bg-surface-container";
      } else {
        btn.className = "w-full flex items-center gap-1 px-1.5 py-1.5 rounded text-[10px] text-on-surface-variant hover:bg-surface-container-high transition-colors";
      }
    }
  });

  // Toggle input field availability (only allowed in support and general-chat)
  const inputContainer = document.getElementById('discord-input-container');
  const inputField = document.getElementById('discord-input-field');
  if (inputContainer && inputField) {
    if (channel === 'support' || channel === 'general') {
      inputContainer.style.display = 'block';
      inputField.placeholder = `Message #${channel === 'support' ? 'support-bot' : 'general-chat'}`;
      inputField.disabled = false;
    } else {
      inputContainer.style.display = 'none';
      inputField.disabled = true;
    }
  }

  // Load Channel Logs
  const messagesLog = document.getElementById('discord-messages');
  if (!messagesLog) return;
  messagesLog.innerHTML = '';

  stopGeneralChatStream();

  if (channel === 'welcome') {
    messagesLog.innerHTML = `
      <div class="space-y-4">
        <div class="text-center py-6 border-b border-outline-variant/20">
          <span class="material-symbols-outlined text-[48px] text-primary">campaign</span>
          <h5 class="font-bold text-sm mt-2 text-on-surface">Welcome to Saudaa Lounge</h5>
          <p class="text-[10px] text-outline">The community lounge for premium traders</p>
        </div>
        <div class="flex gap-2.5 items-start">
          <div class="w-6 h-6 rounded bg-primary text-on-primary flex items-center justify-center font-bold text-[9px] shrink-0">BOT</div>
          <div>
            <span class="font-bold text-xs text-on-surface">LoungeBot</span>
            <span class="discord-system-msg ml-1">Today at 10:14 AM</span>
            <p class="text-xs text-on-surface-variant mt-1">Hello! Welcome to the Saudaa community chat room! Check out our channels on the sidebar:<br/>
              - <span class="font-bold text-primary">#welcome:</span> This screen.<br/>
              - <span class="font-bold text-primary">#updates:</span> Official platform feature releases.<br/>
              - <span class="font-bold text-primary">#support-bot:</span> Interactive Q&A chat for account & pricing assistance.<br/>
              - <span class="font-bold text-primary">#general-chat:</span> Live discussions and market signals stream.
            </p>
          </div>
        </div>
      </div>
    `;
  } else if (channel === 'announcements') {
    messagesLog.innerHTML = `
      <div class="space-y-4">
        <div class="flex gap-2.5 items-start">
          <div class="w-6 h-6 rounded bg-primary text-on-primary flex items-center justify-center font-bold text-[9px] shrink-0">MOD</div>
          <div>
            <span class="font-bold text-xs text-primary">Admin_Dave</span>
            <span class="discord-user-badge bg-primary-fixed text-primary ml-1">Team</span>
            <p class="text-xs text-on-surface-variant mt-1">🚀 **Saudaa Version 1.4 Live Release!**<br/>
              We have completed backend integration for 10 individual trader terminals, dynamic leaderboard filtering, and mock instant subscription processing. Subscriptions now provide access credentials instantly!
            </p>
          </div>
        </div>
        <div class="flex gap-2.5 items-start">
          <div class="w-6 h-6 rounded bg-primary text-on-primary flex items-center justify-center font-bold text-[9px] shrink-0">MOD</div>
          <div>
            <span class="font-bold text-xs text-primary">Admin_Dave</span>
            <span class="discord-user-badge bg-primary-fixed text-primary ml-1">Team</span>
            <p class="text-xs text-on-surface-variant mt-1">🔒 **Security Advisory:**<br/>
              Each subscriber is assigned a unique generated sub-ID (e.g. SA-XXXX-ELITE). Never share your login credentials or sub-ID with anyone.
            </p>
          </div>
        </div>
      </div>
    `;
  } else if (channel === 'support') {
    messagesLog.innerHTML = `
      <div class="space-y-4">
        <div class="flex gap-2.5 items-start">
          <div class="w-6 h-6 rounded bg-primary text-on-primary flex items-center justify-center font-bold text-[9px] shrink-0">BOT</div>
          <div>
            <span class="font-bold text-xs text-on-surface">SupportBot</span>
            <span class="discord-user-badge bg-surface-container-highest text-secondary ml-1">Helper</span>
            <p class="text-xs text-on-surface-variant mt-1">Hello! I am the automated Saudaa helper bot. Send me a question about plans, subscriptions, or logins, and I will find you an answer. Try typing:<br/>
              - <span class="font-semibold text-primary">"How do I subscribe?"</span><br/>
              - <span class="font-semibold text-primary">"What are the plans?"</span><br/>
              - <span class="font-semibold text-primary">"How do I access my dashboard?"</span>
            </p>
          </div>
        </div>
      </div>
    `;
  } else if (channel === 'general') {
    messagesLog.innerHTML = `
      <div class="space-y-4" id="general-feed">
        <div class="flex gap-2.5 items-start">
          <div class="w-6 h-6 rounded bg-secondary text-on-secondary flex items-center justify-center font-bold text-[9px] shrink-0">U</div>
          <div>
            <span class="font-bold text-xs text-on-surface">CryptoBull_99</span>
            <span class="discord-system-msg ml-1">1m ago</span>
            <p class="text-xs text-on-surface-variant mt-1">Alex Pro just crushed the target on ETH/USD Buy. +3% in 3 hours!</p>
          </div>
        </div>
        <div class="flex gap-2.5 items-start">
          <div class="w-6 h-6 rounded bg-secondary text-on-secondary flex items-center justify-center font-bold text-[9px] shrink-0">U</div>
          <div>
            <span class="font-bold text-xs text-on-surface">SatoshiTrader</span>
            <span class="discord-system-msg ml-1">2m ago</span>
            <p class="text-xs text-on-surface-variant mt-1">Has anyone subscribed to NeonGhost? Thinking of trying their commodities signals.</p>
          </div>
        </div>
      </div>
    `;
    startGeneralChatStream();
  }

  // Scroll to bottom
  messagesLog.scrollTop = messagesLog.scrollHeight;
}

window.sendDiscordMessage = function(event) {
  event.preventDefault();
  
  const inputField = document.getElementById('discord-input-field');
  const messagesLog = document.getElementById('discord-messages');
  const text = inputField.value.trim();

  if (!text) return;
  inputField.value = '';

  // Append user message
  const userHtml = `
    <div class="flex gap-2.5 items-start justify-end text-right">
      <div class="flex-1">
        <span class="font-bold text-xs text-primary">You (Guest)</span>
        <span class="discord-system-msg ml-1">Just now</span>
        <p class="text-xs text-on-surface bg-primary/5 rounded-lg p-2 mt-1 inline-block text-left">${text}</p>
      </div>
      <div class="w-6 h-6 rounded bg-primary-container text-on-primary-container flex items-center justify-center font-bold text-[9px] shrink-0">Y</div>
    </div>
  `;
  
  const wrapper = document.createElement('div');
  wrapper.innerHTML = userHtml;
  messagesLog.appendChild(wrapper);
  messagesLog.scrollTop = messagesLog.scrollHeight;

  // Bot Response Logic (for Support channel)
  if (discordActiveChannel === 'support') {
    setTimeout(() => {
      let botText = "I'm sorry, I didn't fully understand that request. For urgent issues, please submit an email to support@saudaa.com or login to access priority chat.";
      const cleanText = text.toLowerCase();

      if (cleanText.includes('subscribe') || cleanText.includes('join') || cleanText.includes('how to')) {
        botText = "To subscribe, select a trader from the **Leaderboard** or click **Compare Traders** on the homepage, and click the subscription/copy button to launch our secure checkout portal.";
      } else if (cleanText.includes('plan') || cleanText.includes('pricing') || cleanText.includes('cost')) {
        botText = "Saudaa offers three subscription tiers during checkout:<br/>- **Standard (₹59/mo):** Standard suggestions list + general community access.<br/>- **Pro Elite (₹99/mo):** Adds direct 1-on-1 private chat with the trader.<br/>- **VIP (₹249/mo):** Gives full access to all 10 trader terminals and option hedging insides.";
      } else if (cleanText.includes('access') || cleanText.includes('dashboard') || cleanText.includes('credentials') || cleanText.includes('login') || cleanText.includes('password')) {
        botText = "Once you complete checkout, the platform displays your unique Generated ID (SA-XXXX-ELITE) and password. Write them down! Navigate to **Portal Login** in the top header and enter these details to access your dashboard.";
      } else if (cleanText.includes('alex') || cleanText.includes('trader')) {
        botText = "Alex Pro is currently ranked #1 on our Leaderboard with an 82.9% win rate and a +68.5% 30-day ROI. You can copy their trade insides directly by choosing them during checkout.";
      }

      const botHtml = `
        <div class="flex gap-2.5 items-start mt-4">
          <div class="w-6 h-6 rounded bg-primary text-on-primary flex items-center justify-center font-bold text-[9px] shrink-0">BOT</div>
          <div>
            <span class="font-bold text-xs text-on-surface">SupportBot</span>
            <span class="discord-user-badge bg-surface-container-highest text-secondary ml-1">Helper</span>
            <p class="text-xs text-on-surface-variant mt-1">${botText}</p>
          </div>
        </div>
      `;
      const botWrapper = document.createElement('div');
      botWrapper.innerHTML = botHtml;
      messagesLog.appendChild(botWrapper);
      messagesLog.scrollTop = messagesLog.scrollHeight;
    }, 800);
  } else if (discordActiveChannel === 'general') {
    // General chat random reply simulation
    setTimeout(() => {
      const replies = [
        "Yeah, BTC looks extremely ready for that ₹66,500 target.",
        "Welcome to the lounge, buddy! Happy trading.",
        "NeonGhost has a commodity signal pending too. Check it out on their dashboard.",
        "Is anyone long on XAU? Momentum is shifting."
      ];
      const randomReply = replies[Math.floor(Math.random() * replies.length)];
      const botHtml = `
        <div class="flex gap-2.5 items-start mt-4">
          <div class="w-6 h-6 rounded bg-secondary text-on-secondary flex items-center justify-center font-bold text-[9px] shrink-0">U</div>
          <div>
            <span class="font-bold text-xs text-on-surface">AlphaTraders_X</span>
            <span class="discord-system-msg ml-1">Just now</span>
            <p class="text-xs text-on-surface-variant mt-1">${randomReply}</p>
          </div>
        </div>
      `;
      const botWrapper = document.createElement('div');
      botWrapper.innerHTML = botHtml;
      messagesLog.appendChild(botWrapper);
      messagesLog.scrollTop = messagesLog.scrollHeight;
    }, 1200);
  }
};

// General Chat dynamic streamer: simulates a busy community chat
function startGeneralChatStream() {
  if (generalChatInterval) return;

  const mockUsers = [
    { name: "ApexScalp", avatar: "A", bg: "bg-primary" },
    { name: "GoldMiner_2", avatar: "G", bg: "bg-secondary" },
    { name: "DeltaWanderer", avatar: "D", bg: "bg-tertiary" },
    { name: "OptionSling", avatar: "O", bg: "bg-primary-container" }
  ];

  const mockPhrases = [
    "Just subscribed to ApexPredator. Intraday signals are looking sharp today.",
    "MacroBull is calling index breakout on CPI tomorrow. Be careful.",
    "Anyone watching EUR/USD mean reversion? Standard deviation is quite high.",
    "ROI calculations on Leaderboards are verified, right? Because Alex Pro's metrics are nuts.",
    "Support bot said VIP tier unlocks all 10 dashboards. That's a great deal for copy trading.",
    "Gold target reached on commodities swing! Smooth trading so far."
  ];

  generalChatInterval = setInterval(() => {
    const feed = document.getElementById('general-feed');
    if (!feed) return;

    const user = mockUsers[Math.floor(Math.random() * mockUsers.length)];
    const text = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];

    const msgHtml = `
      <div class="flex gap-2.5 items-start animate-fade-in">
        <div class="w-6 h-6 rounded ${user.bg} text-on-surface flex items-center justify-center font-bold text-[9px] text-white shrink-0">${user.avatar}</div>
        <div>
          <span class="font-bold text-xs text-on-surface">${user.name}</span>
          <span class="discord-system-msg ml-1">Just now</span>
          <p class="text-xs text-on-surface-variant mt-1">${text}</p>
        </div>
      </div>
    `;

    const wrap = document.createElement('div');
    wrap.innerHTML = msgHtml;
    feed.appendChild(wrap);

    const container = document.getElementById('discord-messages');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, 6000); // Send new simulated message every 6 seconds
}

function stopGeneralChatStream() {
  if (generalChatInterval) {
    clearInterval(generalChatInterval);
    generalChatInterval = null;
  }
}

// 6. Setup general Event Listeners
function setupEventListeners() {
  // Leaderboard filters
  const search = document.getElementById('leaderboard-search');
  const strat = document.getElementById('leaderboard-strategy');
  const sort = document.getElementById('leaderboard-sort');

  if (search) search.addEventListener('input', renderLeaderboard);
  if (strat) strat.addEventListener('change', renderLeaderboard);
  if (sort) sort.addEventListener('change', renderLeaderboard);
}

// 7. Trader Comparison Wizard Logic
window.openCompareModal = function() {
  const modal = document.getElementById('compare-modal');
  if (!modal) return;

  // Reset comparison state
  compareSelectedTraders = [];
  compareCurrentStep = 1;

  // Reset metrics checkboxes (all checked by default)
  const checkboxes = document.querySelectorAll('.compare-metric-checkbox');
  checkboxes.forEach(cb => cb.checked = true);

  // Update selection count UI
  const countEl = document.getElementById('compare-selected-count');
  if (countEl) countEl.textContent = '0';

  const continueBtn = document.getElementById('compare-next-to-metrics');
  if (continueBtn) continueBtn.disabled = true;

  // Populate Step 1 Traders grid
  renderCompareTradersGrid();

  // Go to step 1 layout
  goToCompareStep(1);

  // Open modal animation
  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    const dialog = modal.querySelector('.scale-95') || modal.firstElementChild;
    if (dialog) dialog.classList.remove('scale-95');
  }, 50);
};

window.closeCompareModal = function() {
  const modal = document.getElementById('compare-modal');
  if (!modal) return;

  modal.classList.add('opacity-0');
  const dialog = modal.querySelector('.scale-95') || modal.firstElementChild;
  if (dialog) dialog.classList.add('scale-95');
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 300);
};

window.goToCompareStep = function(step) {
  // Validate constraints
  if (step === 2 && compareSelectedTraders.length < 2) {
    return; // Cannot proceed without at least 2 traders
  }

  compareCurrentStep = step;
  updateCompareStepperUI();

  // Switch visible panels
  const step1 = document.getElementById('compare-view-1');
  const step2 = document.getElementById('compare-view-2');
  const step3 = document.getElementById('compare-view-3');

  if (step1) step1.classList.add('hidden');
  if (step2) step2.classList.add('hidden');
  if (step3) step3.classList.add('hidden');

  const activeView = document.getElementById(`compare-view-${step}`);
  if (activeView) {
    activeView.classList.remove('hidden');
    activeView.classList.remove('animate-step-in');
    void activeView.offsetWidth; // Trigger reflow for animation
    activeView.classList.add('animate-step-in');
  }
};

function updateCompareStepperUI() {
  const progressLine = document.getElementById('compare-stepper-progress');
  if (progressLine) {
    if (compareCurrentStep === 1) progressLine.style.width = '0%';
    else if (compareCurrentStep === 2) progressLine.style.width = '50%';
    else if (compareCurrentStep === 3) progressLine.style.width = '100%';
  }

  // Update step badges
  for (let i = 1; i <= 3; i++) {
    const badge = document.getElementById(`step-badge-${i}`);
    if (badge) {
      const circle = badge.querySelector('div');
      const text = badge.querySelector('span');

      if (i < compareCurrentStep) {
        // Completed step
        circle.className = "w-8 h-8 rounded-full bg-primary-fixed text-primary flex items-center justify-center font-bold text-xs font-mono shadow-sm transition-all duration-200";
        circle.innerHTML = `<span class="material-symbols-outlined text-[16px]">check</span>`;
        text.className = "text-[10px] font-bold text-primary uppercase tracking-wider";
      } else if (i === compareCurrentStep) {
        // Active step
        circle.className = "w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-xs font-mono shadow-md scale-110 transition-all duration-200";
        circle.innerHTML = `${i}`;
        text.className = "text-[10px] font-bold text-primary uppercase tracking-wider";
      } else {
        // Inactive / future step
        circle.className = "w-8 h-8 rounded-full bg-surface-container-high text-outline flex items-center justify-center font-bold text-xs font-mono transition-all duration-200";
        circle.innerHTML = `${i}`;
        text.className = "text-[10px] font-bold text-outline uppercase tracking-wider";
      }
    }
  }
}

function renderCompareTradersGrid() {
  const grid = document.getElementById('compare-traders-grid');
  if (!grid) return;

  grid.innerHTML = tradersList.map(t => {
    const isSelected = compareSelectedTraders.includes(t.id);
    const selectClass = isSelected ? 'compare-card-selected' : 'border-outline-variant/40 bg-surface-container-lowest';
    
    return `
      <div onclick="toggleCompareTraderSelection('${t.id}')" class="group border rounded-xl p-4 cursor-pointer hover:border-primary-container hover:shadow-sm transition-all ${selectClass}">
        <div class="flex justify-between items-start">
          <div class="flex items-center gap-2.5">
            <img src="${t.avatar}" alt="${t.name}" class="w-8 h-8 rounded-full object-cover border border-outline-variant/30"/>
            <div>
              <span class="block text-xs font-bold text-on-surface group-hover:text-primary transition-colors">${t.name}</span>
              <span class="block text-[10px] text-outline">Rank #${t.rank} • ${t.strategy}</span>
            </div>
          </div>
          <div class="compare-checkbox-indicator w-5 h-5 rounded-full border border-outline-variant/60 flex items-center justify-center text-[10px] font-bold transition-all">
            ${isSelected ? `<span class="material-symbols-outlined text-[12px] font-bold">check</span>` : ''}
          </div>
        </div>
        <p class="text-[11px] text-on-surface-variant line-clamp-2 mt-3 leading-relaxed">${t.description}</p>
        <div class="flex gap-4 mt-3 pt-2.5 border-t border-outline-variant/20 font-mono text-[10px] text-outline justify-between">
          <div>ROI: <span class="font-bold text-primary">+${t.roi.toFixed(1)}%</span></div>
          <div>Win Rate: <span class="font-bold text-on-surface">${t.winRate.toFixed(1)}%</span></div>
        </div>
      </div>
    `;
  }).join('');
}

window.toggleCompareTraderSelection = function(traderId) {
  const idx = compareSelectedTraders.indexOf(traderId);
  if (idx > -1) {
    // Deselect
    compareSelectedTraders.splice(idx, 1);
  } else {
    // Select
    if (compareSelectedTraders.length >= 3) {
      alert('You can select a maximum of 3 traders to compare.');
      return;
    }
    compareSelectedTraders.push(traderId);
  }

  // Update count indicator
  const countEl = document.getElementById('compare-selected-count');
  if (countEl) countEl.textContent = compareSelectedTraders.length;

  // Toggle Next button active state (min 2, max 3)
  const continueBtn = document.getElementById('compare-next-to-metrics');
  if (continueBtn) {
    continueBtn.disabled = compareSelectedTraders.length < 2;
  }

  // Re-render selection list to update UI highlights
  renderCompareTradersGrid();
};

window.generateComparison = function() {
  const checkboxes = document.querySelectorAll('.compare-metric-checkbox');
  const selectedMetrics = [];
  checkboxes.forEach(cb => {
    if (cb.checked) {
      selectedMetrics.push(cb.value);
    }
  });

  if (selectedMetrics.length === 0) {
    alert('Please choose at least one metric to compare.');
    return;
  }

  // Navigate to Step 3 Results
  goToCompareStep(3);

  // Render the comparative report
  renderComparisonTable(selectedMetrics);
};

function renderComparisonTable(metrics) {
  const container = document.getElementById('compare-results-container');
  if (!container) return;

  // Resolve selected traders data
  const traders = compareSelectedTraders.map(id => tradersList.find(t => t.id === id));
  
  // Calculate maximum values for highlighting
  const maxRoi = Math.max(...traders.map(t => t.roi));
  const maxWinRate = Math.max(...traders.map(t => t.winRate));
  const maxSubs = Math.max(...traders.map(t => t.subscribers));

  // Build the side-by-side grid using a responsive table
  let html = `
    <table class="w-full text-left border-collapse min-w-[600px]">
      <thead>
        <tr class="bg-surface-container-low border-b border-outline-variant/30 text-on-surface-variant font-medium text-xs tracking-wider uppercase">
          <th class="py-4 px-6 compare-sticky-col">Performance Metric</th>
  `;

  // Render Trader Column Headers
  traders.forEach(t => {
    html += `
      <th class="py-4 px-6 border-l border-outline-variant/20">
        <div class="flex items-center gap-3">
          <img src="${t.avatar}" alt="${t.name}" class="w-10 h-10 rounded-full object-cover border border-outline-variant/30"/>
          <div>
            <span class="block font-bold text-on-surface text-sm leading-tight">${t.name}</span>
            <span class="block text-[10px] text-primary tracking-widest uppercase font-bold mt-0.5">Rank #${t.rank}</span>
          </div>
        </div>
      </th>
    `;
  });

  html += `
        </tr>
      </thead>
      <tbody class="divide-y divide-outline-variant/25 text-sm bg-surface-container-lowest">
  `;

  // Helper row builder
  metrics.forEach(metric => {
    if (metric === 'roi') {
      html += `
        <tr class="hover:bg-surface-container-low/20 transition-colors">
          <td class="py-4.5 px-6 font-bold text-xs text-on-surface compare-sticky-col">30d ROI (%)</td>
      `;
      traders.forEach(t => {
        const isBest = t.roi === maxRoi;
        const cellClass = isBest ? 'top-performer-cell font-bold text-primary' : 'text-primary';
        html += `
          <td class="py-4.5 px-6 border-l border-outline-variant/25 font-mono text-sm ${cellClass}">
            +${t.roi.toFixed(1)}%
            ${isBest ? `<span class="inline-flex items-center gap-0.5 ml-2 text-[9px] px-2 py-0.5 rounded-full top-performer-badge font-bold uppercase tracking-wider font-sans">🏆 Best</span>` : ''}
          </td>
        `;
      });
      html += `</tr>`;
    }

    if (metric === 'winRate') {
      html += `
        <tr class="hover:bg-surface-container-low/20 transition-colors">
          <td class="py-4.5 px-6 font-bold text-xs text-on-surface compare-sticky-col">Win Rate (%)</td>
      `;
      traders.forEach(t => {
        const isBest = t.winRate === maxWinRate;
        const cellClass = isBest ? 'top-performer-cell font-bold' : '';
        html += `
          <td class="py-4.5 px-6 border-l border-outline-variant/25 font-mono text-sm text-on-surface ${cellClass}">
            ${t.winRate.toFixed(1)}%
            ${isBest ? `<span class="inline-flex items-center gap-0.5 ml-2 text-[9px] px-2 py-0.5 rounded-full top-performer-badge font-bold uppercase tracking-wider font-sans">🏆 Best</span>` : ''}
          </td>
        `;
      });
      html += `</tr>`;
    }

    if (metric === 'subscribers') {
      html += `
        <tr class="hover:bg-surface-container-low/20 transition-colors">
          <td class="py-4.5 px-6 font-bold text-xs text-on-surface compare-sticky-col">Active Subscribers</td>
      `;
      traders.forEach(t => {
        const isBest = t.subscribers === maxSubs;
        const cellClass = isBest ? 'top-performer-cell font-bold' : '';
        html += `
          <td class="py-4.5 px-6 border-l border-outline-variant/25 font-mono text-sm text-on-surface-variant ${cellClass}">
            ${t.subscribers.toLocaleString()}
            ${isBest ? `<span class="inline-flex items-center gap-0.5 ml-2 text-[9px] px-2 py-0.5 rounded-full top-performer-badge font-bold uppercase tracking-wider font-sans">🏆 Most</span>` : ''}
          </td>
        `;
      });
      html += `</tr>`;
    }

    if (metric === 'strategy') {
      html += `
        <tr class="hover:bg-surface-container-low/20 transition-colors">
          <td class="py-4.5 px-6 font-bold text-xs text-on-surface compare-sticky-col">Trading Strategy</td>
      `;
      traders.forEach(t => {
        html += `
          <td class="py-4.5 px-6 border-l border-outline-variant/25 font-semibold text-xs text-secondary-container bg-secondary-container/5">
            ${t.strategy}
          </td>
        `;
      });
      html += `</tr>`;
    }

    if (metric === 'description') {
      html += `
        <tr class="hover:bg-surface-container-low/20 transition-colors">
          <td class="py-4.5 px-6 font-bold text-xs text-on-surface compare-sticky-col">Trader Biography</td>
      `;
      traders.forEach(t => {
        html += `
          <td class="py-4.5 px-6 border-l border-outline-variant/25 text-xs text-on-surface-variant leading-relaxed max-w-[220px]">
            ${t.description}
          </td>
        `;
      });
      html += `</tr>`;
    }
  });

  // Render checkout buttons at the bottom row
  html += `
    <tr class="bg-surface-container-low/30">
      <td class="py-6 px-6 compare-sticky-col bg-surface-container-low/55"></td>
  `;
  traders.forEach(t => {
    html += `
      <td class="py-6 px-6 border-l border-outline-variant/25 text-center">
        <button onclick="closeCompareModal(); openCheckout('${t.id}', 'pro')" class="w-full bg-primary hover:bg-primary-container text-on-primary font-bold text-xs px-5 py-2.5 rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5 hover:scale-[1.01]">
          Subscribe ${t.name.split(' ')[0]}
          <span class="material-symbols-outlined text-[14px]">arrow_forward</span>
        </button>
      </td>
    `;
  });

  html += `
        </tr>
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

// 8. Complimentary Trading Channels Controller
let activeTraderChannelId = '';

const complimentaryCalls = {
  "alex_pro": {
    intro: "Welcome to my channel! I'm Alex. I specialize in finding medium-term trends in major markets like the S&P 500. Here are my three free trade ideas to show you my strategy in action.",
    calls: [
      { sym: "Apple Inc. (AAPL)", type: "Buy", entry: "₹188.00 - ₹190.00", target: "₹205.00", safety: "₹184.00", why: "Apple shares are stabilizing at key support with steady consumer demand." },
      { sym: "Microsoft Corp. (MSFT)", type: "Buy", entry: "₹418.00 - ₹421.00", target: "₹438.00", safety: "₹412.00", why: "Microsoft shows strong artificial intelligence product pipeline growth." },
      { sym: "Amazon.com Inc. (AMZN)", type: "Buy", entry: "₹179.00 - ₹181.00", target: "₹195.00", safety: "₹175.00", why: "Amazon cloud computing segment revenues are accelerating." }
    ]
  },
  "Rushi Bhosale": {
    intro: "Namaste! I'm Rushi. I analyze options and liquid stocks for stable returns. Review these three free setups designed specifically for retail investors.",
    calls: [
      { sym: "Reliance Industries", type: "Buy", entry: "₹2,820 - ₹2,840", target: "₹3,020", safety: "₹2,750", why: "Reliance is breaking out of a 5-day consolidation range." },
      { sym: "Tata Consultancy Services (TCS)", type: "Buy", entry: "₹3,900 - ₹3,930", target: "₹4,150", safety: "₹3,820", why: "TCS indicates solid institutional accumulation patterns." },
      { sym: "Infosys Ltd. (INFY)", type: "Sell", entry: "₹1,440 - ₹1,450", target: "₹1,370", safety: "₹1,480", why: "Infosys exhibits weak short-term momentum and index resistance." }
    ]
  },
  "echo_zulu": {
    intro: "Welcome. EchoZulu here. I run quantitative models to locate pricing arbitrage and currency trends. Review these three algorithmic test signals.",
    calls: [
      { sym: "Euro / US Dollar (EUR/USD)", type: "Buy", entry: "1.0820 - 1.0835", target: "1.0950", safety: "1.0780", why: "Central bank interest rate decisions support euro currency strength." },
      { sym: "British Pound / US Dollar (GBP/USD)", type: "Buy", entry: "1.2680 - 1.2700", target: "1.2850", safety: "1.2610", why: "UK inflation data trends stronger than economist forecasts." },
      { sym: "US Dollar / Japanese Yen (USD/JPY)", type: "Sell", entry: "155.80 - 156.20", target: "153.50", safety: "157.10", why: "Technical overbought conditions align with potential government intervention." }
    ]
  },
  "neon_ghost": {
    intro: "Hey! I'm NeonGhost. I scan the markets for clean chart pattern breakouts and pullbacks. Here are my three free trade ideas based on strong support zones.",
    calls: [
      { sym: "Tesla Inc. (TSLA)", type: "Buy", entry: "₹171.00 - ₹174.00", target: "₹192.00", safety: "₹165.00", why: "Tesla shows a double-bottom pattern forming near historical support." },
      { sym: "NVIDIA Corp. (NVDA)", type: "Buy", entry: "₹935.00 - ₹945.00", target: "₹1,010.00", safety: "₹915.00", why: "Nvidia shows high buying volume after recent updates." },
      { sym: "Meta Platforms (META)", type: "Buy", entry: "₹470.00 - ₹475.00", target: "₹510.00", safety: "₹458.00", why: "Meta advertising revenue forecasts support positive stock price momentum." }
    ]
  },
  "apex_predator": {
    intro: "Let's capture some quick profits! I'm ApexPredator, a momentum scalper looking for high volume breakouts. Here are three quick-moving setups.",
    calls: [
      { sym: "Netflix Inc. (NFLX)", type: "Buy", entry: "₹610.00 - ₹615.00", target: "₹645.00", safety: "₹598.00", why: "Netflix subscription numbers are climbing ahead of seasonal shows." },
      { sym: "Google Alphabet (GOOGL)", type: "Buy", entry: "₹172.00 - ₹174.00", target: "₹188.00", safety: "₹168.00", why: "Google cloud software integrations are seeing widespread adoption." },
      { sym: "Advanced Micro Devices (AMD)", type: "Buy", entry: "₹160.00 - ₹163.00", target: "₹180.00", safety: "₹154.00", why: "AMD market share expansion in server chips remains robust." }
    ]
  },
  "luna_tick": {
    intro: "Hi, LunaTick here! I monitor decentralized markets for inefficiencies and price differences. Check out these three complimentary crypto setups.",
    calls: [
      { sym: "Bitcoin (BTC/USD)", type: "Buy", entry: "₹63,800 - ₹64,300", target: "₹67,500", safety: "₹62,500", why: "Bitcoin institutional inflows via ETFs show persistent daily growth." },
      { sym: "Ethereum (ETH/USD)", type: "Buy", entry: "₹3,050 - ₹3,100", target: "₹3,400", safety: "₹2,950", why: "Ethereum network activity and gas burn rates are rising steadily." },
      { sym: "Solana (SOL/USD)", type: "Buy", entry: "₹165.00 - ₹168.00", target: "₹188.00", safety: "₹156.00", why: "Solana daily active transaction volumes exceed key competitor benchmarks." }
    ]
  },
  "macro_bull": {
    intro: "Hello. MacroBull here. I analyze high-level economic indicators to trade major index futures. Here are my three free trade suggestions based on macro trends.",
    calls: [
      { sym: "S&P 500 ETF (SPY)", type: "Buy", entry: "₹524.00 - ₹526.00", target: "₹545.00", safety: "₹517.00", why: "Strong economic data indicates the corporate profit cycle is expanding." },
      { sym: "Nasdaq 100 ETF (QQQ)", type: "Buy", entry: "₹440.00 - ₹443.00", target: "₹465.00", safety: "₹432.00", why: "Large technology company cash balances cushion index valuations." },
      { sym: "Russell 2000 ETF (IWM)", type: "Buy", entry: "₹202.00 - ₹204.00", target: "₹216.00", safety: "₹197.00", why: "Small-cap indices are beginning to catch up to large-cap valuations." }
    ]
  },
  "alpha_wave": {
    intro: "Hey! AlphaWave here. I ride the biggest waves in tech growth. Here are three growth stock ideas that fit my trend-following system.",
    calls: [
      { sym: "Coinbase Global (COIN)", type: "Buy", entry: "₹215.00 - ₹220.00", target: "₹250.00", safety: "₹202.00", why: "Coinbase transaction revenues rise with digital asset volatility." },
      { sym: "Robinhood Markets (HOOD)", type: "Buy", entry: "₹19.00 - ₹19.50", target: "₹24.00", safety: "₹17.80", why: "Robinhood user account registrations reach high active milestones." },
      { sym: "Palantir Tech (PLTR)", type: "Buy", entry: "₹21.00 - ₹21.50", target: "₹25.00", safety: "₹19.80", why: "Palantir enterprise government software contracts are renewing." }
    ]
  },
  "delta_hedge": {
    intro: "Welcome. DeltaHedge here. I look for options premiums that are overvalued and trade delta-neutral. Here are three conservative setups.",
    calls: [
      { sym: "JPMorgan Chase (JPM)", type: "Buy", entry: "₹194.00 - ₹196.00", target: "₹210.00", safety: "₹189.00", why: "JPMorgan net interest income remains high despite changing rates." },
      { sym: "Walt Disney (DIS)", type: "Buy", entry: "₹101.00 - ₹103.00", target: "₹115.00", safety: "₹97.00", why: "Disney streaming sector profitability goals are within reach this year." },
      { sym: "Nike Inc. (NKE)", type: "Buy", entry: "₹91.00 - ₹93.00", target: "₹104.00", safety: "₹87.00", why: "Nike brand strength and distributor inventories are returning to balance." }
    ]
  },
  "zen_trader": {
    intro: "Be patient, wait for your pitch. I'm ZenTrader, analyzing commodity charts with wide margins of safety. Here are three complimentary commodity setups.",
    calls: [
      { sym: "Gold Trust (GLD)", type: "Buy", entry: "₹222.00 - ₹224.00", target: "₹242.00", safety: "₹216.00", why: "Global demand and inflation concerns make gold a strong store of value." },
      { sym: "Crude Oil Trust (USO)", type: "Buy", entry: "₹76.00 - ₹78.00", target: "₹86.00", safety: "₹73.00", why: "Oil supply controls and travel demands support short-term prices." },
      { sym: "Silver Trust (SLV)", type: "Buy", entry: "₹28.00 - ₹28.50", target: "₹32.50", safety: "₹26.80", why: "Industrial uses and solar panel manufacturing drive silver demand." }
    ]
  },
  "quantum_scalp": {
    intro: "QuantumScalp here. I capture short-term price adjustments in high-frequency trading models. Here are three rapid futures signals.",
    calls: [
      { sym: "Alibaba Group (BABA)", type: "Buy", entry: "₹81.00 - ₹82.50", target: "₹92.00", safety: "₹77.50", why: "Alibaba valuation is low compared to long-term digital retail gains." },
      { sym: "ExxonMobil (XOM)", type: "Buy", entry: "₹114.00 - ₹116.00", target: "₹126.00", safety: "₹110.00", why: "ExxonMobil production expansion drives strong operating cash flows." },
      { sym: "Walmart Inc. (WMT)", type: "Buy", entry: "₹63.50 - ₹64.50", target: "₹70.00", safety: "₹61.00", why: "Walmart digital store growth continues to offset inflation pressures." }
    ]
  }
};

function initChatBox() {
  const channelListEl = document.getElementById('trader-channels-list');
  const mobileSelectEl = document.getElementById('mobile-trader-channel-select');
  
  if (!channelListEl || tradersList.length === 0) return;

  // Build Channels Sidebar list showing Discord channels
  channelListEl.innerHTML = `
    <div onclick="switchTraderChannel('welcome-lounge')" id="channel-item-welcome-lounge" class="ch">
      <span class="material-symbols-outlined ch-ico">info</span>
      <div>
        <div class="ch-name">#welcome-lounge</div>
        <div class="ch-sub">Rules & Info</div>
      </div>
    </div>
    <div onclick="switchTraderChannel('free-signals')" id="channel-item-free-signals" class="ch">
      <span class="material-symbols-outlined ch-ico">campaign</span>
      <div>
        <div class="ch-name">#free-signals</div>
        <div class="ch-sub">All Free Calls</div>
      </div>
      <span class="ch-cnt">LIVE</span>
    </div>
  `;

  // Build Mobile select dropdown options
  if (mobileSelectEl) {
    mobileSelectEl.innerHTML = `
      <option value="welcome-lounge">#welcome-lounge</option>
      <option value="free-signals">#free-signals</option>
    `;
  }

  // Set default active channel (welcome-lounge)
  activeTraderChannelId = 'welcome-lounge';
  switchTraderChannel(activeTraderChannelId);

  // Render movers on the right panel
  renderRankMovers();
}

function switchTraderChannel(channelId) {
  activeTraderChannelId = channelId;

  // Update Sidebar Active state
  const channels = ['welcome-lounge', 'free-signals'];
  channels.forEach(ch => {
    const el = document.getElementById(`channel-item-${ch}`);
    if (el) {
      if (ch === channelId) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  });

  // Update Mobile Dropdown value
  const mobileSelectEl = document.getElementById('mobile-trader-channel-select');
  if (mobileSelectEl) {
    mobileSelectEl.value = channelId;
  }

  // Update Active Header details
  const titleEl = document.getElementById('active-channel-title');
  const roiEl = document.getElementById('active-channel-roi');
  const mockInputEl = document.getElementById('chat-mock-input');
  
  if (channelId === 'welcome-lounge') {
    if (titleEl) titleEl.textContent = 'Welcome & Rules';
    if (roiEl) roiEl.textContent = 'Free Group';
    if (mockInputEl) mockInputEl.placeholder = 'Welcome to Saudaa Lounge!';
  } else if (channelId === 'free-signals') {
    if (titleEl) titleEl.textContent = 'Complimentary Signals Feed';
    if (roiEl) roiEl.textContent = '11 Traders posting';
    if (mockInputEl) mockInputEl.placeholder = 'Unlock premium for direct trader messaging...';
  }

  // Render chat feed
  renderChatFeed(channelId);
}

function renderChatFeed(channelId) {
  const feedBodyEl = document.getElementById('chat-feed-body');
  if (!feedBodyEl) return;

  if (channelId === 'welcome-lounge') {
    feedBodyEl.innerHTML = `
      <div class="msg">
        <div class="msg-av">SD</div>
        <div class="msg-c">
          <div class="msg-meta">
            <span class="msg-name">Saudaa Operator</span>
            <span class="msg-badge mb-pro">System</span>
            <span class="msg-time">Today at 9:00 AM</span>
          </div>
          <div class="msg-txt">
            <h4 class="text-base font-bold text-on-surface mb-2">Welcome to the Saudaa Intelligence Lounge!</h4>
            <p class="text-xs text-on-surface-variant leading-relaxed">
              This is the official free-tier communication hub. In this lounge, you have access to:
            </p>
            <ul class="list-disc pl-5 mt-2 space-y-1.5 text-xs text-on-surface-variant">
              <li><strong>#welcome-lounge:</strong> Platform rules and group overview.</li>
              <li><strong>#free-signals:</strong> A unified group chat where all 11 elite traders post their complimentary setups in real-time.</li>
            </ul>
            <div class="mt-4 p-4 rounded-xl border border-outline-variant/30 bg-surface-container-low flex items-start gap-3">
              <span class="material-symbols-outlined text-primary text-[20px]">info</span>
              <div>
                <div class="font-bold text-xs text-on-surface">How to copy signals?</div>
                <div class="text-[10px] text-outline mt-0.5">Explore the setups in the <span class="text-primary font-bold">#free-signals</span> channel, select an expert, and click their lock card to subscribe to their direct real-time terminal.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    feedBodyEl.scrollTop = feedBodyEl.scrollHeight;
    return;
  }

  // Clear feed and show typing indicator
  feedBodyEl.innerHTML = `
    <div class="msg" id="chat-typing-indicator">
      <div class="msg-av">SD</div>
      <div class="msg-c">
        <div class="msg-meta">
          <span class="msg-name">Saudaa Operator</span>
          <span class="msg-time">loading history...</span>
        </div>
        <div class="typing-bubble">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    </div>
  `;
  feedBodyEl.scrollTop = feedBodyEl.scrollHeight;

  // After 600ms load the actual messages for all traders in a unified stream
  setTimeout(() => {
    let feedHtml = '';

    tradersList.forEach((t, idx) => {
      const nameInitials = t.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
      const data = complimentaryCalls[t.id] || complimentaryCalls["alex_pro"];

      // Generate staggered time
      const hour = 9 + Math.floor(idx / 2);
      const minute = (idx % 2 === 0) ? '00' : '30';
      const timeStr = `Today at ${hour}:${minute} AM`;

      // Generate complimentary calls cards markup
      let callsHtml = '';
      data.calls.forEach((c, callIdx) => {
        const isBuy = c.type.toLowerCase() === 'buy';
        const typeClass = isBuy ? 'buy' : 'sell';
        const colorClass = isBuy ? 'g' : 'r';
        const boxClass = isBuy ? 'call-box gb' : 'call-box';
        
        callsHtml += `
          <div class="${boxClass}">
            <div class="cb-top">
              <span class="cb-sym ${colorClass}">#${callIdx + 1} - ${c.sym}</span>
              <span class="cb-type ${typeClass}">${c.type}</span>
            </div>
            <div class="cb-grid font-sans">
              <div>
                <div class="cb-item-l">Buy Price</div>
                <div class="cb-item-v">${c.entry}</div>
              </div>
              <div class="border-l border-outline-variant/30 pl-3">
                <div class="cb-item-l">Profit Target</div>
                <div class="cb-item-v g">${c.target}</div>
              </div>
              <div class="border-l border-outline-variant/30 pl-3">
                <div class="cb-item-l">Safety Exit</div>
                <div class="cb-item-v r">${c.safety}</div>
              </div>
            </div>
            <div class="text-[10px] text-outline-variant/60 font-mono mt-3 leading-normal">
              <span class="font-bold text-outline-variant">Why this trade:</span> ${c.why}
            </div>
          </div>
        `;
      });

      feedHtml += `
        <div class="msg border-b border-outline-variant/10 pb-6 mb-6">
          <div class="msg-av shrink-0">${nameInitials}</div>
          <div class="msg-c flex-1 min-w-0">
            <div class="msg-meta">
              <span class="msg-name font-bold text-on-surface">${t.name}</span>
              <span class="msg-badge mb-pro">Trader</span>
              <span class="msg-time text-outline text-[10px] ml-2">${timeStr}</span>
            </div>
            <div class="msg-txt mt-2 text-on-surface-variant text-xs leading-relaxed">
              <p class="font-semibold text-on-surface">${data.intro}</p>
              
              <div class="space-y-3.5 mt-3">
                ${callsHtml}
              </div>
              
              <div onclick="openCheckout('${t.id}', 'pro')" class="locked cursor-pointer mt-4 p-4 rounded-xl border border-outline-variant/30 bg-surface-container-low hover:bg-surface-container-high transition-colors flex items-start gap-3">
                <span class="material-symbols-outlined locked-i text-primary">lock</span>
                <div>
                  <div class="locked-title font-bold text-xs text-on-surface">Unlock daily premium signals from ${t.name}</div>
                  <div class="locked-desc text-[10px] text-outline mt-0.5">Join premium subscribers copying these trades in real-time. Click to unlock.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    });

    feedBodyEl.innerHTML = feedHtml;
    feedBodyEl.scrollTop = 0; // Scroll to top so users read oldest to newest, or we can keep it as is
  }, 600);
}

function handleSubscribeFromChat() {
  openCheckout('', 'pro');
}

function renderRankMovers() {
  const moversEl = document.getElementById('rank-movers-list');
  if (!moversEl) return;

  // Take top 5 traders sorted by ROI
  const sortedTraders = [...tradersList].sort((a, b) => b.roi - a.roi).slice(0, 5);

  moversEl.innerHTML = sortedTraders.map((t, idx) => {
    return `
      <div class="mover flex items-center justify-between py-3 px-4 border-b border-outline-variant/20">
        <div class="flex items-center gap-3">
          <div class="mv-rank font-serif text-base text-on-surface-variant/40 w-6 text-left">0${idx + 1}</div>
          <div>
            <span class="block font-sans font-medium text-xs text-on-surface">${t.name}</span>
            <span class="block text-[10px] text-on-surface-variant/60 mt-0.5">${t.strategy}</span>
          </div>
        </div>
        <div class="text-right">
          <span class="block text-[8px] font-sans text-on-surface-variant/50 tracking-wider uppercase">30d ROI</span>
          <span class="block font-mono text-xs text-primary mt-0.5">+${t.roi.toFixed(1)}%</span>
        </div>
      </div>
    `;
  }).join('');
}

// Bind to window for HTML events
window.switchTraderChannel = switchTraderChannel;
window.handleSubscribeFromChat = handleSubscribeFromChat;
window.initChatBox = initChatBox;

// Stats Count Up Animation
function initStatsAnimation() {
  const statsContainer = document.getElementById('hero-stats-strip');
  if (!statsContainer) return;

  let animated = false;

  const animateValue = (id, start, end, duration, suffix = '', formatComma = false) => {
    const obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const val = Math.floor(progress * (end - start) + start);
      obj.innerHTML = formatComma ? val.toLocaleString() + suffix : val + suffix;
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  };

  const runAllAnimations = () => {
    if (animated) return;
    animated = true;
    animateValue('stat-val-traders', 0, 12840, 1500, '', true);
    animateValue('stat-val-leaders', 0, 214, 1500, '');
    animateValue('stat-val-winrate', 0, 72, 1500, '%');
    animateValue('stat-val-calls', 0, 4280, 1500, '', true);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        runAllAnimations();
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  observer.observe(statsContainer);

  // Fallback trigger after 2500ms to ensure stats animate even if DOM loaded under preloader overlap
  setTimeout(runAllAnimations, 2500);
}

// 8. Smooth scroll helper to navigate to bottom of heatmap
window.scrollToHeatmapBottom = function() {
  const heatmapEl = document.getElementById('heatmap');
  if (heatmapEl) {
    const bottomOffset = heatmapEl.offsetTop + heatmapEl.offsetHeight;
    window.scrollTo({
      top: bottomOffset - window.innerHeight + 80, // Offset for navbar buffer
      behavior: 'smooth'
    });
  }
};

// 9. Hero Candlestick Background Animation
function initHeroCandlesAnimation() {
  const canvas = document.getElementById('hero-candles-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let animationFrameId = null;

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  // Initial sizing
  resizeCanvas();
  
  // Set up resize listener
  window.addEventListener('resize', resizeCanvas);

  const candles = [];
  const maxCandles = 25; // Clean density

  function createCandle(isInitial = false) {
    const width = Math.random() * 4 + 6; // 6px to 10px body width
    const bodyHeight = Math.random() * 30 + 15; // 15px to 45px body height
    const wickHeightTop = Math.random() * 15 + 5; // 5px to 20px top wick
    const wickHeightBottom = Math.random() * 15 + 5; // 5px to 20px bottom wick
    const isGreen = Math.random() > 0.45; // slightly bias towards green to match sage green theme

    const x = Math.random() * canvas.width;
    // Scatter vertically on start, else spawn above viewport
    const y = isInitial ? (Math.random() * (canvas.height + 100) - 50) : -100;
    const speed = Math.random() * 0.8 + 0.4; // 0.4px to 1.2px per frame
    const opacityFactor = Math.random() * 0.2 + 0.4; // opacity bounds (0.4 to 0.6)

    return {
      x,
      y,
      speed,
      width,
      bodyHeight,
      wickHeightTop,
      wickHeightBottom,
      isGreen,
      opacityFactor
    };
  }

  // Populate initial candlesticks
  for (let i = 0; i < maxCandles; i++) {
    candles.push(createCandle(true));
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      c.y += c.speed;

      // Vertical fading zones (120px from top and bottom)
      let currentOpacity = c.opacityFactor;
      const fadeHeight = 120;

      if (c.y < fadeHeight) {
        // Fade in as they enter from top
        currentOpacity *= (c.y + 100) / (fadeHeight + 100);
      } else if (c.y > canvas.height - fadeHeight) {
        // Fade out as they exit at bottom
        currentOpacity *= (canvas.height - c.y) / fadeHeight;
      }

      if (currentOpacity < 0) currentOpacity = 0;

      // Reset candle if it has fallen off the screen
      const totalHeight = c.wickHeightTop + c.bodyHeight + c.wickHeightBottom;
      if (c.y > canvas.height + 50) {
        candles[i] = createCandle(false);
        continue;
      }

      // Draw Candlestick
      // sage green: primary theme (#42682b)
      // crimson red: error theme (#ba1a1a)
      const color = c.isGreen
        ? `rgba(66, 104, 43, ${currentOpacity})`
        : `rgba(186, 26, 26, ${currentOpacity})`;

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2.0;

      // Draw vertical wick line
      const wickTopX = c.x;
      const wickTopY = c.y;
      const wickBottomY = c.y + c.wickHeightTop + c.bodyHeight + c.wickHeightBottom;

      ctx.beginPath();
      ctx.moveTo(wickTopX, wickTopY);
      ctx.lineTo(wickTopX, wickBottomY);
      ctx.stroke();

      // Draw candle solid body block
      const bodyX = c.x - c.width / 2;
      const bodyY = c.y + c.wickHeightTop;

      ctx.beginPath();
      ctx.rect(bodyX, bodyY, c.width, c.bodyHeight);
      ctx.fill();
    }

    animationFrameId = requestAnimationFrame(animate);
  }

  animate();
}

// 10. Mobile Menu Collapsible Setup
function setupMobileMenu() {
  const btn = document.getElementById('mobile-menu-btn');
  const panel = document.getElementById('mobile-menu-panel');

  if (!btn || !panel) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMobileMenu();
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (panel.classList.contains('mobile-menu-active') && !panel.contains(e.target) && e.target !== btn) {
      closeMobileMenu();
    }
  });
}

window.toggleMobileMenu = function() {
  const panel = document.getElementById('mobile-menu-panel');
  const btn = document.getElementById('mobile-menu-btn');
  if (!panel || !btn) return;

  const isActive = panel.classList.contains('mobile-menu-active');
  const icon = btn.querySelector('span');

  if (isActive) {
    closeMobileMenu();
  } else {
    panel.classList.remove('hidden');
    // Force reflow
    void panel.offsetWidth;
    panel.classList.add('mobile-menu-active');
    if (icon) icon.textContent = 'close';
  }
};

window.closeMobileMenu = function() {
  const panel = document.getElementById('mobile-menu-panel');
  const btn = document.getElementById('mobile-menu-btn');
  if (!panel || !btn) return;

  const icon = btn.querySelector('span');
  panel.classList.remove('mobile-menu-active');
  if (icon) icon.textContent = 'menu';
  
  setTimeout(() => {
    if (!panel.classList.contains('mobile-menu-active')) {
      panel.classList.add('hidden');
    }
  }, 300);
};

// Sticky Mobile CTA Scroll Listener
function initStickyMobileCta() {
  const cta = document.getElementById('mobile-sticky-cta');
  if (!cta) return;

  window.addEventListener('scroll', () => {
    // Show after scrolling down 300px
    if (window.scrollY > 300) {
      cta.classList.remove('translate-y-full');
    } else {
      cta.classList.add('translate-y-full');
    }
  });
}

// FAQ Toggle Handler
window.toggleFaq = function(index) {
  const ans = document.getElementById(`faq-ans-${index}`);
  const icon = document.getElementById(`faq-icon-${index}`);
  if (!ans || !icon) return;

  const isHidden = ans.classList.contains('hidden');

  // Close all other FAQs first for a clean accordion effect
  for (let i = 1; i <= 4; i++) {
    const otherAns = document.getElementById(`faq-ans-${i}`);
    const otherIcon = document.getElementById(`faq-icon-${i}`);
    if (otherAns && otherIcon && i !== index) {
      otherAns.classList.add('hidden');
      otherIcon.classList.remove('rotate-180');
    }
  }

  if (isHidden) {
    ans.classList.remove('hidden');
    icon.classList.add('rotate-180');
  } else {
    ans.classList.add('hidden');
    icon.classList.remove('rotate-180');
  }
};



