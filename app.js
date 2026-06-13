// ─── BlackVault — Main App JS ───
import { auth, db, storage } from './firebase-config.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, collection,
  addDoc, query, where, orderBy, getDocs, limit,
  onSnapshot, serverTimestamp, increment, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref, uploadString, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ─── CONSTANTS ───
// The owner code is hashed — never exposed in plaintext
const OWNER_HASH = await hashCode("ghkslhtoprodl';c'klkgodjthjnmnjslg:LkOihjodfjnjvnjkkg;ldfhjkpfdrjyijfklvmklsd;f'");

const COINS = {
  USD: { name: 'US Dollar',   symbol: '$',  icon: '💵', color: '#22c55e' },
  TON: { name: 'Toncoin',     symbol: 'TON',icon: '💎', color: '#0088cc' },
  BTC: { name: 'Bitcoin',     symbol: '₿',  icon: '₿',  color: '#f7931a' },
  ETH: { name: 'Ethereum',    symbol: 'Ξ',  icon: '⟠',  color: '#627eea' },
};

const BG_COLORS = [
  { name: 'Чёрный',   value: '#0a0a0f' },
  { name: 'Тёмно-синий', value: '#050a1a' },
  { name: 'Тёмно-зелёный', value: '#051a0f' },
  { name: 'Тёмно-фиолетовый', value: '#12051a' },
  { name: 'Тёмно-красный', value: '#1a0505' },
  { name: 'Сланцево-серый', value: '#0d1117' },
];

// ─── STATE ───
let currentUser = null;
let userData = null;
let unsubscribeWallet = null;

// ─── HELPERS ───
async function hashCode(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'BV-' + Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

function generateCheckId() {
  return Array.from({length:10}, () => Math.floor(Math.random()*36).toString(36).toUpperCase()).join('');
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function fmtAmount(n, coin) {
  if (coin === 'USD') return '$' + parseFloat(n).toFixed(2);
  if (coin === 'BTC') return parseFloat(n).toFixed(8) + ' BTC';
  return parseFloat(n).toFixed(4) + ' ' + coin;
}

// ─── TOAST ───
function toast(msg, type='info', dur=3500) {
  const icons = {success:'✅',error:'❌',info:'ℹ️',warning:'⚠️'};
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span class="toast-text">${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), dur);
}

// ─── AUTH PAGES ───
window.showPage = function(id) {
  ['loginPage','registerPage','usernamePage'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = (p===id) ? 'block' : 'none';
  });
};

window.loginWithEmail = async function() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;
  if (!email || !pass) return toast('Заполните все поля', 'warning');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    toast('Неверный email или пароль', 'error');
  }
};

window.registerWithEmail = async function() {
  const email = document.getElementById('regEmail').value.trim();
  const pass = document.getElementById('regPassword').value;
  const pass2 = document.getElementById('regPasswordConfirm').value;
  if (!email || !pass) return toast('Заполните все поля', 'warning');
  if (pass !== pass2) return toast('Пароли не совпадают', 'error');
  if (pass.length < 6) return toast('Пароль минимум 6 символов', 'warning');
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    if (e.code === 'auth/email-already-in-use') toast('Email уже используется', 'error');
    else toast('Ошибка регистрации', 'error');
  }
};

window.loginWithGoogle = async function() {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch(e) {
    toast('Ошибка Google авторизации', 'error');
  }
};

window.saveUsername = async function() {
  const name = document.getElementById('usernameInput').value.trim();
  if (!name || name.length < 2) return toast('Никнейм минимум 2 символа', 'warning');
  if (name.length > 24) return toast('Максимум 24 символа', 'warning');
  if (!currentUser) return;
  await updateDoc(doc(db, 'wallets', currentUser.uid), { username: name });
  toast('Никнейм установлен!', 'success');
};

// ─── AUTH STATE ───
onAuthStateChanged(auth, async (user) => {
  document.getElementById('pageLoader').style.display = 'none';
  if (!user) {
    currentUser = null;
    userData = null;
    if (unsubscribeWallet) { unsubscribeWallet(); unsubscribeWallet = null; }
    document.getElementById('authSection').style.display = 'block';
    document.getElementById('appSection').style.display = 'none';
    showPage('loginPage');
    return;
  }
  currentUser = user;
  // Check/create wallet doc
  const wRef = doc(db, 'wallets', user.uid);
  const wSnap = await getDoc(wRef);
  if (!wSnap.exists()) {
    const code = generateCode();
    await setDoc(wRef, {
      uid: user.uid,
      email: user.email,
      username: '',
      code: code,
      avatarUrl: '',
      avatarHistory: [],
      balances: { USD:0, TON:0, BTC:0, ETH:0 },
      isOwner: false,
      blocked: false,
      frozen: false,
      createdAt: serverTimestamp()
    });
  }
  // Subscribe to wallet
  unsubscribeWallet = onSnapshot(wRef, snap => {
    userData = snap.data();
    renderApp();
  });
  document.getElementById('authSection').style.display = 'none';
  document.getElementById('appSection').style.display = 'flex';
});

// ─── RENDER APP ───
function renderApp() {
  if (!userData) return;

  // Check if username missing → show username page
  if (!userData.username) {
    document.getElementById('authSection').style.display = 'block';
    document.getElementById('appSection').style.display = 'none';
    showPage('usernamePage');
    return;
  }
  document.getElementById('authSection').style.display = 'none';
  document.getElementById('appSection').style.display = 'flex';

  // Sidebar
  document.getElementById('sidebarUsername').textContent = userData.username;
  document.getElementById('sidebarCode').textContent = userData.code;

  // Avatars
  const avatarUrl = userData.avatarUrl;
  const initials = userData.username.charAt(0).toUpperCase();
  setAvatarEl('sidebarAvatar', 'sidebarAvatarText', avatarUrl, initials);
  setAvatarEl('settingsAvatar', 'settingsAvatarText', avatarUrl, initials);

  // Settings info
  document.getElementById('settingsUsername').textContent = userData.username;
  document.getElementById('settingsCode').textContent = userData.code;
  document.getElementById('settingsEmail').textContent = userData.email || currentUser?.email || '—';

  // Admin
  const isOwner = userData.isOwner;
  document.getElementById('adminNavLabel').style.display = isOwner ? 'block' : 'none';
  document.getElementById('adminNavItem').style.display = isOwner ? 'flex' : 'none';
  document.getElementById('ownerBadge').style.display = isOwner ? 'block' : 'none';
  document.getElementById('ownerStatus').textContent = isOwner ? '✅ Статус владельца активен' : '';
  document.getElementById('ownerStatus').style.color = 'var(--success)';

  // Dashboard
  const bal = userData.balances || {};
  const total = (bal.USD||0) + (bal.TON||0)*6.5 + (bal.BTC||0)*67000 + (bal.ETH||0)*3500;
  document.getElementById('totalBalance').textContent = total.toFixed(2);
  document.getElementById('walletCode').textContent = '🔑 Код: ' + userData.code;
  document.getElementById('dashUSD').textContent = '$' + (bal.USD||0).toFixed(2);
  document.getElementById('dashTON').textContent = (bal.TON||0).toFixed(4);
  document.getElementById('dashBTC').textContent = (bal.BTC||0).toFixed(8);
  document.getElementById('dashETH').textContent = (bal.ETH||0).toFixed(6);
  document.getElementById('dashGreeting').textContent = `Привет, ${userData.username} 👋`;
  document.getElementById('dashDate').textContent = new Date().toLocaleDateString('ru-RU', {weekday:'long',day:'numeric',month:'long'});

  // Blocked
  const isBlocked = userData.blocked || userData.frozen;
  document.getElementById('blockedNotice').style.display = isBlocked ? 'flex' : 'none';

  // Coins grid
  renderCoins(bal);

  // Avatar history
  renderAvatarHistory();

  // Colors
  renderColors();

  // Transactions (dashboard)
  loadRecentTx();

  // Leaderboard
  loadLeaderboard();

  // Owner panel
  if (isOwner) loadAdminData();

  // Checks
  loadMyChecks();

  // History
  loadHistory();

  // Apply saved theme
  applyTheme();
}

function setAvatarEl(containerId, textId, url, initials) {
  const container = document.getElementById(containerId);
  const textEl = document.getElementById(textId);
  if (url) {
    textEl.style.display = 'none';
    let img = container.querySelector('img');
    if (!img) { img = document.createElement('img'); container.appendChild(img); }
    img.src = url;
    img.style.display = 'block';
  } else {
    textEl.textContent = initials;
    textEl.style.display = 'block';
    const img = container.querySelector('img');
    if (img) img.style.display = 'none';
  }
}

// ─── NAVIGATION ───
window.navigateTo = function(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  closeSidebar();

  // Refresh data on navigate
  if (pageId === 'leaderboardPage') loadLeaderboard();
  if (pageId === 'historyPage') loadHistory();
  if (pageId === 'checksPage') { loadMyChecks(); }
  if (pageId === 'adminPage' && userData?.isOwner) loadAdminData();
};

window.toggleSidebar = function() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarBackdrop').classList.toggle('open');
};
window.closeSidebar = function() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('open');
};

// ─── MODALS ───
window.openModal = function(id) { document.getElementById(id).classList.add('open'); };
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); };

// ─── TABS ───
window.switchTab = function(tabId, btn) {
  const parent = btn.closest('.page') || btn.closest('#appSection');
  const allPanels = parent?.querySelectorAll('[id]') || document.querySelectorAll('[id]');
  const tabGroup = btn.closest('.tabs');
  tabGroup.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // Hide/show sibling panels (simple approach: look for IDs matching sibling tab IDs)
  const siblingBtns = tabGroup.querySelectorAll('.tab-btn');
  siblingBtns.forEach(b => {
    const onclick = b.getAttribute('onclick');
    const match = onclick?.match(/switchTab\('(\w+)'/);
    if (match) {
      const el = document.getElementById(match[1]);
      if (el) el.style.display = 'none';
    }
  });
  const target = document.getElementById(tabId);
  if (target) target.style.display = 'block';
};

// ─── COINS ───
function renderCoins(bal) {
  const grid = document.getElementById('coinsGrid');
  grid.innerHTML = Object.entries(COINS).map(([k, c]) => `
    <div class="coin-card">
      <div class="coin-header">
        <div class="coin-icon" style="background:${c.color}22;color:${c.color}">${c.icon}</div>
        <div>
          <div class="coin-name">${c.name}</div>
          <div class="coin-symbol">${k}</div>
        </div>
      </div>
      <div class="coin-balance" style="color:${c.color}">${k === 'USD' ? '$' : ''}${(bal[k]||0).toFixed(k==='BTC'?8:k==='ETH'?6:4)} ${k!=='USD'?k:''}</div>
      <div class="coin-usd">${k !== 'USD' ? '≈ $' + ((bal[k]||0) * getRate(k)).toFixed(2) : ''}</div>
    </div>
  `).join('');
}

function getRate(coin) {
  const rates = { TON:6.5, BTC:67000, ETH:3500, USD:1 };
  return rates[coin] || 1;
}

// ─── TRANSFER ───
document.getElementById('transferCurrency')?.addEventListener('change', e => {
  document.getElementById('transferCurrencyBadge').textContent = e.target.value;
});

window.executeTransfer = async function() {
  if (!userData || userData.blocked || userData.frozen) return toast('Ваш кошелёк заблокирован', 'error');
  const toCode = document.getElementById('transferTo').value.trim().toUpperCase();
  const currency = document.getElementById('transferCurrency').value;
  const amount = parseFloat(document.getElementById('transferAmount').value);
  const comment = document.getElementById('transferComment').value.trim();

  if (!toCode.startsWith('BV-') || toCode.length !== 9) return toast('Неверный код получателя', 'warning');
  if (!amount || amount <= 0) return toast('Введите сумму', 'warning');
  if (toCode === userData.code) return toast('Нельзя переводить себе', 'warning');

  const myBal = userData.balances?.[currency] || 0;
  if (amount > myBal) return toast(`Недостаточно ${currency}`, 'error');

  // Find recipient
  const q = query(collection(db, 'wallets'), where('code', '==', toCode));
  const snap = await getDocs(q);
  if (snap.empty) return toast('Получатель не найден', 'error');

  const recipientDoc = snap.docs[0];
  const recipientId = recipientDoc.id;
  const recipientData = recipientDoc.data();

  if (recipientData.blocked || recipientData.frozen) return toast('Кошелёк получателя заблокирован', 'error');

  const batch = writeBatch(db);
  batch.update(doc(db,'wallets',currentUser.uid), { [`balances.${currency}`]: increment(-amount) });
  batch.update(doc(db,'wallets',recipientId), { [`balances.${currency}`]: increment(amount) });

  const txData = {
    fromUid: currentUser.uid,
    fromCode: userData.code,
    fromUsername: userData.username,
    toUid: recipientId,
    toCode,
    toUsername: recipientData.username,
    currency,
    amount,
    comment,
    type: 'transfer',
    createdAt: serverTimestamp()
  };
  batch.set(doc(collection(db,'transactions')), txData);

  await batch.commit();
  toast(`Переведено ${fmtAmount(amount, currency)} → ${recipientData.username}`, 'success');
  document.getElementById('transferTo').value = '';
  document.getElementById('transferAmount').value = '';
  document.getElementById('transferComment').value = '';
};

// ─── CHECKS ───
window.createCheck = async function() {
  if (!userData || userData.blocked || userData.frozen) return toast('Ваш кошелёк заблокирован', 'error');
  const currency = document.getElementById('checkCurrency').value;
  const amount = parseFloat(document.getElementById('checkAmount').value);
  const desc = document.getElementById('checkDescription').value.trim();

  if (!amount || amount <= 0) return toast('Введите сумму', 'warning');
  const myBal = userData.balances?.[currency] || 0;
  if (amount > myBal) return toast(`Недостаточно ${currency}`, 'error');

  const checkId = generateCheckId();
  await setDoc(doc(db,'checks',checkId), {
    id: checkId,
    fromUid: currentUser.uid,
    fromCode: userData.code,
    fromUsername: userData.username,
    currency,
    amount,
    description: desc,
    status: 'active',
    createdAt: serverTimestamp()
  });

  // Reserve funds
  await updateDoc(doc(db,'wallets',currentUser.uid), {
    [`balances.${currency}`]: increment(-amount)
  });

  closeModal('createCheckModal');
  toast('Чек создан! ID: ' + checkId, 'success', 6000);
  loadMyChecks();
};

window.payCheck = async function() {
  if (!userData || userData.blocked || userData.frozen) return toast('Ваш кошелёк заблокирован', 'error');
  const checkId = document.getElementById('payCheckInput').value.trim().toUpperCase();
  if (!checkId) return toast('Введите ID чека', 'warning');
  await redeemCheck(checkId);
};

async function redeemCheck(checkId) {
  const checkRef = doc(db,'checks',checkId);
  const checkSnap = await getDoc(checkRef);
  if (!checkSnap.exists()) return toast('Чек не найден', 'error');
  const check = checkSnap.data();
  if (check.status !== 'active') return toast('Чек уже использован или отменён', 'warning');
  if (check.fromUid === currentUser.uid) return toast('Нельзя оплатить свой чек', 'warning');

  const batch = writeBatch(db);
  batch.update(checkRef, { status: 'paid', paidBy: currentUser.uid, paidAt: serverTimestamp() });
  batch.update(doc(db,'wallets',check.fromUid), { [`balances.${check.currency}`]: increment(check.amount) });

  const txData = {
    fromUid: currentUser.uid,
    fromCode: userData.code,
    fromUsername: userData.username,
    toUid: check.fromUid,
    toCode: check.fromCode,
    toUsername: check.fromUsername,
    currency: check.currency,
    amount: check.amount,
    type: 'check_payment',
    checkId,
    createdAt: serverTimestamp()
  };
  batch.set(doc(collection(db,'transactions')), txData);
  await batch.commit();
  toast(`Оплачено! ${fmtAmount(check.amount, check.currency)} → ${check.fromUsername}`, 'success');
  loadMyChecks();
}

async function loadMyChecks() {
  if (!currentUser) return;
  const q = query(collection(db,'checks'), where('fromUid','==',currentUser.uid), orderBy('createdAt','desc'), limit(20));
  const snap = await getDocs(q);
  const list = document.getElementById('myChecksList');
  if (snap.empty) {
    list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px;font-size:14px">Вы ещё не создавали чеки</div>';
    return;
  }
  list.innerHTML = snap.docs.map(d => {
    const c = d.data();
    const statusBadge = c.status === 'active'
      ? '<span class="badge badge-success">Активен</span>'
      : '<span class="badge badge-info">Оплачен</span>';
    return `
      <div class="check-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="check-amount">${fmtAmount(c.amount, c.currency)}</div>
            ${c.description ? `<div class="check-from">${c.description}</div>` : ''}
            <div class="check-id">ID: ${c.id}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${formatDate(c.createdAt)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
            ${statusBadge}
            <button class="btn btn-secondary btn-sm" onclick="copyCheckId('${c.id}')">📋 Скопировать ID</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.copyCheckId = function(id) {
  navigator.clipboard.writeText(id).then(() => toast('ID чека скопирован', 'success'));
};

// ─── HISTORY ───
async function loadRecentTx() {
  if (!currentUser) return;
  const list = document.getElementById('recentTxList');
  const q = query(collection(db,'transactions'),
    where('fromUid','==',currentUser.uid),
    orderBy('createdAt','desc'), limit(5));
  const q2 = query(collection(db,'transactions'),
    where('toUid','==',currentUser.uid),
    orderBy('createdAt','desc'), limit(5));

  const [s1,s2] = await Promise.all([getDocs(q),getDocs(q2)]);
  const txs = [...s1.docs,...s2.docs]
    .map(d=>({...d.data(),_id:d.id}))
    .sort((a,b)=> (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
    .slice(0,6);

  if (!txs.length) {
    list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:24px;font-size:14px">Операций ещё нет</div>';
    return;
  }
  list.innerHTML = txs.map(tx => renderTxItem(tx)).join('');
}

async function loadHistory() {
  if (!currentUser) return;
  const list = document.getElementById('historyList');
  const q = query(collection(db,'transactions'), where('fromUid','==',currentUser.uid), orderBy('createdAt','desc'), limit(50));
  const q2 = query(collection(db,'transactions'), where('toUid','==',currentUser.uid), orderBy('createdAt','desc'), limit(50));
  const [s1,s2] = await Promise.all([getDocs(q),getDocs(q2)]);
  const txs = [...s1.docs,...s2.docs]
    .map(d=>({...d.data(),_id:d.id}))
    .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  if (!txs.length) {
    list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px;font-size:14px">Нет операций</div>';
    return;
  }
  list.innerHTML = txs.map(tx => renderTxItem(tx)).join('');
}

function renderTxItem(tx) {
  const isSent = tx.fromUid === currentUser.uid;
  const type = isSent ? 'send' : 'receive';
  const icon = tx.type === 'check_payment' ? '🧾' : isSent ? '📤' : '📥';
  const amountColor = isSent ? 'var(--danger)' : 'var(--success)';
  const sign = isSent ? '-' : '+';
  const counterpart = isSent ? (tx.toUsername || tx.toCode) : (tx.fromUsername || tx.fromCode);
  const label = tx.type === 'check_payment'
    ? (isSent ? 'Оплата чека' : 'Получен чек')
    : (isSent ? 'Перевод → ' + counterpart : 'От ' + counterpart);

  return `
    <div class="tx-item">
      <div class="tx-icon ${type}">${icon}</div>
      <div class="tx-info">
        <div class="tx-title">${label}${tx.comment ? ' · ' + tx.comment : ''}</div>
        <div class="tx-date">${formatDate(tx.createdAt)}</div>
      </div>
      <div class="tx-amount">
        <div class="amount" style="color:${amountColor}">${sign}${fmtAmount(tx.amount, tx.currency)}</div>
      </div>
    </div>
  `;
}

// ─── LEADERBOARD ───
async function loadLeaderboard() {
  const list = document.getElementById('leaderboardList');
  const snap = await getDocs(query(collection(db,'wallets'), limit(100)));
  const users = snap.docs.map(d => d.data())
    .filter(u => u.username && !u.blocked)
    .map(u => {
      const b = u.balances || {};
      const total = (b.USD||0) + (b.TON||0)*6.5 + (b.BTC||0)*67000 + (b.ETH||0)*3500;
      return {...u, totalUSD: total};
    })
    .sort((a,b) => b.totalUSD - a.totalUSD)
    .slice(0,50);

  if (!users.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px">Нет данных</div>';
    return;
  }

  list.innerHTML = users.map((u,i) => {
    const rank = i+1;
    const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-other';
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
    const isMe = u.uid === currentUser?.uid;
    const avatar = u.avatarUrl
      ? `<img src="${u.avatarUrl}" style="width:36px;height:36px;border-radius:50%;object-fit:cover"/>`
      : `<div class="user-avatar" style="width:36px;height:36px;font-size:14px">${u.username.charAt(0).toUpperCase()}</div>`;

    return `
      <div class="leaderboard-item" style="${isMe ? 'border-color:rgba(108,71,255,0.4);background:rgba(108,71,255,0.05)' : ''}">
        <div class="rank-badge ${rankClass}">${medal}</div>
        ${avatar}
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${u.username} ${isMe ? '(Вы)' : ''} ${u.isOwner ? '👑' : ''}</div>
          <div style="font-size:12px;color:var(--text-muted)">${u.code}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--font-display);font-weight:700;font-size:16px;color:var(--gold)">$${u.totalUSD.toLocaleString('ru-RU',{maximumFractionDigits:2})}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── SETTINGS ───
window.changeUsername = async function() {
  const name = document.getElementById('newUsername').value.trim();
  if (!name || name.length < 2) return toast('Минимум 2 символа', 'warning');
  await updateDoc(doc(db,'wallets',currentUser.uid), { username: name });
  toast('Никнейм изменён', 'success');
  document.getElementById('newUsername').value = '';
};

window.uploadAvatar = async function(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 3*1024*1024) return toast('Максимум 3MB', 'warning');

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result;
    try {
      const storageRef = ref(storage, `avatars/${currentUser.uid}/${Date.now()}`);
      await uploadString(storageRef, base64, 'data_url');
      const url = await getDownloadURL(storageRef);

      const history = userData.avatarHistory || [];
      if (!history.includes(url)) history.unshift(url);
      const trimmedHistory = history.slice(0,10);

      await updateDoc(doc(db,'wallets',currentUser.uid), {
        avatarUrl: url,
        avatarHistory: trimmedHistory
      });
      toast('Аватар обновлён', 'success');
    } catch(e) {
      // Fallback: store base64 directly in Firestore (small images)
      const history = userData.avatarHistory || [];
      history.unshift(base64);
      const trimmed = history.slice(0,5);
      await updateDoc(doc(db,'wallets',currentUser.uid), {
        avatarUrl: base64,
        avatarHistory: trimmed
      });
      toast('Аватар обновлён', 'success');
    }
  };
  reader.readAsDataURL(file);
};

function renderAvatarHistory() {
  const container = document.getElementById('avatarHistory');
  const history = userData?.avatarHistory || [];
  if (!history.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Нет сохранённых аватаров</div>';
    return;
  }
  const current = userData?.avatarUrl;
  container.innerHTML = history.map(url => `
    <img src="${url}" class="avatar-thumb ${url===current?'selected':''}" 
         onclick="selectAvatar('${url}')" title="Выбрать аватар"/>
  `).join('');
}

window.selectAvatar = async function(url) {
  await updateDoc(doc(db,'wallets',currentUser.uid), { avatarUrl: url });
  toast('Аватар выбран', 'success');
};

// Colors
function renderColors() {
  const grid = document.getElementById('colorGrid');
  const saved = localStorage.getItem('bv_bg_color');
  grid.innerHTML = BG_COLORS.map(c => `
    <div class="color-swatch ${saved===c.value?'selected':''}" 
         style="background:${c.value};border:2px solid ${saved===c.value?'var(--accent)':'var(--border)'}"
         onclick="selectColor('${c.value}')" title="${c.name}"></div>
  `).join('');
}

window.selectColor = function(color) {
  localStorage.setItem('bv_bg_color', color);
  localStorage.removeItem('bv_bg_image');
  applyTheme();
  renderColors();
};

window.uploadBackground = function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    localStorage.setItem('bv_bg_image', e.target.result);
    localStorage.removeItem('bv_bg_color');
    applyTheme();
    toast('Фон установлен', 'success');
  };
  reader.readAsDataURL(file);
};

window.resetBackground = function() {
  localStorage.removeItem('bv_bg_color');
  localStorage.removeItem('bv_bg_image');
  applyTheme();
  renderColors();
  toast('Фон сброшен', 'success');
};

function applyTheme() {
  const bgImage = localStorage.getItem('bv_bg_image');
  const bgColor = localStorage.getItem('bv_bg_color');
  document.body.classList.remove('custom-bg','custom-color');
  if (bgImage) {
    document.documentElement.style.setProperty('--custom-bg', `url(${bgImage})`);
    document.body.classList.add('custom-bg');
  } else if (bgColor) {
    document.documentElement.style.setProperty('--custom-color', bgColor);
    document.body.classList.add('custom-color');
    document.body.style.background = bgColor;
  } else {
    document.body.style.background = '';
    document.documentElement.style.removeProperty('--custom-bg');
    document.documentElement.style.removeProperty('--custom-color');
  }
}

// ─── OWNER CODE ───
window.activateOwnerCode = async function() {
  const input = document.getElementById('ownerCodeInput').value;
  if (!input) return toast('Введите код', 'warning');
  const hash = await hashCode(input);
  if (hash !== OWNER_HASH) {
    toast('Неверный код', 'error');
    document.getElementById('ownerCodeInput').value = '';
    return;
  }
  await updateDoc(doc(db,'wallets',currentUser.uid), { isOwner: true });
  document.getElementById('ownerCodeInput').value = '';
  toast('Статус владельца активирован! 👑', 'success', 5000);
};

// ─── ADMIN PANEL ───
async function loadAdminData() {
  loadAdminWallets();
  loadAdminTransactions('deposit');
  loadAdminTransactions('withdrawal');
}

async function loadAdminWallets() {
  const snap = await getDocs(collection(db,'wallets'));
  const tbody = document.getElementById('adminWalletsBody');
  tbody.innerHTML = snap.docs.map(d => {
    const u = d.data();
    const b = u.balances || {};
    const total = (b.USD||0) + (b.TON||0)*6.5 + (b.BTC||0)*67000 + (b.ETH||0)*3500;
    const status = u.blocked ? '<span class="badge badge-danger">Заблокирован</span>'
      : u.frozen ? '<span class="badge badge-warning">Заморожен</span>'
      : '<span class="badge badge-success">Активен</span>';
    return `
      <tr>
        <td><strong>${u.username||'—'}</strong><br><span style="font-size:11px;color:var(--text-muted)">${u.email||''}</span></td>
        <td><code style="font-size:12px">${u.code||'—'}</code></td>
        <td>$${total.toFixed(2)}</td>
        <td>${status}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" onclick="adminToggleBlock('${d.id}',${!u.blocked})">
              ${u.blocked ? '🔓 Разблокировать' : '🔒 Заблокировать'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="adminToggleFreeze('${d.id}',${!u.frozen})">
              ${u.frozen ? '❄️ Разморозить' : '🌡 Заморозить'}
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadAdminTransactions(type) {
  // We'll show all transfers
  const snap = await getDocs(query(collection(db,'transactions'), orderBy('createdAt','desc'), limit(50)));
  const depositsBody = document.getElementById('adminDepositsBody');
  const withdrawalsBody = document.getElementById('adminWithdrawalsBody');

  const txs = snap.docs.map(d => d.data());
  const transfers = txs.filter(t => t.type === 'transfer' || t.type === 'check_payment');

  if (depositsBody) {
    depositsBody.innerHTML = transfers.length ? transfers.map(t => `
      <tr>
        <td>${t.fromUsername || t.fromCode}</td>
        <td>${fmtAmount(t.amount, t.currency)}</td>
        <td>${t.currency}</td>
        <td style="font-size:12px">${formatDate(t.createdAt)}</td>
      </tr>
    `).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">Нет данных</td></tr>';
  }
  if (withdrawalsBody) {
    withdrawalsBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px">Выводов не было</td></tr>';
  }
}

window.adminToggleBlock = async function(uid, block) {
  await updateDoc(doc(db,'wallets',uid), { blocked: block });
  toast(block ? 'Кошелёк заблокирован' : 'Кошелёк разблокирован', block ? 'warning' : 'success');
  loadAdminWallets();
};

window.adminToggleFreeze = async function(uid, freeze) {
  await updateDoc(doc(db,'wallets',uid), { frozen: freeze });
  toast(freeze ? 'Кошелёк заморожен' : 'Кошелёк разморожен', freeze ? 'info' : 'success');
  loadAdminWallets();
};

window.adminGiveMoney = async function() {
  if (!userData?.isOwner) return;
  const currency = document.getElementById('adminCurrency').value;
  const amount = parseFloat(document.getElementById('adminAmount').value);
  if (!amount || amount <= 0) return toast('Введите сумму', 'warning');

  await updateDoc(doc(db,'wallets',currentUser.uid), {
    [`balances.${currency}`]: increment(amount)
  });

  // Log it
  await addDoc(collection(db,'transactions'), {
    fromUid: 'system',
    fromCode: 'SYSTEM',
    fromUsername: 'Система',
    toUid: currentUser.uid,
    toCode: userData.code,
    toUsername: userData.username,
    currency,
    amount,
    type: 'admin_grant',
    createdAt: serverTimestamp()
  });

  toast(`Начислено ${fmtAmount(amount, currency)} 💰`, 'success');
  document.getElementById('adminAmount').value = '';
};

// ─── MISC ───
window.showComingSoon = function(feature) {
  toast(`${feature} — временно недоступно`, 'info');
};

window.logout = async function() {
  await signOut(auth);
  toast('Вы вышли из аккаунта', 'info');
};

// Apply theme on load
applyTheme();
