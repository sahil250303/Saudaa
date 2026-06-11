// Saudaa Dashboard Controller

// Global fetch interceptor to automatically attach JWT token from session
const originalFetch = window.fetch;
window.fetch = async function(url, options = {}) {
  const sessionData = localStorage.getItem('saudaa_session');
  if (sessionData) {
    try {
      const session = JSON.parse(sessionData);
      if (session.token) {
        options.headers = options.headers || {};
        if (!options.headers['Authorization']) {
          options.headers['Authorization'] = `Bearer ${session.token}`;
        }
      }
    } catch (e) {
      // Ignore parsing errors
    }
  }
  return originalFetch(url, options);
};

let currentUser = null;
let currentRole = null;
let activeChatClientId = null;
let chatPollInterval = null;
let signalsPollInterval = null;
let editingSignalId = null;
let countdownInterval = null;

// Image upload states
let suggestionImageBase64 = null;
let suggestionImageConfirmed = false;
let suggestionImageName = '';
let freeSignalImageBase64 = null;
let freeSignalImageConfirmed = false;
let freeSignalImageName = '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  initImageUploads();
});

function checkAuth() {
  const sessionData = localStorage.getItem('saudaa_session');
  if (sessionData) {
    const session = JSON.parse(sessionData);
    currentUser = session.user;
    currentRole = session.role;
    
    // Show Dashboard, Hide Login
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('dashboard-container').classList.remove('hidden');
    
    loadDashboardHeader();
    if (currentRole === 'trader') {
      initTraderDashboard();
    } else {
      initClientDashboard();
    }
  } else {
    // Show Login, Hide Dashboard
    document.getElementById('login-container').classList.remove('hidden');
    document.getElementById('dashboard-container').classList.add('hidden');
    stopPolling();
  }
}

// 1. Auth Handlers
window.handleLogin = async function(event) {
  event.preventDefault();
  const emailInput = document.getElementById('login-username').value.trim();
  const passwordInput = document.getElementById('login-password').value.trim();
  const errorEl = document.getElementById('login-error');

  errorEl.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: emailInput, password: passwordInput })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login authorization failed.');

    // Save session
    localStorage.setItem('saudaa_session', JSON.stringify(data));
    checkAuth();
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove('hidden');
  }
}

window.handleLogout = function() {
  localStorage.removeItem('saudaa_session');
  checkAuth();
};

function loadDashboardHeader() {
  const avatar = document.getElementById('nav-avatar');
  const name = document.getElementById('nav-username');
  const sub = document.getElementById('nav-user-sub');
  const badge = document.getElementById('nav-tier-badge');

  const mobileAvatar = document.getElementById('mobile-nav-avatar');
  const mobileBadge = document.getElementById('mobile-tier-badge');

  if (currentRole === 'trader') {
    if (avatar) avatar.src = currentUser.avatar;
    if (name) name.textContent = currentUser.name;
    if (sub) sub.textContent = `Terminal Rank: #${currentUser.rank}`;
    if (badge) badge.textContent = `Expert Tier`;
    if (mobileAvatar) mobileAvatar.src = currentUser.avatar;
    if (mobileBadge) mobileBadge.textContent = `Expert Tier`;
    
    document.getElementById('dash-welcome-title').textContent = `${currentUser.name} Workspace`;
    document.getElementById('dash-welcome-subtitle').textContent = `Manage subscribers and broadcast technical signals.`;
  } else {
    const defaultClientAvatar = 'https://cdn-icons-png.flaticon.com/512/149/149071.png';
    if (avatar) avatar.src = defaultClientAvatar;
    if (name) name.textContent = currentUser.email.split('@')[0];
    if (sub) sub.textContent = currentUser.subId;
    
    const tierText = `${currentUser.subscription ? currentUser.subscription.plan.toUpperCase() : 'FREE'} SUBSCRIBER`;
    if (badge) badge.textContent = tierText;
    if (mobileAvatar) mobileAvatar.src = defaultClientAvatar;
    if (mobileBadge) mobileBadge.textContent = tierText;
    
    document.getElementById('dash-welcome-title').textContent = `Subscriber Terminal`;
    document.getElementById('dash-welcome-subtitle').textContent = `Welcome back! Monitoring live inside suggestions.`;
  }
}

// 2. Trader Dashboard Logic
async function initTraderDashboard() {
  document.getElementById('view-trader').classList.remove('hidden');
  document.getElementById('view-client').classList.add('hidden');

  // Load Trader Stats
  document.getElementById('trader-stat-win').textContent = `${currentUser.winRate}%`;
  document.getElementById('trader-stat-subs').textContent = currentUser.subscribers.toLocaleString();
  document.getElementById('trader-stat-rank').textContent = `#${currentUser.rank}`;

  // Fetch own suggestions
  fetchTraderSignals();

  // Fetch subscribed clients list
  fetchTraderClients();

  // Load free signals configuration
  loadFreeSignals();

  // Start countdown timer updates
  if (countdownInterval) clearInterval(countdownInterval);
  updateCountdownTimers();
  countdownInterval = setInterval(updateCountdownTimers, 1000);
}

async function fetchTraderSignals() {
  try {
    const res = await fetch(`/api/suggestions?role=trader&userId=${currentUser.id}`);
    const signals = await res.json();
    const feed = document.getElementById('trader-signals-feed');

    if (!feed) return;

    if (signals.length === 0) {
      feed.innerHTML = `<p class="text-xs text-outline text-center mt-20">You have no active signal insides posted. Click "New Inside" to broadcast one.</p>`;
      return;
    }

    feed.innerHTML = signals.map(s => {
      const isBuy = s.type.toLowerCase() === 'buy';
      const elapsedMs = Date.now() - new Date(s.createdAt).getTime();
      const isWithinWindow = elapsedMs < 120000;
      return `
        <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col md:flex-row justify-between md:items-center gap-4 hover:border-primary-container transition-all relative">
          ${s.edited ? `
            <span class="absolute top-2 right-2 text-[9px] text-primary font-bold bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded flex items-center gap-0.5 select-none">
              <span class="material-symbols-outlined text-[10px]">edit_note</span> Edited
            </span>
          ` : ''}
          <div class="space-y-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-sm text-on-surface">${s.asset}</span>
              <span class="${isBuy ? 'bg-primary/10 text-primary' : 'bg-error/10 text-error'} text-[10px] font-bold px-2 py-0.5 rounded uppercase">${s.type}</span>
              <span class="bg-surface-container-highest text-secondary text-[9px] font-bold px-1.5 py-0.5 rounded">Risk: ${s.risk}</span>
              ${s.assetType ? `<span class="bg-tertiary-container/30 text-tertiary text-[9px] font-bold px-1.5 py-0.5 rounded">${s.assetType}</span>` : ''}
              ${s.strategy ? `<span class="bg-secondary-container/30 text-on-secondary-container text-[9px] font-bold px-1.5 py-0.5 rounded">${s.strategy}</span>` : ''}
            </div>
            <div class="grid grid-cols-3 gap-3 text-center bg-surface-container-lowest p-2 rounded-lg border border-outline-variant/20">
              <div>
                <span class="text-[9px] text-outline block">ENTRY</span>
                <span class="font-mono text-xs font-bold text-on-surface">${s.entry}</span>
              </div>
              <div>
                <span class="text-[9px] text-outline block">TARGET</span>
                <span class="font-mono text-xs font-bold text-primary">${s.target}</span>
              </div>
              <div>
                <span class="text-[9px] text-outline block">STOP LOSS</span>
                <span class="font-mono text-xs font-bold text-error">${s.stopLoss}</span>
              </div>
            </div>
            ${s.notes ? `<p class="text-xs text-on-surface-variant italic mt-1">"${s.notes}"</p>` : ''}
            ${s.image ? `
              <div class="mt-2.5">
                <button type="button" onclick="openLightbox('${s.image}', 'Chart Analysis for ${s.asset}')" class="group relative flex items-center gap-1.5 bg-surface-container-highest/60 hover:bg-primary/10 border border-outline-variant/30 hover:border-primary/30 p-1.5 rounded-lg transition-all text-[10px] font-bold text-on-surface-variant hover:text-primary">
                  <img src="${s.image}" class="w-10 h-10 object-cover rounded border border-outline-variant/40" />
                  <span class="flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">zoom_in</span> View Technical Chart
                  </span>
                </button>
              </div>
            ` : ''}
          </div>
          <div class="flex flex-row md:flex-col items-center md:items-end justify-end shrink-0 gap-2">
            <div class="flex flex-col items-end">
              <span class="text-[9px] text-outline">${new Date(s.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              ${isWithinWindow ? `
                <div class="mt-1 flex items-center gap-1 text-[9px] text-primary bg-primary/5 border border-primary/20 px-1.5 py-0.5 rounded font-mono font-bold countdown-timer" data-created-at="${s.createdAt}" data-signal-id="${s.id}">
                  <span class="material-symbols-outlined text-[10px] animate-pulse">schedule</span>
                  <span class="timer-text">--:--</span>
                </div>
              ` : ''}
            </div>
            ${isWithinWindow ? `
              <div class="flex gap-1.5">
                <button onclick="handleEditSignal('${s.id}')" class="text-primary hover:bg-primary/10 px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1 text-xs font-bold">
                  <span class="material-symbols-outlined text-[14px]">edit</span> Edit
                </button>
                <button onclick="handleDeleteSignal('${s.id}')" class="text-error hover:bg-error-container px-2 py-1.5 rounded-lg transition-colors flex items-center gap-1 text-xs font-bold">
                  <span class="material-symbols-outlined text-[14px]">delete</span> Delete
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error fetching signals:', error);
  }
}

window.updateCountdownTimers = function() {
  const timers = document.querySelectorAll('.countdown-timer');
  if (timers.length === 0) return;

  let expiredAny = false;

  timers.forEach(timer => {
    const createdAtStr = timer.getAttribute('data-created-at');
    const createdAt = new Date(createdAtStr).getTime();
    const elapsedMs = Date.now() - createdAt;
    const remainingMs = 120000 - elapsedMs;

    if (remainingMs <= 0) {
      expiredAny = true;
    } else {
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      const textEl = timer.querySelector('.timer-text');
      if (textEl) {
        textEl.textContent = formattedTime;
      }
    }
  });

  if (expiredAny) {
    fetchTraderSignals();
  }
};

window.handleEditSignal = async function(signalId) {
  try {
    const res = await fetch(`/api/suggestions?role=trader&userId=${currentUser.id}`);
    const signals = await res.json();
    const signal = signals.find(s => s.id === signalId);
    
    if (!signal) {
      alert('Signal not found.');
      return;
    }
    
    const elapsedMs = Date.now() - new Date(signal.createdAt).getTime();
    if (elapsedMs > 120000) {
      alert('Editing window has expired (2 minutes limit).');
      fetchTraderSignals();
      return;
    }

    editingSignalId = signalId;

    const modal = document.getElementById('new-trade-modal');
    document.getElementById('trade-error').classList.add('hidden');
    
    document.getElementById('trade-asset').value = signal.asset;
    document.getElementById('trade-type').value = signal.type;
    document.getElementById('trade-entry').value = signal.entry;
    document.getElementById('trade-target').value = signal.target;
    document.getElementById('trade-stop-loss').value = signal.stopLoss;
    document.getElementById('trade-risk').value = signal.risk;
    document.getElementById('trade-asset-type').value = signal.assetType || 'Stocks';
    document.getElementById('trade-strategy').value = signal.strategy || 'Day Trade';
    document.getElementById('trade-notes').value = signal.notes;

    // Load existing image if attached
    if (signal.image) {
      suggestionImageBase64 = signal.image;
      suggestionImageConfirmed = true;
      suggestionImageName = 'Current Attached Image.png';
      updateUploadUIState('suggestion', 'confirmed', suggestionImageName);
    } else {
      clearAttachment('suggestion');
    }

    const modalTitle = modal.querySelector('h3');
    const modalSubtitle = modal.querySelector('p');
    const submitBtn = modal.querySelector('button[type="submit"]');

    if (modalTitle) modalTitle.textContent = 'Edit Trading Suggestion';
    if (modalSubtitle) modalSubtitle.textContent = 'You can edit this signal within the 2-minute window';
    if (submitBtn) {
      submitBtn.innerHTML = `
        <span class="material-symbols-outlined text-[16px]">save</span>
        Save Changes
      `;
    }

    modal.classList.remove('hidden');
    setTimeout(() => {
      modal.classList.remove('opacity-0');
      const dialog = modal.querySelector('.scale-95') || modal.firstElementChild;
      if (dialog) dialog.classList.remove('scale-95');
    }, 50);

  } catch (error) {
    console.error('Error opening edit modal:', error);
  }
};

window.handleDeleteSignal = async function(signalId) {
  try {
    const res = await fetch(`/api/suggestions?role=trader&userId=${currentUser.id}`);
    const signals = await res.json();
    const signal = signals.find(s => s.id === signalId);
    if (signal) {
      const elapsedMs = Date.now() - new Date(signal.createdAt).getTime();
      if (elapsedMs > 120000) {
        alert('Deletion window has expired (2 minutes limit).');
        fetchTraderSignals();
        return;
      }
    }
  } catch (err) {
    console.error('Error checking signal expiration:', err);
  }

  if (!confirm('Are you sure you want to delete this signal inside suggestion?')) return;
  try {
    const res = await fetch(`/api/suggestions/${signalId}?traderId=${currentUser.id}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      fetchTraderSignals();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to delete signal.');
    }
  } catch (error) {
    console.error('Error deleting signal:', error);
  }
}

async function fetchTraderClients() {
  try {
    const res = await fetch(`/api/traders/${currentUser.id}/clients`);
    const clients = await res.json();
    const list = document.getElementById('trader-clients-list');

    if (!list) return;

    if (clients.length === 0) {
      list.innerHTML = `<p class="text-[10px] text-outline text-center py-6">No active subscribers</p>`;
      return;
    }

    list.innerHTML = clients.map(c => {
      const nameStr = c.email.split('@')[0];
      const activeClass = activeChatClientId === c.id ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant hover:bg-surface-container-high';
      return `
        <button onclick="selectChatClient('${c.id}')" class="w-full text-left px-2 py-2 rounded text-[11px] truncate flex flex-col gap-0.5 ${activeClass} transition-colors">
          <span class="truncate block">${nameStr}</span>
          <span class="text-[8px] text-outline block uppercase">${c.plan} tier</span>
        </button>
      `;
    }).join('');
  } catch (error) {
    console.error('Error fetching subscribers:', error);
  }
}

window.selectChatClient = function(clientId) {
  activeChatClientId = clientId;
  fetchTraderClients(); // Refresh highlight in sidebar
  
  // Show input field
  document.getElementById('trader-chat-input-box').classList.remove('hidden');
  
  // Load and start polling chat
  loadTraderChatLogs();
  
  if (chatPollInterval) clearInterval(chatPollInterval);
  chatPollInterval = setInterval(loadTraderChatLogs, 3000);
};

async function loadTraderChatLogs() {
  if (!activeChatClientId) return;

  try {
    const res = await fetch(`/api/chat/messages?clientId=${activeChatClientId}&traderId=${currentUser.id}`);
    const messages = await res.json();
    const feed = document.getElementById('trader-chat-messages');

    if (!feed) return;

    if (messages.length === 0) {
      feed.innerHTML = `<p class="text-xs text-outline text-center mt-20">No chat history. Send a greeting to initiate secure communication.</p>`;
      return;
    }

    feed.innerHTML = messages.map(m => {
      const isSelf = m.senderId === currentUser.id;
      return `
        <div class="flex flex-col ${isSelf ? 'items-end' : 'items-start'}">
          <div class="max-w-[85%] rounded-2xl px-4 py-2.5 text-xs ${isSelf ? 'bg-primary text-on-primary rounded-tr-none' : 'bg-surface-container-low text-on-surface rounded-tl-none'} shadow-sm">
            <p class="leading-relaxed break-words">${m.content}</p>
          </div>
          <span class="text-[9px] text-outline mt-1 font-mono">${new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
      `;
    }).join('');

    feed.scrollTop = feed.scrollHeight;
  } catch (error) {
    console.error('Error loading chat messages:', error);
  }
}

window.handleSendTraderChat = async function(event) {
  event.preventDefault();
  const input = document.getElementById('trader-chat-field');
  const text = input.value.trim();

  if (!text || !activeChatClientId) return;
  input.value = '';

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId: currentUser.id,
        receiverId: activeChatClientId,
        traderId: currentUser.id,
        content: text
      })
    });
    if (res.ok) {
      loadTraderChatLogs();
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
};

// Modal Handlers
window.openNewTradeModal = function() {
  editingSignalId = null;
  const modal = document.getElementById('new-trade-modal');
  document.getElementById('trade-error').classList.add('hidden');
  document.getElementById('new-trade-form').reset();
  clearAttachment('suggestion');

  const modalTitle = modal.querySelector('h3');
  const modalSubtitle = modal.querySelector('p');
  const submitBtn = modal.querySelector('button[type="submit"]');

  if (modalTitle) modalTitle.textContent = 'Publish New Trading suggestion';
  if (modalSubtitle) modalSubtitle.textContent = 'This signal will broadcast to all active subscribers instantly';
  if (submitBtn) {
    submitBtn.innerHTML = `
      <span class="material-symbols-outlined text-[16px]">campaign</span>
      Broadcast Suggestion
    `;
  }

  modal.classList.remove('hidden');
  setTimeout(() => {
    modal.classList.remove('opacity-0');
    const dialog = modal.querySelector('.scale-95') || modal.firstElementChild;
    if (dialog) dialog.classList.remove('scale-95');
  }, 50);
};

window.closeNewTradeModal = function() {
  const modal = document.getElementById('new-trade-modal');
  modal.classList.add('opacity-0');
  const dialog = modal.querySelector('.scale-95') || modal.firstElementChild;
  if (dialog) dialog.classList.add('scale-95');
  setTimeout(() => {
    modal.classList.add('hidden');
  }, 300);
};

window.handleNewTradeSubmit = async function(event) {
  event.preventDefault();
  
  const asset = document.getElementById('trade-asset').value.trim();
  const type = document.getElementById('trade-type').value;
  const entry = document.getElementById('trade-entry').value.trim();
  const target = document.getElementById('trade-target').value.trim();
  const stopLoss = document.getElementById('trade-stop-loss').value.trim();
  const risk = document.getElementById('trade-risk').value;
  const assetType = document.getElementById('trade-asset-type').value;
  const strategy = document.getElementById('trade-strategy').value;
  const notes = document.getElementById('trade-notes').value.trim();
  const errorEl = document.getElementById('trade-error');

  errorEl.classList.add('hidden');

  try {
    let url = '/api/suggestions';
    let method = 'POST';
    let bodyData = {
      traderId: currentUser.id,
      asset,
      type,
      entry,
      target,
      stopLoss,
      risk,
      assetType,
      strategy,
      notes,
      image: suggestionImageConfirmed ? suggestionImageBase64 : null
    };

    if (editingSignalId) {
      url = `/api/suggestions/${editingSignalId}`;
      method = 'PUT';
    }

    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit signal.');

    closeNewTradeModal();
    clearAttachment('suggestion'); // Reset upload UI state
    fetchTraderSignals(); // Reload signal feed
  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove('hidden');
  }
};


// 3. Client Dashboard Logic
async function initClientDashboard() {
  document.getElementById('view-trader').classList.add('hidden');
  document.getElementById('view-client').classList.remove('hidden');

  // Verify Subscription
  if (!currentUser.subscription) {
    document.getElementById('client-suggestions-feed').innerHTML = `
      <div class="text-center py-12">
        <span class="material-symbols-outlined text-[48px] text-outline">error</span>
        <p class="text-xs text-on-surface-variant font-bold mt-2">No Active Subscription Found</p>
        <p class="text-[10px] text-outline mt-1 max-w-sm mx-auto">Please return to the homepage, choose a trader, and complete checkout payment to unlock direct suggest insides.</p>
        <a href="/" class="inline-block mt-4 bg-primary text-on-primary text-xs font-bold px-6 py-2.5 rounded-lg shadow-sm">Home & Pricing</a>
      </div>
    `;
    return;
  }

  // Load Trader Profile details on dashboard
  await fetchSubscribedTraderInfo();
  
  // Load signals
  fetchClientSignals();
  if (signalsPollInterval) clearInterval(signalsPollInterval);
  signalsPollInterval = setInterval(fetchClientSignals, 5000);

  // Load chat
  loadClientChatLogs();
  if (chatPollInterval) clearInterval(chatPollInterval);
  chatPollInterval = setInterval(loadClientChatLogs, 3000);
}

async function fetchSubscribedTraderInfo() {
  try {
    const res = await fetch('/api/traders');
    const traders = await res.json();
    const subTrader = traders.find(t => t.id === currentUser.subscription.traderId);

    if (subTrader) {
      document.getElementById('client-trader-avatar').src = subTrader.avatar;
      document.getElementById('client-trader-name').textContent = subTrader.name;
      document.getElementById('client-trader-strategy').textContent = subTrader.strategy;
      document.getElementById('client-trader-description').textContent = subTrader.description;

      document.getElementById('chat-header-avatar').src = subTrader.avatar;
      document.getElementById('chat-header-name').textContent = subTrader.name;
    }
  } catch (error) {
    console.error('Error fetching subscribed trader profile:', error);
  }
}

async function fetchClientSignals() {
  try {
    const res = await fetch(`/api/suggestions?role=client&userId=${currentUser.id}`);
    if (!res.ok) throw new Error();
    const signals = await res.json();
    const feed = document.getElementById('client-suggestions-feed');

    if (!feed) return;

    if (signals.length === 0) {
      feed.innerHTML = `<p class="text-xs text-outline text-center mt-12">Your expert hasn't posted any inside signals recently. Monitoring live feed...</p>`;
      return;
    }

    feed.innerHTML = signals.map(s => {
      const isBuy = s.type.toLowerCase() === 'buy';
      return `
        <div class="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 flex flex-col md:flex-row justify-between md:items-center gap-4 hover:border-primary-container transition-all animate-fade-in relative">
          ${s.edited ? `
            <span class="absolute top-2 right-2 text-[9px] text-primary font-bold bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded flex items-center gap-0.5 select-none">
              <span class="material-symbols-outlined text-[10px]">edit_note</span> Edited
            </span>
          ` : ''}
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-sm text-on-surface">${s.asset}</span>
              <span class="${isBuy ? 'bg-primary/10 text-primary' : 'bg-error/10 text-error'} text-[10px] font-bold px-2 py-0.5 rounded uppercase">${s.type}</span>
              <span class="bg-surface-container-highest text-secondary text-[9px] font-bold px-1.5 py-0.5 rounded">Risk: ${s.risk}</span>
              ${s.assetType ? `<span class="bg-tertiary-container/30 text-tertiary text-[9px] font-bold px-1.5 py-0.5 rounded">${s.assetType}</span>` : ''}
              ${s.strategy ? `<span class="bg-secondary-container/30 text-on-secondary-container text-[9px] font-bold px-1.5 py-0.5 rounded">${s.strategy}</span>` : ''}
            </div>
            <div class="grid grid-cols-3 gap-3 text-center bg-surface-container-lowest p-2 rounded-lg border border-outline-variant/20 mt-2">
              <div>
                <span class="text-[9px] text-outline block">ENTRY</span>
                <span class="font-mono text-xs font-bold text-on-surface">${s.entry}</span>
              </div>
              <div>
                <span class="text-[9px] text-outline block">TARGET</span>
                <span class="font-mono text-xs font-bold text-primary">${s.target}</span>
              </div>
              <div>
                <span class="text-[9px] text-outline block">STOP LOSS</span>
                <span class="font-mono text-xs font-bold text-error">${s.stopLoss}</span>
              </div>
            </div>
            ${s.notes ? `<p class="text-xs text-on-surface-variant italic mt-2">"${s.notes}"</p>` : ''}
            ${s.image ? `
              <div class="mt-2.5">
                <button type="button" onclick="openLightbox('${s.image}', 'Chart Analysis for ${s.asset}')" class="group relative flex items-center gap-1.5 bg-surface-container-highest/60 hover:bg-primary/10 border border-outline-variant/30 hover:border-primary/30 p-1.5 rounded-lg transition-all text-[10px] font-bold text-on-surface-variant hover:text-primary">
                  <img src="${s.image}" class="w-10 h-10 object-cover rounded border border-outline-variant/40" />
                  <span class="flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">zoom_in</span> View Technical Chart
                  </span>
                </button>
              </div>
            ` : ''}
          </div>
          <span class="text-[9px] text-outline shrink-0 font-mono self-start md:self-center">${new Date(s.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error fetching subscriber signals:', error);
  }
}

async function loadClientChatLogs() {
  if (!currentUser.subscription) return;
  const traderId = currentUser.subscription.traderId;

  try {
    const res = await fetch(`/api/chat/messages?clientId=${currentUser.id}&traderId=${traderId}`);
    const messages = await res.json();
    const feed = document.getElementById('client-chat-messages');

    if (!feed) return;

    if (messages.length === 0) {
      feed.innerHTML = `<p class="text-xs text-outline text-center mt-20">Send a greeting message to start communicating with your expert.</p>`;
      return;
    }

    feed.innerHTML = messages.map(m => {
      const isSelf = m.senderId === currentUser.id;
      return `
        <div class="flex flex-col ${isSelf ? 'items-end' : 'items-start'}">
          <div class="max-w-[85%] rounded-2xl px-4 py-2.5 text-xs ${isSelf ? 'bg-primary text-on-primary rounded-tr-none' : 'bg-surface-container-low text-on-surface rounded-tl-none'} shadow-sm">
            <p class="leading-relaxed break-words">${m.content}</p>
          </div>
          <span class="text-[9px] text-outline mt-1 font-mono">${new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
      `;
    }).join('');

    feed.scrollTop = feed.scrollHeight;
  } catch (error) {
    console.error('Error loading client chat history:', error);
  }
}

window.handleSendClientChat = async function(event) {
  event.preventDefault();
  const input = document.getElementById('client-chat-field');
  const text = input.value.trim();

  if (!text || !currentUser.subscription) return;
  input.value = '';

  const traderId = currentUser.subscription.traderId;

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderId: currentUser.id,
        receiverId: traderId,
        traderId: traderId,
        content: text
      })
    });
    if (res.ok) {
      loadClientChatLogs();
    }
  } catch (error) {
    console.error('Error sending client chat message:', error);
  }
};

function stopPolling() {
  if (chatPollInterval) clearInterval(chatPollInterval);
  if (signalsPollInterval) clearInterval(signalsPollInterval);
  if (countdownInterval) clearInterval(countdownInterval);
  chatPollInterval = null;
  signalsPollInterval = null;
  countdownInterval = null;
}

// Trader Dashboard: Client Communications Tab and Signal posting logic
window.switchCommTab = function(tabName) {
  const chatTab = document.getElementById('comm-tab-chat');
  const signalTab = document.getElementById('comm-tab-signal');
  const chatPanel = document.getElementById('comm-panel-chat');
  const signalPanel = document.getElementById('comm-panel-signal');
  const subHeader = document.getElementById('comm-sub-header');
  
  if (!chatTab || !signalTab || !chatPanel || !signalPanel || !subHeader) return;
  
  if (tabName === 'chat') {
    chatPanel.classList.remove('hidden');
    signalPanel.classList.add('hidden');
    
    chatTab.classList.add('bg-primary', 'text-on-primary');
    chatTab.classList.remove('text-outline', 'hover:text-on-surface');
    
    signalTab.classList.remove('bg-primary', 'text-on-primary');
    signalTab.classList.add('text-outline', 'hover:text-on-surface');
    
    subHeader.textContent = 'Select subscriber to answer chats';
  } else if (tabName === 'signal') {
    chatPanel.classList.add('hidden');
    signalPanel.classList.remove('hidden');
    
    signalTab.classList.add('bg-primary', 'text-on-primary');
    signalTab.classList.remove('text-outline', 'hover:text-on-surface');
    
    chatTab.classList.remove('bg-primary', 'text-on-primary');
    chatTab.classList.add('text-outline', 'hover:text-on-surface');
    
    subHeader.textContent = 'Broadcast daily complimentary signals';
    loadFreeSignals();
  }
};

window.loadFreeSignals = async function() {
  const counterEl = document.getElementById('free-signal-daily-counter');
  const historyEl = document.getElementById('free-signals-history');
  
  if (!counterEl || !historyEl) return;
  
  try {
    const res = await fetch('/api/free-signals');
    if (!res.ok) throw new Error('Failed to fetch free signals feed.');
    const signals = await res.json();
    
    // Filter for current trader
    const mySignals = signals.filter(s => s.traderId === currentUser.id);
    
    // Calculate how many signals posted today (YYYY-MM-DD in UTC)
    const todayStr = new Date().toISOString().substring(0, 10);
    const todaySignals = mySignals.filter(s => s.createdAt && s.createdAt.startsWith(todayStr));
    const countToday = todaySignals.length;
    
    counterEl.textContent = `Daily Limit: ${countToday} / 3 posted today`;
    
    // Render list
    if (mySignals.length === 0) {
      historyEl.innerHTML = `<p class="text-[10px] text-outline italic py-3 text-center bg-surface-container-low rounded-lg">No signals broadcasted yet.</p>`;
      return;
    }
    
    historyEl.innerHTML = mySignals.map(s => {
      const time = new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const date = new Date(s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `
        <div class="p-3 bg-surface-container-low border border-outline-variant/20 rounded-xl space-y-1.5 animate-fade">
          <div class="flex items-center justify-between text-[9px] text-outline font-mono">
            <span>Posted on ${date} at ${time}</span>
            <span class="font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">Active: ${s.timing}</span>
          </div>
          <p class="text-xs text-on-surface leading-normal font-medium whitespace-pre-wrap">${s.description}</p>
          ${s.image ? `
            <div class="mt-1.5">
              <button type="button" onclick="openLightbox('${s.image}', 'Free Signal Chart')" class="group relative flex items-center gap-1.5 bg-surface-container-highest/60 hover:bg-primary/10 border border-outline-variant/30 hover:border-primary/30 p-1.5 rounded-lg transition-all text-[9px] font-bold text-on-surface-variant hover:text-primary">
                <img src="${s.image}" class="w-8 h-8 object-cover rounded border border-outline-variant/40" />
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[12px]">zoom_in</span> View Chart
                </span>
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
    
  } catch (error) {
    console.error('Error loading free signals history:', error);
  }
};

window.handlePostFreeSignal = async function(event) {
  event.preventDefault();
  
  const descEl = document.getElementById('free-signal-description');
  const timingEl = document.getElementById('free-signal-timing');
  const formEl = document.getElementById('free-signal-form');
  
  if (!descEl || !timingEl) return;
  
  const description = descEl.value.trim();
  const timing = timingEl.value.trim();
  
  if (!description || !timing) {
    alert('Please fill out both the description and timing fields.');
    return;
  }
  
  try {
    const res = await fetch('/api/free-signals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description,
        timing,
        image: freeSignalImageConfirmed ? freeSignalImageBase64 : null
      })
    });
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to post free signal.');
    }
    
    // Clear form inputs
    formEl.reset();
    clearAttachment('free-signal'); // Reset upload UI state
    
    // Refresh history
    await loadFreeSignals();
    
  } catch (error) {
    alert(error.message);
  }
};

// ── Image Upload Processing Helpers ──────────────────────────────────────────
window.initImageUploads = function() {
  setupUploadArea('suggestion');
  setupUploadArea('free-signal');
};

function setupUploadArea(type) {
  const dropzone = document.getElementById(`${type}-upload-dropzone`);
  const fileInput = document.getElementById(`${type}-image-input`);

  if (!dropzone || !fileInput) return;

  // Prevent default drag behaviors
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, e => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  // Highlight drop zone on drag hover
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => {
      dropzone.classList.add('bg-surface-container-high', 'border-primary');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => {
      dropzone.classList.remove('bg-surface-container-high', 'border-primary');
    }, false);
  });

  // Handle drop
  dropzone.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      processSelectedImage(files[0], type);
    }
  });

  // Handle file dialog selection
  fileInput.addEventListener('change', e => {
    if (fileInput.files.length > 0) {
      processSelectedImage(fileInput.files[0], type);
    }
  });
}

function processSelectedImage(file, type) {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(file.type)) {
    alert(`Unsupported file format: ${file.type}. Allowed formats: PNG, JPEG, WEBP, GIF.`);
    return;
  }

  const maxSize = 1.5 * 1024 * 1024;
  if (file.size > maxSize) {
    alert(`File is too large: ${(file.size / (1024 * 1024)).toFixed(2)}MB. Max allowed size is 1.5MB.`);
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    const base64Str = e.target.result;
    
    if (type === 'suggestion') {
      suggestionImageBase64 = base64Str;
      suggestionImageConfirmed = false;
      suggestionImageName = file.name;
    } else {
      freeSignalImageBase64 = base64Str;
      freeSignalImageConfirmed = false;
      freeSignalImageName = file.name;
    }

    updateUploadUIState(type, 'preview', file.name, base64Str);
  };
  reader.readAsDataURL(file);
}

window.confirmAttachment = function(type) {
  if (type === 'suggestion') {
    if (!suggestionImageBase64) return;
    suggestionImageConfirmed = true;
    updateUploadUIState(type, 'confirmed', suggestionImageName);
  } else {
    if (!freeSignalImageBase64) return;
    freeSignalImageConfirmed = true;
    updateUploadUIState(type, 'confirmed', freeSignalImageName);
  }
};

window.clearAttachment = function(type) {
  const fileInput = document.getElementById(`${type}-image-input`);
  if (fileInput) fileInput.value = '';

  if (type === 'suggestion') {
    suggestionImageBase64 = null;
    suggestionImageConfirmed = false;
    suggestionImageName = '';
  } else {
    freeSignalImageBase64 = null;
    freeSignalImageConfirmed = false;
    freeSignalImageName = '';
  }

  updateUploadUIState(type, 'select');
};

function updateUploadUIState(type, state, fileName = '', base64Str = '') {
  const dropzone = document.getElementById(`${type}-upload-dropzone`);
  const previewContainer = document.getElementById(`${type}-preview-container`);
  const previewImg = document.getElementById(`${type}-image-preview`);
  const infoText = document.getElementById(`${type}-image-info`);
  
  const confirmedContainer = document.getElementById(`${type}-confirmed-container`);
  const confirmedInfo = document.getElementById(`${type}-confirmed-info`);

  if (!dropzone || !previewContainer || !confirmedContainer) return;

  if (state === 'select') {
    dropzone.classList.remove('hidden');
    previewContainer.classList.add('hidden');
    confirmedContainer.classList.add('hidden');
  } else if (state === 'preview') {
    dropzone.classList.add('hidden');
    previewContainer.classList.remove('hidden');
    confirmedContainer.classList.add('hidden');
    
    if (previewImg) previewImg.src = base64Str;
    if (infoText) infoText.textContent = fileName;
  } else if (state === 'confirmed') {
    dropzone.classList.add('hidden');
    previewContainer.classList.add('hidden');
    confirmedContainer.classList.remove('hidden');
    
    if (confirmedInfo) confirmedInfo.textContent = fileName;
  }
}

// ── Lightbox Zoom overlay utilities ──────────────────────────────────────────
window.openLightbox = function(src, caption = 'Chart Analysis') {
  const lightbox = document.getElementById('image-lightbox');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-caption');
  
  if (!lightbox || !img) return;
  
  img.src = src;
  if (cap) cap.textContent = caption;
  
  lightbox.classList.remove('hidden');
  setTimeout(() => {
    lightbox.classList.remove('opacity-0');
    img.classList.remove('scale-95');
  }, 10);
};

window.closeLightbox = function() {
  const lightbox = document.getElementById('image-lightbox');
  const img = document.getElementById('lightbox-img');
  
  if (!lightbox || !img) return;
  
  lightbox.classList.add('opacity-0');
  img.classList.add('scale-95');
  
  setTimeout(() => {
    lightbox.classList.add('hidden');
  }, 300);
};

// Global escape listener for lightbox
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeLightbox();
  }
});

