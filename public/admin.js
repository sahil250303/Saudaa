// Saudaa Admin Portal Controller

let adminToken = localStorage.getItem('saudaaAdminToken') || '';
let tempToken = '';

let usersList = [];
let paymentsList = [];
let tradersList = [];
let plansList = [];

// Initialize Page
document.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    enterDashboard();
  } else {
    showLogin();
  }
});

// Authentication Step 1: Username & Password Verification
window.submitStep1 = async function(event) {
  event.preventDefault();
  const usernameEl = document.getElementById('login-username');
  const passwordEl = document.getElementById('login-password');
  const errorEl = document.getElementById('login-error');
  
  if (!usernameEl || !passwordEl) return;
  
  errorEl.classList.add('hidden');
  
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: usernameEl.value,
        password: passwordEl.value
      })
    });
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to authenticate.');
    }
    
    // Step 1 Success. Save tempToken and switch to Step 2
    tempToken = data.tempToken;
    document.getElementById('login-step1-form').classList.add('hidden');
    document.getElementById('login-step2-form').classList.remove('hidden');
    document.getElementById('login-mfa-code').focus();
    
  } catch (err) {
    showLoginError(err.message);
  }
};

// Authentication Step 2: MFA Code Verification
window.submitStep2 = async function(event) {
  event.preventDefault();
  const codeEl = document.getElementById('login-mfa-code');
  
  if (!codeEl) return;
  
  try {
    const res = await fetch('/api/admin/mfa-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tempToken: tempToken,
        code: codeEl.value.trim()
      })
    });
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Verification failed.');
    }
    
    // Step 2 Success. Save admin token and enter dashboard
    adminToken = data.adminToken;
    localStorage.setItem('saudaaAdminToken', adminToken);
    
    enterDashboard();
    
  } catch (err) {
    showLoginError(err.message);
    codeEl.value = '';
    codeEl.focus();
  }
};

// Developer Convenience: Autofill MFA Code
window.autofillMfaDev = async function() {
  try {
    const res = await fetch('/api/admin/dev-mfa');
    if (!res.ok) throw new Error('Could not retrieve dev MFA.');
    const data = await res.json();
    const codeEl = document.getElementById('login-mfa-code');
    if (codeEl && data.code) {
      codeEl.value = data.code;
      // Auto-submit the form
      const submitEvent = new Event('submit', { cancelable: true });
      document.getElementById('login-step2-form').dispatchEvent(submitEvent);
    }
  } catch (err) {
    console.error('Dev MFA autofill error:', err);
    alert('Dev MFA retrieval failed: Make sure server is running and database is seeded.');
  }
};

window.cancelStep2 = function() {
  tempToken = '';
  document.getElementById('login-step2-form').classList.add('hidden');
  document.getElementById('login-step1-form').classList.remove('hidden');
  document.getElementById('login-mfa-code').value = '';
};

function showLogin() {
  document.getElementById('login-container').classList.remove('hidden');
  document.getElementById('admin-dashboard-container').classList.add('hidden');
}

function showLoginError(msg) {
  const errorEl = document.getElementById('login-error');
  const errorMsgEl = document.getElementById('login-error-msg');
  if (errorEl && errorMsgEl) {
    errorMsgEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }
}

// Enter secure dashboard
async function enterDashboard() {
  document.getElementById('login-container').classList.add('hidden');
  document.getElementById('admin-dashboard-container').classList.remove('hidden');
  
  // Clear any login errors
  document.getElementById('login-error').classList.add('hidden');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-mfa-code').value = '';
  
  // Load dashboard data
  await loadDashboardData();
  switchTab('users');
}

// Log out admin
window.logoutAdmin = function() {
  adminToken = '';
  tempToken = '';
  localStorage.removeItem('saudaaAdminToken');
  showLogin();
};

// Load all stats and datasets
async function loadDashboardData() {
  try {
    const headers = { 'Authorization': `Bearer ${adminToken}` };
    
    // 1. Fetch Users
    const usersRes = await fetch('/api/admin/users', { headers });
    if (usersRes.status === 401 || usersRes.status === 403) return logoutAdmin();
    usersList = await usersRes.json();
    
    // 2. Fetch Payments
    const paymentsRes = await fetch('/api/admin/payments', { headers });
    paymentsList = await paymentsRes.json();
    
    // 3. Fetch Traders
    const tradersRes = await fetch('/api/admin/traders', { headers });
    tradersList = await tradersRes.json();
    
    // 4. Fetch Plans
    const plansRes = await fetch('/api/plans'); // Public plans list
    plansList = await plansRes.json();
    
    calculateStats();
    
  } catch (err) {
    console.error('Error fetching dashboard records:', err);
  }
}

// Compute aggregate metrics
function calculateStats() {
  document.getElementById('stat-total-users').textContent = usersList.length;
  document.getElementById('stat-total-traders').textContent = tradersList.length;
  
  const activeSubs = usersList.filter(u => u.subscription && u.subscription.expiresAt && new Date(u.subscription.expiresAt) > new Date());
  document.getElementById('stat-active-subs').textContent = activeSubs.length;
  
  // Platform Revenue from active subs
  let revenue = 0;
  activeSubs.forEach(u => {
    const planId = u.subscription.plan;
    const plan = plansList.find(p => p.id === planId);
    revenue += plan ? plan.price : (planId === 'pro' ? 99 : planId === 'vip' ? 249 : 49);
  });
  document.getElementById('stat-total-revenue').textContent = `₹${revenue}`;
}

// Switch between dashboard sections
window.switchTab = function(tabName) {
  const tabs = ['users', 'payments', 'traders', 'plans'];
  tabs.forEach(t => {
    const section = document.getElementById(`tab-${t}-view`);
    const btn = document.getElementById(`nav-${t}`);
    if (section && btn) {
      if (t === tabName) {
        section.classList.remove('hidden');
        btn.classList.add('bg-surface-container-high/80', 'text-on-surface');
        btn.classList.remove('text-outline');
      } else {
        section.classList.add('hidden');
        btn.classList.remove('bg-surface-container-high/80', 'text-on-surface');
        btn.classList.add('text-outline');
      }
    }
  });
  
  // Render selected tab contents
  if (tabName === 'users') renderUsers();
  else if (tabName === 'payments') renderPayments();
  else if (tabName === 'traders') renderTraders();
  else if (tabName === 'plans') renderPlans();
};

// 1. User Directory Rendering
function renderUsers() {
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  usersList.forEach(u => {
    const isSuspended = u.status === 'suspended';
    const statusText = isSuspended ? 'Suspended' : 'Active';
    const statusClass = isSuspended ? 'bg-error/15 text-error border-error/30' : 'bg-green-500/15 text-green-400 border-green-500/30';
    
    const subInfo = u.subscription 
      ? `<span class="font-bold text-on-surface uppercase">${u.subscription.plan}</span> <span class="text-outline">with</span> ${u.subscription.traderId}`
      : '<span class="text-outline italic">No active subscription</span>';
      
    const row = document.createElement('tr');
    row.className = 'border-b border-outline-variant/10 hover:bg-surface-container/30 transition-colors';
    row.innerHTML = `
      <td class="py-4 px-6 font-mono text-[11px] text-outline">${u.id}</td>
      <td class="py-4 px-6 text-on-surface font-semibold">${u.email}</td>
      <td class="py-4 px-6 font-mono text-[11px] text-outline">${u.subId}</td>
      <td class="py-4 px-6">${subInfo}</td>
      <td class="py-4 px-6">
        <span class="px-2.5 py-1 rounded-full border text-[10px] font-bold ${statusClass}">${statusText}</span>
      </td>
      <td class="py-4 px-6 text-right">
        <button onclick="toggleUserStatus('${u.id}')" 
          class="px-3.5 py-1.5 rounded-lg border border-outline-variant/50 hover:bg-surface-container font-semibold transition-colors text-xs ${isSuspended ? 'text-green-400 hover:border-green-500/40' : 'text-error hover:border-error/40'}">
          ${isSuspended ? 'Reactivate' : 'Suspend'}
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

window.filterUsers = function() {
  const query = document.getElementById('users-search-input').value.toLowerCase().trim();
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  usersList.forEach(u => {
    if (u.email.toLowerCase().includes(query) || u.subId.toLowerCase().includes(query) || u.id.toLowerCase().includes(query)) {
      const isSuspended = u.status === 'suspended';
      const statusText = isSuspended ? 'Suspended' : 'Active';
      const statusClass = isSuspended ? 'bg-error/15 text-error border-error/30' : 'bg-green-500/15 text-green-400 border-green-500/30';
      
      const subInfo = u.subscription 
        ? `<span class="font-bold text-on-surface uppercase">${u.subscription.plan}</span> <span class="text-outline">with</span> ${u.subscription.traderId}`
        : '<span class="text-outline italic">No active subscription</span>';
        
      const row = document.createElement('tr');
      row.className = 'border-b border-outline-variant/10 hover:bg-surface-container/30 transition-colors';
      row.innerHTML = `
        <td class="py-4 px-6 font-mono text-[11px] text-outline">${u.id}</td>
        <td class="py-4 px-6 text-on-surface font-semibold">${u.email}</td>
        <td class="py-4 px-6 font-mono text-[11px] text-outline">${u.subId}</td>
        <td class="py-4 px-6">${subInfo}</td>
        <td class="py-4 px-6">
          <span class="px-2.5 py-1 rounded-full border text-[10px] font-bold ${statusClass}">${statusText}</span>
        </td>
        <td class="py-4 px-6 text-right">
          <button onclick="toggleUserStatus('${u.id}')" 
            class="px-3.5 py-1.5 rounded-lg border border-outline-variant/50 hover:bg-surface-container font-semibold transition-colors text-xs ${isSuspended ? 'text-green-400 hover:border-green-500/40' : 'text-error hover:border-error/40'}">
            ${isSuspended ? 'Reactivate' : 'Suspend'}
          </button>
        </td>
      `;
      tbody.appendChild(row);
    }
  });
};

window.toggleUserStatus = async function(clientId) {
  try {
    const res = await fetch('/api/admin/users/toggle-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ clientId })
    });
    
    if (!res.ok) throw new Error('Toggle user status failed.');
    
    // Refresh client list
    await loadDashboardData();
    renderUsers();
    
  } catch (err) {
    alert(err.message);
  }
};

// 2. Financial Payments Ledger Rendering
function renderPayments() {
  const tbody = document.getElementById('payments-table-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (paymentsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-12 text-center text-outline italic">No payment transactions logged in ledger yet.</td></tr>`;
    return;
  }
  
  paymentsList.forEach(p => {
    const date = new Date(p.timestamp).toLocaleString();
    
    const row = document.createElement('tr');
    row.className = 'border-b border-outline-variant/10 hover:bg-surface-container/30 transition-colors';
    row.innerHTML = `
      <td class="py-4 px-6 font-mono text-[11px] text-outline">${p.id}</td>
      <td class="py-4 px-6 text-on-surface font-semibold">${p.email}</td>
      <td class="py-4 px-6 font-mono text-[11px] text-outline">${p.subId}</td>
      <td class="py-4 px-6">${p.traderName || p.traderId}</td>
      <td class="py-4 px-6 uppercase text-[10px] font-bold text-on-surface-variant">${p.plan}</td>
      <td class="py-4 px-6 font-mono font-bold text-green-400">₹${p.amount}</td>
      <td class="py-4 px-6 text-outline text-[11px]">${date}</td>
      <td class="py-4 px-6">
        <span class="px-2 py-0.5 rounded-md border border-green-500/30 bg-green-500/10 text-green-400 text-[10px] font-bold uppercase">${p.status}</span>
      </td>
    `;
    tbody.appendChild(row);
  });
}

window.filterPayments = function() {
  const filterTier = document.getElementById('payments-plan-filter').value;
  const searchVal = document.getElementById('payments-search-input').value.toLowerCase().trim();
  const tbody = document.getElementById('payments-table-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  const filtered = paymentsList.filter(p => {
    const matchesTier = filterTier === 'all' || p.plan === filterTier;
    const matchesSearch = p.email.toLowerCase().includes(searchVal) || p.subId.toLowerCase().includes(searchVal);
    return matchesTier && matchesSearch;
  });
  
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-12 text-center text-outline italic">No matching transactions found.</td></tr>`;
    return;
  }
  
  filtered.forEach(p => {
    const date = new Date(p.timestamp).toLocaleString();
    const row = document.createElement('tr');
    row.className = 'border-b border-outline-variant/10 hover:bg-surface-container/30 transition-colors';
    row.innerHTML = `
      <td class="py-4 px-6 font-mono text-[11px] text-outline">${p.id}</td>
      <td class="py-4 px-6 text-on-surface font-semibold">${p.email}</td>
      <td class="py-4 px-6 font-mono text-[11px] text-outline">${p.subId}</td>
      <td class="py-4 px-6">${p.traderName || p.traderId}</td>
      <td class="py-4 px-6 uppercase text-[10px] font-bold text-on-surface-variant">${p.plan}</td>
      <td class="py-4 px-6 font-mono font-bold text-green-400">₹${p.amount}</td>
      <td class="py-4 px-6 text-outline text-[11px]">${date}</td>
      <td class="py-4 px-6">
        <span class="px-2 py-0.5 rounded-md border border-green-500/30 bg-green-500/10 text-green-400 text-[10px] font-bold uppercase">${p.status}</span>
      </td>
    `;
    tbody.appendChild(row);
  });
};

// 3. Trader Directory Management Rendering
function renderTraders() {
  const tbody = document.getElementById('traders-table-body');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  tradersList.forEach(t => {
    const isSuspended = t.status === 'suspended';
    const statusText = isSuspended ? 'Suspended' : 'Active';
    const statusClass = isSuspended ? 'bg-error/15 text-error border-error/30' : 'bg-green-500/15 text-green-400 border-green-500/30';
    
    const row = document.createElement('tr');
    row.className = 'border-b border-outline-variant/10 hover:bg-surface-container/30 transition-colors';
    row.innerHTML = `
      <td class="py-4 px-6 font-mono text-outline font-bold">#${t.rank}</td>
      <td class="py-4 px-6 font-mono text-[11px] text-outline">${t.id}</td>
      <td class="py-4 px-6 font-bold text-on-surface flex items-center gap-3">
        <img src="${t.avatar}" class="w-7 h-7 rounded-lg object-cover border border-outline-variant/30" />
        <span>${t.name}</span>
      </td>
      <td class="py-4 px-6 text-on-surface-variant">${t.strategy}</td>
      <td class="py-4 px-6 font-mono text-primary font-bold">${t.roi}%</td>
      <td class="py-4 px-6 font-mono font-bold text-on-surface-variant">${t.winRate}%</td>
      <td class="py-4 px-6 font-mono font-semibold">${t.subscribers}</td>
      <td class="py-4 px-6">
        <span class="px-2 py-0.5 rounded-md border text-[10px] font-bold ${statusClass}">${statusText}</span>
      </td>
      <td class="py-4 px-6 text-right">
        <div class="flex justify-end gap-1.5">
          <button onclick="openTraderModal('${t.id}')" 
            class="px-2.5 py-1.5 rounded-lg border border-outline-variant/50 hover:bg-surface-container font-semibold transition-colors text-xs text-primary hover:border-primary/45">
            Edit
          </button>
          <button onclick="toggleTraderStatus('${t.id}')" 
            class="px-2.5 py-1.5 rounded-lg border border-outline-variant/50 hover:bg-surface-container font-semibold transition-colors text-xs text-outline hover:text-on-surface">
            Status
          </button>
          <button onclick="deleteTrader('${t.id}')" 
            class="px-2.5 py-1.5 rounded-lg border border-outline-variant/50 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 font-semibold transition-colors text-xs text-outline">
            Delete
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  });
}

// Add/Edit Trader Modal
window.openTraderModal = function(traderId = '') {
  const modal = document.getElementById('trader-modal');
  const title = document.getElementById('trader-modal-title');
  const form = document.getElementById('trader-form');
  
  if (!modal || !form) return;
  
  form.reset();
  
  if (traderId) {
    // Edit Mode
    title.textContent = 'Edit Marketplace Trader Profile';
    document.getElementById('trader-id').value = traderId;
    document.getElementById('trader-id').disabled = true; // Cannot edit unique key
    
    const trader = tradersList.find(t => t.id === traderId);
    if (trader) {
      document.getElementById('trader-name').value = trader.name;
      document.getElementById('trader-strategy').value = trader.strategy;
      document.getElementById('trader-roi').value = trader.roi;
      document.getElementById('trader-winrate').value = trader.winRate;
      document.getElementById('trader-avatar').value = trader.avatar || '';
      document.getElementById('trader-description').value = trader.description || '';
      document.getElementById('trader-password').value = '';
    }
  } else {
    // Add Mode
    title.textContent = 'Add Marketplace Trader Profile';
    document.getElementById('trader-id').value = '';
    document.getElementById('trader-id').disabled = false;
    document.getElementById('trader-password').required = true;
  }
  
  // Refresh the dynamic avatar upload dropzone preview UI
  if (window.updateAvatarUI) {
    window.updateAvatarUI();
  }
  
  modal.classList.remove('hidden');
};

window.closeTraderModal = function() {
  const modal = document.getElementById('trader-modal');
  if (modal) modal.classList.add('hidden');
};

window.saveTrader = async function(event) {
  event.preventDefault();
  
  const id = document.getElementById('trader-id').value.trim();
  const name = document.getElementById('trader-name').value.trim();
  const strategy = document.getElementById('trader-strategy').value.trim();
  const roi = document.getElementById('trader-roi').value;
  const winRate = document.getElementById('trader-winrate').value;
  const avatar = document.getElementById('trader-avatar').value.trim();
  const password = document.getElementById('trader-password').value.trim();
  const description = document.getElementById('trader-description').value.trim();
  
  // Real-time Input Validation
  if (!id || !name || !strategy || !roi || !winRate) {
    alert('Please fill out all mandatory fields.');
    return;
  }
  
  if (parseFloat(roi) < -100 || parseFloat(winRate) < 0 || parseFloat(winRate) > 100) {
    alert('Invalid numeric values for ROI or Win Rate.');
    return;
  }
  
  try {
    const res = await fetch('/api/admin/traders/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        id, name, strategy, roi, winRate, avatar, password, description
      })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save trader failed.');
    
    closeTraderModal();
    await loadDashboardData();
    renderTraders();
    
  } catch (err) {
    alert(err.message);
  }
};

window.toggleTraderStatus = async function(traderId) {
  try {
    const res = await fetch('/api/admin/traders/toggle-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ traderId, action: 'toggle-status' })
    });
    
    if (!res.ok) throw new Error('Toggle trader status failed.');
    await loadDashboardData();
    renderTraders();
    
  } catch (err) {
    alert(err.message);
  }
};

window.deleteTrader = async function(traderId) {
  if (!confirm(`Are you absolutely sure you want to delete trader "${traderId}"? All references and subscriber stats will be lost.`)) {
    return;
  }
  
  try {
    const res = await fetch('/api/admin/traders/toggle-status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ traderId, action: 'delete' })
    });
    
    if (!res.ok) throw new Error('Delete trader failed.');
    await loadDashboardData();
    renderTraders();
    
  } catch (err) {
    alert(err.message);
  }
};

// 4. Plan Modifier Render
function renderPlans() {
  const container = document.getElementById('plans-modifier-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  plansList.forEach(p => {
    const featuresText = p.features ? p.features.join('\n') : '';
    
    const card = document.createElement('div');
    card.className = 'glass-card rounded-2xl p-6 flex flex-col justify-between shadow-sm relative group border border-outline-variant/30 space-y-4';
    card.innerHTML = `
      <div class="space-y-4">
        <div>
          <span class="text-[10px] font-bold uppercase tracking-wider text-primary">Plan Identifier: ${p.id}</span>
          <div class="mt-2.5 space-y-1">
            <label class="block text-[10px] font-bold text-on-surface-variant uppercase">Tier Display Name</label>
            <input type="text" id="plan-name-${p.id}" value="${p.name}" 
              class="w-full bg-surface-container border border-outline-variant/40 rounded-xl px-3 py-2 text-xs text-on-surface font-bold focus:outline-none focus:border-primary"/>
          </div>
          <div class="mt-3 space-y-1">
            <label class="block text-[10px] font-bold text-on-surface-variant uppercase">Monthly Price (₹)</label>
            <input type="number" id="plan-price-${p.id}" value="${p.price}" 
              class="w-full bg-surface-container border border-outline-variant/40 rounded-xl px-3 py-2 text-xs text-on-surface font-mono font-bold focus:outline-none focus:border-primary"/>
          </div>
        </div>
        
        <div class="space-y-1">
          <label class="block text-[10px] font-bold text-on-surface-variant uppercase">Feature Components (one per line)</label>
          <textarea id="plan-features-${p.id}" rows="6" 
            class="w-full bg-surface-container border border-outline-variant/40 rounded-xl p-3 text-xs text-on-surface focus:outline-none focus:border-primary custom-scrollbar font-semibold">${featuresText}</textarea>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

window.savePlansConfiguration = async function() {
  const updatedPlans = plansList.map(p => {
    const nameVal = document.getElementById(`plan-name-${p.id}`).value.trim();
    const priceVal = parseInt(document.getElementById(`plan-price-${p.id}`).value);
    const featuresVal = document.getElementById(`plan-features-${p.id}`).value
      .split('\n')
      .map(f => f.trim())
      .filter(f => f !== '');
      
    if (!nameVal || isNaN(priceVal) || priceVal < 0) {
      throw new Error(`Invalid configurations for plan: ${p.id}`);
    }
    
    return {
      id: p.id,
      name: nameVal,
      price: priceVal,
      features: featuresVal
    };
  });
  
  try {
    const res = await fetch('/api/admin/plans/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ plans: updatedPlans })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Update plans configuration failed.');
    
    alert('Plan configurations updated successfully!');
    await loadDashboardData();
    renderPlans();
    
  } catch (err) {
    alert(err.message);
  }
};

// Utilities
function toggleTheme() {
  document.documentElement.classList.toggle('dark');
}

// Avatar Drag and Drop + File Select Upload Mechanics
window.updateAvatarUI = function() {
  const avatarInput = document.getElementById('trader-avatar');
  const dropzone = document.getElementById('trader-avatar-dropzone');
  const instructions = document.getElementById('avatar-upload-instructions');
  const previewContainer = document.getElementById('avatar-preview-container');
  const previewImg = document.getElementById('avatar-preview-img');
  const fileNameEl = document.getElementById('avatar-file-name');
  const fileSizeEl = document.getElementById('avatar-file-size');
  
  if (!avatarInput || !dropzone || !instructions || !previewContainer) return;
  
  const avatarValue = avatarInput.value.trim();
  if (avatarValue) {
    // Show preview state
    instructions.classList.add('hidden');
    previewContainer.classList.remove('hidden');
    previewImg.src = avatarValue;
    
    // Set human-readable file details if it is Base64, otherwise use URL
    if (avatarValue.startsWith('data:image')) {
      fileNameEl.textContent = 'Uploaded Image';
      // Calculate approximate size from Base64 string length
      const approximateSizeKB = Math.round((avatarValue.length * 0.75) / 1024);
      fileSizeEl.textContent = `${approximateSizeKB} KB`;
    } else {
      fileNameEl.textContent = 'External Image URL';
      fileSizeEl.textContent = 'Remote Hosted';
    }
  } else {
    // Show upload instructions state
    instructions.classList.remove('hidden');
    previewContainer.classList.add('hidden');
    previewImg.src = '';
    fileNameEl.textContent = '';
    fileSizeEl.textContent = '';
  }
};

window.handleAvatarDragOver = function(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById('trader-avatar-dropzone');
  if (dropzone) {
    dropzone.classList.add('border-primary', 'bg-surface-container-high/60');
    dropzone.classList.remove('border-outline-variant/40');
  }
};

window.handleAvatarDragLeave = function(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById('trader-avatar-dropzone');
  if (dropzone) {
    dropzone.classList.remove('border-primary', 'bg-surface-container-high/60');
    dropzone.classList.add('border-outline-variant/40');
  }
};

window.handleAvatarDrop = function(event) {
  event.preventDefault();
  event.stopPropagation();
  const dropzone = document.getElementById('trader-avatar-dropzone');
  if (dropzone) {
    dropzone.classList.remove('border-primary', 'bg-surface-container-high/60');
    dropzone.classList.add('border-outline-variant/40');
  }
  
  if (event.dataTransfer && event.dataTransfer.files.length > 0) {
    processAvatarFile(event.dataTransfer.files[0]);
  }
};

window.handleAvatarFileSelect = function(input) {
  if (input.files && input.files.length > 0) {
    processAvatarFile(input.files[0]);
  }
};

window.clearAvatarSelection = function(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  
  const avatarInput = document.getElementById('trader-avatar');
  const fileInput = document.getElementById('trader-avatar-file');
  if (avatarInput) avatarInput.value = '';
  if (fileInput) fileInput.value = '';
  
  window.updateAvatarUI();
};

function processAvatarFile(file) {
  // Check that file is indeed an image
  if (!file.type.match('image.*')) {
    alert('Please select an image file (PNG or JPG).');
    return;
  }
  
  // Check that file size is <= 5MB (5,242,880 bytes)
  if (file.size > 5242880) {
    alert('The file is too large. Please select an image smaller than 5MB.');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const avatarInput = document.getElementById('trader-avatar');
    if (avatarInput) {
      avatarInput.value = e.target.result; // Set Base64 data URL
    }
    
    // Set UI preview
    const fileNameEl = document.getElementById('avatar-file-name');
    const fileSizeEl = document.getElementById('avatar-file-size');
    if (fileNameEl) fileNameEl.textContent = file.name;
    if (fileSizeEl) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      fileSizeEl.textContent = `${sizeMB} MB`;
    }
    
    window.updateAvatarUI();
  };
  
  reader.readAsDataURL(file);
}
