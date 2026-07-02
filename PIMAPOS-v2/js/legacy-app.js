/* ════════════════════════════════════════════════════
   PIMAPOS — App bootstrap & module wiring
   File ini adalah hasil migrasi dari single inline <script>
   monolitik menjadi ES module, dipasang lewat
   <script type="module" src="js/legacy-app.js"> di index.html.
   Business logic di bawah TIDAK diubah strukturnya secara
   besar-besaran (masih satu file besar) — itu domain Fase 2
   (pemecahan lebih lanjut ke ui/, components/, services/).
   Yang berubah di Fase 1: storage (IndexedDB), modal manager,
   camera lifecycle, global error handling, dan tambalan XSS
   di titik-titik render dengan risiko tertinggi.
════════════════════════════════════════════════════ */
import * as Store from './state/store.js';
import * as ModalManager from './core/modal-manager.js';
import * as Camera from './services/camera.js';
import * as ErrorHandling from './core/errors.js';
import { esc } from './utils/sanitize.js';

ErrorHandling.installGlobalErrorHandlers();
ErrorHandling.markBootPhase(true);

await Store.init();

/* ════════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════════ */
const STORE_CATEGORIES=['F&B','Cafe','Restoran','Retail/Toko','Fashion/Clothing','Distro','Elektronik','Kecantikan','Otomotif/Bengkel','Kesehatan/Apotek','Jasa/Servis','Laundry','Grosir/Sembako','Lainnya'];
/* Kategori yang menggunakan alur "Artikel Produk" bertipe SKU/Barcode (scan kamera) — cocok untuk toko fisik produk dengan barcode kemasan */
const RETAIL_LIKE_CATS=['Retail/Toko','Fashion/Clothing','Distro','Elektronik','Kecantikan','Otomotif/Bengkel','Kesehatan/Apotek','Grosir/Sembako'];
/* Kategori F&B & jasa — biasanya tidak punya barcode kemasan, jadi pakai kode artikel internal otomatis */
const FNB_LIKE_CATS=['F&B','Cafe','Restoran','Laundry','Jasa/Servis','Lainnya'];
const CATEGORY_DEFAULT_ICON={'Retail/Toko':'📦','Fashion/Clothing':'👕','Distro':'👟','Elektronik':'📱','Kecantikan':'💄','Otomotif/Bengkel':'🔧','Kesehatan/Apotek':'💊','Grosir/Sembako':'🧺','F&B':'🍔','Cafe':'☕','Restoran':'🍽️','Laundry':'🧺','Jasa/Servis':'🛠️','Lainnya':'🏷️'};
const SOCIAL_PLATFORMS=[
  {k:'whatsapp',l:'WhatsApp',ic:'💬'},
  {k:'instagram',l:'Instagram',ic:'📸'},
  {k:'tiktok',l:'TikTok',ic:'🎵'},
  {k:'facebook',l:'Facebook',ic:'📘'},
  {k:'shopee',l:'Shopee',ic:'🛍️'},
  {k:'tokopedia',l:'Tokopedia',ic:'🏬'},
  {k:'website',l:'Website',ic:'🌐'},
];
/* ════════════════════════════════════════════════════
   MEMBER / PELANGGAN — TIER & REWARD OTOMATIS
   Urutan dari tertinggi supaya pencarian tier pertama yang
   cocok (spend >= min) langsung benar.
════════════════════════════════════════════════════ */
const CUSTOMER_TIERS=[
  {key:'platinum',label:'Platinum',icon:'💎',min:5000000,discount:15,color:'#93c5fd'},
  {key:'gold',label:'Gold',icon:'🥇',min:2000000,discount:10,color:'#fbbf24'},
  {key:'silver',label:'Silver',icon:'🥈',min:500000,discount:5,color:'#cbd5e1'},
  {key:'bronze',label:'Bronze',icon:'🥉',min:0,discount:0,color:'#cd7f32'},
];
function getTier(spend){
  return CUSTOMER_TIERS.find(t=>(spend||0)>=t.min)||CUSTOMER_TIERS[CUSTOMER_TIERS.length-1];
}
function nextTierInfo(spend){
  const idx=CUSTOMER_TIERS.findIndex(t=>(spend||0)>=t.min);
  if(idx<=0)return null; // sudah tier tertinggi
  const next=CUSTOMER_TIERS[idx-1];
  return {tier:next,remaining:Math.max(0,next.min-(spend||0))};
}
function normalizePhone(v){return (v||'').replace(/[^0-9]/g,'');}
function findCustomerByPhone(phone){
  const n=normalizePhone(phone);
  if(!n)return null;
  return S.customers.find(c=>normalizePhone(c.phone)===n)||null;
}

/* ════════════════════════════════════════════════════
   HOLD / BOOKING PRODUK
   Produk yang sedang di-booking pelanggan ditahan dari stok
   yang bisa dijual bebas, tanpa mengurangi stok fisik beneran
   (baru dikurangi saat benar-benar dikonversi jadi transaksi).
════════════════════════════════════════════════════ */
function holdQtyFor(productId){
  return S.holds.filter(h=>h.productId===productId).reduce((s,h)=>s+h.qty,0);
}
function availableStock(p){
  return Math.max(0,p.stock-holdQtyFor(p.id));
}
const CATEGORY_TEMPLATES={
  'F&B':{categories:['Makanan','Minuman','Snack','Lainnya'],products:[
    {name:'Nasi Goreng',emoji:'🍛',cat:'Makanan',price:18000,stock:30},
    {name:'Es Teh Manis',emoji:'🧋',cat:'Minuman',price:5000,stock:60},
    {name:'Ayam Geprek',emoji:'🍗',cat:'Makanan',price:20000,stock:25},
    {name:'Kopi Susu',emoji:'☕',cat:'Minuman',price:12000,stock:40},
    {name:'Kerupuk',emoji:'🍘',cat:'Snack',price:3000,stock:80},
    {name:'Air Mineral',emoji:'💧',cat:'Minuman',price:4000,stock:100},
  ]},
  'Cafe':{categories:['Kopi','Non-Kopi','Pastry','Lainnya'],products:[
    {name:'Kopi Susu Gula Aren',emoji:'☕',cat:'Kopi',price:18000,stock:40},
    {name:'Americano',emoji:'☕',cat:'Kopi',price:15000,stock:40},
    {name:'Matcha Latte',emoji:'🍵',cat:'Non-Kopi',price:20000,stock:30},
    {name:'Croissant',emoji:'🥐',cat:'Pastry',price:15000,stock:20},
    {name:'Red Velvet Cake',emoji:'🍰',cat:'Pastry',price:22000,stock:15},
    {name:'Air Mineral',emoji:'💧',cat:'Non-Kopi',price:5000,stock:60},
  ]},
  'Restoran':{categories:['Makanan Utama','Minuman','Pembuka','Penutup'],products:[
    {name:'Nasi Ayam Bakar',emoji:'🍗',cat:'Makanan Utama',price:25000,stock:30},
    {name:'Sup Buntut',emoji:'🍲',cat:'Makanan Utama',price:35000,stock:15},
    {name:'Es Jeruk',emoji:'🍊',cat:'Minuman',price:8000,stock:40},
    {name:'Lalapan',emoji:'🥗',cat:'Pembuka',price:10000,stock:30},
    {name:'Es Krim',emoji:'🍨',cat:'Penutup',price:12000,stock:25},
    {name:'Air Mineral',emoji:'💧',cat:'Minuman',price:5000,stock:60},
  ]},
  'Retail/Toko':{categories:['Sembako','Kebutuhan Rumah','Aksesoris','Lainnya'],products:[
    {name:'Beras 5kg',emoji:'🌾',cat:'Sembako',price:65000,stock:20},
    {name:'Minyak Goreng 1L',emoji:'🛢️',cat:'Sembako',price:18000,stock:30},
    {name:'Sabun Mandi',emoji:'🧼',cat:'Kebutuhan Rumah',price:6000,stock:50},
    {name:'Tisu',emoji:'🧻',cat:'Kebutuhan Rumah',price:8000,stock:50},
    {name:'Gula Pasir 1kg',emoji:'🍚',cat:'Sembako',price:15000,stock:30},
    {name:'Air Mineral',emoji:'💧',cat:'Lainnya',price:4000,stock:60},
  ]},
  'Fashion/Clothing':{categories:['Atasan','Bawahan','Outerwear','Aksesoris'],products:[
    {name:'Kaos Polos',emoji:'👕',cat:'Atasan',price:45000,stock:40},
    {name:'Kemeja',emoji:'👔',cat:'Atasan',price:95000,stock:25},
    {name:'Celana Jeans',emoji:'👖',cat:'Bawahan',price:150000,stock:20},
    {name:'Jaket',emoji:'🧥',cat:'Outerwear',price:180000,stock:15},
    {name:'Topi',emoji:'🧢',cat:'Aksesoris',price:35000,stock:30},
    {name:'Tas Selempang',emoji:'👜',cat:'Aksesoris',price:120000,stock:15},
  ]},
  'Distro':{categories:['Kaos','Hoodie','Topi & Aksesoris','Sepatu'],products:[
    {name:'Kaos Distro',emoji:'👕',cat:'Kaos',price:95000,stock:30},
    {name:'Hoodie Oversize',emoji:'🧥',cat:'Hoodie',price:175000,stock:20},
    {name:'Topi Snapback',emoji:'🧢',cat:'Topi & Aksesoris',price:65000,stock:25},
    {name:'Sneakers',emoji:'👟',cat:'Sepatu',price:250000,stock:12},
    {name:'Tote Bag',emoji:'👜',cat:'Topi & Aksesoris',price:55000,stock:20},
    {name:'Kaos Kaki',emoji:'🧦',cat:'Topi & Aksesoris',price:20000,stock:40},
  ]},
  'Elektronik':{categories:['Aksesoris HP','Gadget','Kabel & Charger','Lainnya'],products:[
    {name:'Charger Fast Charging',emoji:'🔌',cat:'Kabel & Charger',price:45000,stock:30},
    {name:'Kabel Data USB-C',emoji:'🔌',cat:'Kabel & Charger',price:25000,stock:40},
    {name:'Power Bank 10000mAh',emoji:'🔋',cat:'Gadget',price:150000,stock:15},
    {name:'Earphone Bluetooth',emoji:'🎧',cat:'Gadget',price:120000,stock:20},
    {name:'Casing HP',emoji:'📱',cat:'Aksesoris HP',price:25000,stock:35},
    {name:'Tempered Glass',emoji:'📱',cat:'Aksesoris HP',price:20000,stock:35},
  ]},
  'Kecantikan':{categories:['Skincare','Makeup','Perawatan Rambut','Lainnya'],products:[
    {name:'Sunscreen SPF50',emoji:'🧴',cat:'Skincare',price:45000,stock:25},
    {name:'Serum Wajah',emoji:'🧴',cat:'Skincare',price:85000,stock:20},
    {name:'Lipstik',emoji:'💄',cat:'Makeup',price:55000,stock:25},
    {name:'Masker Wajah',emoji:'🧖',cat:'Skincare',price:8000,stock:50},
    {name:'Shampoo',emoji:'🧴',cat:'Perawatan Rambut',price:35000,stock:25},
    {name:'Sabun Muka',emoji:'🧴',cat:'Skincare',price:30000,stock:25},
  ]},
  'Otomotif/Bengkel':{categories:['Oli & Cairan','Spare Part','Aksesoris','Jasa'],products:[
    {name:'Oli Mesin 1L',emoji:'🛢️',cat:'Oli & Cairan',price:55000,stock:30},
    {name:'Busi',emoji:'🔧',cat:'Spare Part',price:25000,stock:30},
    {name:'Kampas Rem',emoji:'🔧',cat:'Spare Part',price:85000,stock:15},
    {name:'Lampu LED',emoji:'💡',cat:'Aksesoris',price:35000,stock:25},
    {name:'Helm',emoji:'🪖',cat:'Aksesoris',price:150000,stock:10},
    {name:'Jasa Servis Ringan',emoji:'🔧',cat:'Jasa',price:50000,stock:999},
  ]},
  'Kesehatan/Apotek':{categories:['Obat Bebas','Vitamin','Alat Kesehatan','Lainnya'],products:[
    {name:'Paracetamol',emoji:'💊',cat:'Obat Bebas',price:8000,stock:50},
    {name:'Vitamin C',emoji:'💊',cat:'Vitamin',price:25000,stock:40},
    {name:'Masker Medis',emoji:'😷',cat:'Alat Kesehatan',price:15000,stock:60},
    {name:'Hand Sanitizer',emoji:'🧴',cat:'Alat Kesehatan',price:12000,stock:40},
    {name:'Minyak Kayu Putih',emoji:'🧴',cat:'Obat Bebas',price:18000,stock:30},
    {name:'Plester Luka',emoji:'🩹',cat:'Alat Kesehatan',price:10000,stock:40},
  ]},
  'Jasa/Servis':{categories:['Jasa Reguler','Jasa Express','Tambahan','Lainnya'],products:[
    {name:'Servis Reguler',emoji:'🛠️',cat:'Jasa Reguler',price:50000,stock:999},
    {name:'Servis Express',emoji:'🛠️',cat:'Jasa Express',price:90000,stock:999},
    {name:'Konsultasi',emoji:'🗣️',cat:'Tambahan',price:30000,stock:999},
    {name:'Biaya Tambahan',emoji:'💵',cat:'Tambahan',price:20000,stock:999},
  ]},
  'Laundry':{categories:['Cuci Kering','Cuci Setrika','Setrika Saja','Tambahan'],products:[
    {name:'Cuci Kering /kg',emoji:'🧺',cat:'Cuci Kering',price:7000,stock:999},
    {name:'Cuci Setrika /kg',emoji:'🧺',cat:'Cuci Setrika',price:10000,stock:999},
    {name:'Setrika Saja /kg',emoji:'🧺',cat:'Setrika Saja',price:5000,stock:999},
    {name:'Cuci Sepatu',emoji:'👟',cat:'Tambahan',price:25000,stock:999},
    {name:'Cuci Selimut',emoji:'🛏️',cat:'Tambahan',price:35000,stock:999},
    {name:'Express 1 Hari',emoji:'⚡',cat:'Tambahan',price:5000,stock:999},
  ]},
  'Grosir/Sembako':{categories:['Sembako','Minuman Kemasan','Bumbu Dapur','Lainnya'],products:[
    {name:'Beras 5kg',emoji:'🌾',cat:'Sembako',price:65000,stock:30},
    {name:'Gula Pasir 1kg',emoji:'🍚',cat:'Sembako',price:15000,stock:30},
    {name:'Minyak Goreng 1L',emoji:'🛢️',cat:'Sembako',price:18000,stock:30},
    {name:'Telur 1kg',emoji:'🥚',cat:'Sembako',price:28000,stock:30},
    {name:'Mie Instan (dus)',emoji:'🍜',cat:'Sembako',price:95000,stock:15},
    {name:'Air Mineral Dus',emoji:'💧',cat:'Minuman Kemasan',price:35000,stock:20},
  ]},
  'Lainnya':{categories:['Produk A','Produk B','Lainnya'],products:[
    {name:'Produk Contoh 1',emoji:'📦',cat:'Produk A',price:25000,stock:20},
    {name:'Produk Contoh 2',emoji:'📦',cat:'Produk B',price:35000,stock:20},
  ]},
};
/* Terapkan template kategori+produk sesuai jenis toko.
   mode:'replace' -> dipakai saat onboarding toko baru (kosong).
   mode:'merge'   -> non-destruktif, hanya MENAMBAHKAN kategori &
   produk yang belum ada (nama sama dilewati), aman dipakai kapan
   saja tanpa menghapus/menduplikasi data milik user. */
function applyCategoryTemplate(cat,opts){
  opts=opts||{};
  const tpl=CATEGORY_TEMPLATES[cat]||CATEGORY_TEMPLATES['Lainnya'];
  if(opts.mode==='replace'){
    S.categories=[...tpl.categories];
    S.products=tpl.products.map(p=>({...p,id:uid(),artikel:''}));
  }else{
    tpl.categories.forEach(c=>{if(!S.categories.includes(c))S.categories.push(c);});
    const existingNames=new Set(S.products.map(p=>p.name.trim().toLowerCase()));
    tpl.products.forEach(p=>{
      if(!existingNames.has(p.name.trim().toLowerCase())){
        S.products.push({...p,id:uid(),artikel:''});
      }
    });
  }
  save();
}
function defState(){
  return Store.defState();
}
const PIMAPOS_IS_FIRST_RUN=Store.isFirstRun();
let S=Store.getState();
/* save() dijembatani ke Store (IndexedDB, fallback localStorage).
   Kode lama di seluruh file ini memanggil `S.foo=...;save();` — pola
   itu tetap dipertahankan supaya bisnis logic di bawah tidak perlu
   diubah, hanya persistensinya yang sekarang lewat IndexedDB. */
function save(){
  S=Store.replaceState(S);
  Store.save();
}

let cart=[]; // {id,name,emoji,price,qty}
let selectedCustomer=null; // {id,name,phone,...} | null = guest
let activeCat='Semua';
let selectedPM='Tunai';
let activeSocialTab=SOCIAL_PLATFORMS[0].k;
let qtyPadProduct=null,qtyPadVal=1;
let riwayatPeriod='hari';

/* ════════════════════════════════════════════════════
   NAV / PAGES
════════════════════════════════════════════════════ */
function showPage(id){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
  moveCapsule();
  if(id==='pageProduk')renderProductList();
  if(id==='pageRiwayat')renderRiwayat();
  if(id==='pageLaporan')renderLaporan();
  if(id==='pageProfil'){renderProfil();renderPinToggleUI();renderNotifToggleUI();renderTaxUI();}
  if(id==='pageKasir'){renderCategoryChips();renderProducts();renderShiftBanner();renderKasirCustChip();renderHoldCapsule();}
}
function moveCapsule(){
  const active=document.querySelector('.nav-btn.active');
  const cap=document.getElementById('navCapsule');
  if(!active)return;
  cap.style.left=active.offsetLeft+'px';
  cap.style.width=active.offsetWidth+'px';
}
window.addEventListener('resize',moveCapsule);

/* ════════════════════════════════════════════════════
   NAV ISLAND — TEKAN TAHAN: kapsul aktif "mengembang"
   kenyal seperti balon, lalu kembali ke bentuk semula
   saat dilepas (terinspirasi Dynamic Island).
════════════════════════════════════════════════════ */
function initNavBalloon(){
  const cap=document.getElementById('navCapsule');
  let pressTimer=null;
  const start=()=>{
    clearTimeout(pressTimer);
    pressTimer=setTimeout(()=>{cap.classList.add('balloon');},130);
  };
  const end=()=>{
    clearTimeout(pressTimer);
    cap.classList.remove('balloon');
  };
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.addEventListener('pointerdown',start);
    btn.addEventListener('pointerup',end);
    btn.addEventListener('pointerleave',end);
    btn.addEventListener('pointercancel',end);
  });
}

/* ════════════════════════════════════════════════════
   GENERIC SLIDING CAPSULE (kenyal/smooth) FOR TAB GROUPS
════════════════════════════════════════════════════ */
function moveChipCapsule(containerId,capsuleId,extraClass){
  const container=document.getElementById(containerId);
  if(!container)return;
  let capsule=document.getElementById(capsuleId);
  if(!capsule){
    capsule=document.createElement('div');
    capsule.id=capsuleId;
    capsule.className='chip-capsule'+(extraClass?' '+extraClass:'');
    container.prepend(capsule);
  }
  const active=container.querySelector('.active');
  if(!active){capsule.classList.remove('ready');return;}
  capsule.style.left=active.offsetLeft+'px';
  capsule.style.top=active.offsetTop+'px';
  capsule.style.width=active.offsetWidth+'px';
  capsule.style.height=active.offsetHeight+'px';
  requestAnimationFrame(()=>capsule.classList.add('ready'));
}

/* ════════════════════════════════════════════════════
   RIPPLE
════════════════════════════════════════════════════ */
function initRipples(){
  document.querySelectorAll('.ripple-container').forEach(el=>{
    if(el._rippleInit)return;el._rippleInit=true;
    el.addEventListener('pointerdown',e=>{
      const r=document.createElement('span');r.className='ripple';
      const rect=el.getBoundingClientRect();
      const size=Math.max(rect.width,rect.height);
      r.style.width=r.style.height=size+'px';
      r.style.left=(e.clientX-rect.left-size/2)+'px';
      r.style.top=(e.clientY-rect.top-size/2)+'px';
      el.appendChild(r);setTimeout(()=>r.remove(),600);
    });
  });
}

/* ════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════ */
function toggleAccordion(id){
  const el=document.getElementById(id);
  const body=el.querySelector('.acc-body');
  const isOpen=el.classList.toggle('open');
  body.style.maxHeight=isOpen?body.scrollHeight+'px':'0px';
}
function rp(n){return 'Rp '+Math.round(n||0).toLocaleString('id-ID');}
function prodLetter(name){return (name||'?').trim().charAt(0).toUpperCase()||'?';}
function rpNum(n){return Math.round(n||0).toLocaleString('id-ID');}
function uid(){return 'id'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  clearTimeout(window._tt);window._tt=setTimeout(()=>el.classList.remove('show'),2600);
}
ErrorHandling.setErrorToastHandler(toast);
let _fwTimer=null;
function floatWarn(msg){
  const el=document.getElementById('floatWarnEl');
  el.textContent=msg;
  el.classList.remove('shake');
  el.classList.add('show');
  void el.offsetWidth; // force reflow to retrigger animation
  el.classList.add('shake');
  clearTimeout(_fwTimer);
  _fwTimer=setTimeout(()=>{el.classList.remove('show','shake');},3200);
}
let _holdShrinkTimer=null;
function renderHoldCapsule(){
  const total=S.holds.reduce((s,h)=>s+h.qty,0);
  const cap=document.getElementById('holdFloatCapsule');
  const dot=document.getElementById('holdFloatDot');
  const txt=document.getElementById('holdFloatText');
  clearTimeout(_holdShrinkTimer);
  if(total>0){
    txt.textContent=`📌 ${total} produk ditahan`;
    // Show pill, hide dot
    cap.classList.add('show');
    dot.classList.remove('show');
    // After 5s: pill fades out, dot springs in
    _holdShrinkTimer=setTimeout(()=>{
      cap.classList.remove('show');
      // Slight delay so pill fade starts before dot appears
      setTimeout(()=>dot.classList.add('show'),150);
    },5000);
  }else{
    cap.classList.remove('show');
    dot.classList.remove('show');
  }
}
function expandHoldCapsule(){
  const cap=document.getElementById('holdFloatCapsule');
  const dot=document.getElementById('holdFloatDot');
  clearTimeout(_holdShrinkTimer);
  // Dot shrinks away, pill springs in
  dot.classList.remove('show');
  setTimeout(()=>cap.classList.add('show'),120);
  // Restart shrink timer
  _holdShrinkTimer=setTimeout(()=>{
    cap.classList.remove('show');
    setTimeout(()=>dot.classList.add('show'),150);
  },5000);
}
function handleHoldCapsuleTap(){
  // This is the full pill - navigate directly
  goToHoldSection();
}
function goToHoldSection(){
  showPage('pageLaporan');
  // Scroll ke section hold setelah render selesai
  requestAnimationFrame(()=>{
    const el=document.getElementById('lapHoldList');
    if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
  });
}
function greetTime(){
  const h=new Date().getHours();
  if(h<11)return 'Selamat pagi! Siap melayani pelanggan ☀️';
  if(h<15)return 'Selamat siang! Siap melayani pelanggan';
  if(h<19)return 'Selamat sore! Siap melayani pelanggan';
  return 'Selamat malam! Siap melayani pelanggan 🌙';
}

/* ════════════════════════════════════════════════════
   THEME
════════════════════════════════════════════════════ */
function setTheme(t){
  S.theme=t;save();
  applyThemeUI(t);
}
/* ── Profil modal openers ── */
function openSocialModal(){
  renderSocialTabs();
  ModalManager.openModal('socialModal');
}
function openThemeModal(){
  applyThemeUI(S.theme||'dark');
  ModalManager.openModal('themeModal');
}
function openDataModal(){ModalManager.openModal('dataModal');}
function openInfoModal(){ModalManager.openModal('infoModal');}

function applyThemeUI(t){
  document.body.setAttribute('data-theme',t);
  ['Dark','Light','Graphite'].forEach(n=>{
    const opt=document.getElementById('themeOpt'+n);
    if(opt)opt.classList.toggle('active',t===n.toLowerCase());
    const chk=document.getElementById('chk'+n);
    if(chk)chk.style.opacity=t===n.toLowerCase()?'1':'0';
  });
}
function initTheme(){
  if(S.theme==='luxury'){S.theme='light';save();} // migrasi tema lama
  applyThemeUI(S.theme||'dark');
}

/* ════════════════════════════════════════════════════
   KASIR — PRODUCT GRID
════════════════════════════════════════════════════ */
function renderCategoryChips(){
  const wrap=document.getElementById('catScroll');
  const cats=['Semua',...S.categories];
  wrap.innerHTML=cats.map(c=>`<div class="cat-chip ${c===activeCat?'active':''}" data-cat="${c.replace(/"/g,'&quot;')}" onclick="setActiveCat('${c.replace(/'/g,"\\'")}')">${c}</div>`).join('');
  moveChipCapsule('catScroll','catCapsule');
}
function setActiveCat(c){
  activeCat=c;
  document.querySelectorAll('#catScroll .cat-chip').forEach(el=>el.classList.toggle('active',el.dataset.cat===c));
  moveChipCapsule('catScroll','catCapsule');
  renderProducts();
}

function renderProducts(){
  const q=(document.getElementById('prodSearch').value||'').toLowerCase();
  let list=S.products.filter(p=>(activeCat==='Semua'||p.cat===activeCat)&&p.name.toLowerCase().includes(q));
  const grid=document.getElementById('prodGrid');
  document.getElementById('prodEmpty').style.display=S.products.length===0?'flex':'none';
  grid.innerHTML=list.map(p=>{
    const inCart=cart.find(c=>c.id===p.id);
    const qty=inCart?inCart.qty:0;
    const held=holdQtyFor(p.id);
    const avail=availableStock(p);
    const out=avail<=0;
    const unitTxt=p.unit&&p.unit!=='pcs'?' '+p.unit:'';
    return `<div class="prod-stack"><div class="prod-card ripple-container ${out?'out':''}" onclick="quickAdd('${p.id}')">
      ${qty>0?`<div class="prod-badge">${qty}</div>`:''}
      <div class="prod-emoji">${prodLetter(p.name)}</div>
      <div class="prod-name">${esc(p.name)}${p.variant?' <span style="opacity:.55;font-weight:500">('+esc(p.variant)+')</span>':''}</div>
      <div class="prod-price">${rp(p.price)}</div>
      <div class="prod-stock">${out&&held>0?'📌 Semua ditahan':out?'Stok habis':'Stok: '+avail+unitTxt}${held>0&&!out?' <span style="color:var(--amber)">· '+held+' ditahan</span>':''}</div>
    </div></div>`;
  }).join('');
  initRipples();
}
function quickAdd(id){
  const p=S.products.find(x=>x.id===id);if(!p)return;
  const avail=availableStock(p);
  if(avail<=0){toast(holdQtyFor(id)>0?'⚠️ Stok sedang ditahan/booking':'⚠️ Stok habis');return;}
  if(!S.activeShift){toast('⚠️ Mulai shift (BOD) dulu sebelum jualan');openBodModal();return;}
  const existing=cart.find(c=>c.id===id);
  const curQty=existing?existing.qty:0;
  if(curQty+1>avail){toast('⚠️ Stok tidak cukup (sebagian sedang ditahan)');return;}
  if(existing)existing.qty++;
  else cart.push({id:p.id,name:p.name,emoji:p.emoji,price:p.price,qty:1,variant:p.variant||''});
  updateCartBar();renderProducts();
}

/* ════════════════════════════════════════════════════
   CART BAR + MODAL
════════════════════════════════════════════════════ */
function cartTotalAmt(){return cart.reduce((s,c)=>s+c.price*c.qty,0);}
function getTaxConfig(){return S.tax||{enabled:false,pct:0,label:'PPN'};}
function calcTax(baseAmt){
  const t=getTaxConfig();
  if(!t.enabled||!t.pct)return 0;
  return Math.round(baseAmt*t.pct/100);
}
function calcCartTotals(){
  const sub=cartTotalAmt();
  const disk=Math.min(Number(document.getElementById('cartDiskon')?.value||0),sub);
  const taxBase=sub-disk;
  const tax=calcTax(taxBase);
  return {sub,disk,tax,total:taxBase+tax};
}
function updateCartBar(){
  const count=cart.reduce((s,c)=>s+c.qty,0);
  document.getElementById('cartBar').classList.toggle('show',count>0);
  document.getElementById('cartBarCount').textContent=count;
  document.getElementById('cartBarAmt').textContent=rp(cartTotalAmt());
}
function openCartModal(){renderCartModal();ModalManager.openModal('cartModal');}
function closeCartModal(){ModalManager.closeModal('cartModal');}
function renderCartModal(){
  const wrap=document.getElementById('cartItemsWrap');
  const hasItems=cart.length>0;
  document.getElementById('cartEmptyMsg').style.display=hasItems?'none':'flex';
  document.getElementById('cartSummaryWrap').style.display=hasItems?'block':'none';
  wrap.innerHTML=cart.map(c=>`
    <div class="cart-item">
      <div class="ci-emoji">${prodLetter(c.name)}</div>
      <div class="ci-info">
        <div class="ci-name">${esc(c.name)}${c.variant?' <span style="opacity:.6;font-weight:500">('+esc(c.variant)+')</span>':''}</div>
        <div class="ci-price">${rp(c.price)}</div>
      </div>
      <div class="ci-qty">
        <button class="qty-btn" onclick="cartQtyChange('${c.id}',-1)">−</button>
        <div class="qty-num">${c.qty}</div>
        <button class="qty-btn" onclick="cartQtyChange('${c.id}',1)">+</button>
      </div>
      <div class="ci-sub">${rp(c.price*c.qty)}</div>
    </div>`).join('');
  const {sub,disk,tax,total}=calcCartTotals();
  const taxCfg=getTaxConfig();
  document.getElementById('cartSubtotal').textContent=rp(sub);
  document.getElementById('cartDiskonVal').textContent='-'+rp(disk);
  document.getElementById('cartTaxRow').style.display=tax>0?'flex':'none';
  if(tax>0){
    document.getElementById('cartTaxLbl').textContent=`${taxCfg.label||'Pajak'} (${taxCfg.pct}%)`;
    document.getElementById('cartTaxVal').textContent=rp(tax);
  }
  document.getElementById('cartTotal').textContent=rp(total);
  renderCustCartRow();
  initRipples();
}
function cartQtyChange(id,d){
  const item=cart.find(c=>c.id===id);if(!item)return;
  const prod=S.products.find(p=>p.id===id);
  const newQty=item.qty+d;
  if(newQty<=0){cart=cart.filter(c=>c.id!==id);}
  else if(prod&&newQty>availableStock(prod)){toast('⚠️ Stok tidak cukup (sebagian sedang ditahan)');return;}
  else item.qty=newQty;
  updateCartBar();renderCartModal();renderProducts();
}

/* ════════════════════════════════════════════════════
   MEMBER / PELANGGAN
   - Input lengkap hanya di transaksi pertama (nama+HP).
   - Transaksi berikutnya cukup cari No. HP -> otomatis
     terdeteksi sebagai member lama (repeat order).
   - Tier & saran diskon dihitung otomatis dari akumulasi
     total belanja (lihat CUSTOMER_TIERS).
════════════════════════════════════════════════════ */
function tierBadgeHTML(spend){
  const t=getTier(spend);
  return `<span class="tier-badge tier-${t.key}">${t.icon} ${t.label}</span>`;
}
function renderCustCartRow(){
  const wrap=document.getElementById('cartCustRow');
  if(!wrap)return;
  if(selectedCustomer){
    const t=getTier(selectedCustomer.totalSpend);
    wrap.innerHTML=`
      <div class="cust-selected-chip ripple-container" onclick="openCustomerModal()">
        <div class="cust-row-av" style="width:32px;height:32px;font-size:12px">${(selectedCustomer.name||'?').charAt(0).toUpperCase()}</div>
        <div class="cust-row-info">
          <div class="cust-row-name">${selectedCustomer.name} ${tierBadgeHTML(selectedCustomer.totalSpend)}</div>
          <div class="cust-row-sub">${selectedCustomer.phone||''} · Ganti pelanggan</div>
        </div>
      </div>`;
  }else{
    wrap.innerHTML=`
      <div class="da-row-flat ripple-container" onclick="openCustomerModal()" style="margin-bottom:4px">
        <div class="da-ico">👤</div>
        <div class="da-lbl">Tambah Pelanggan (opsional)</div>
        <div class="da-chev">›</div>
      </div>`;
  }
  renderKasirCustChip();
  initRipples();
}
function renderKasirCustChip(){
  const wrap=document.getElementById('kasirCustChip');
  if(!wrap)return;
  if(selectedCustomer){
    const t=getTier(selectedCustomer.totalSpend);
    wrap.innerHTML=`
      <div class="cust-selected-chip ripple-container" onclick="openCustomerModal()" style="margin-bottom:14px">
        <div class="cust-row-av" style="width:30px;height:30px;font-size:11px">${selectedCustomer.name.charAt(0).toUpperCase()}</div>
        <div class="cust-row-info">
          <div class="cust-row-name">${selectedCustomer.name} ${tierBadgeHTML(selectedCustomer.totalSpend)}</div>
          <div class="cust-row-sub">Pelanggan untuk transaksi ini · Ganti</div>
        </div>
      </div>`;
  }else{
    wrap.innerHTML='';
  }
  initRipples();
}
function openCustomerModal(){
  document.getElementById('custSearchInput').value='';
  renderCustomerList();
  ModalManager.openModal('customerModal');
}
function closeCustomerModal(){ModalManager.closeModal('customerModal');}
function renderCustomerList(){
  const q=(document.getElementById('custSearchInput').value||'').trim().toLowerCase();
  const qDigits=normalizePhone(q);
  let list=[...S.customers].sort((a,b)=>(b.totalSpend||0)-(a.totalSpend||0));
  if(q){
    list=list.filter(c=>c.name.toLowerCase().includes(q)||(qDigits&&normalizePhone(c.phone).includes(qDigits)));
  }
  const quickAddWrap=document.getElementById('custQuickAddRow');
  const exactPhoneMatch=qDigits&&findCustomerByPhone(qDigits);
  if(q&&!exactPhoneMatch){
    quickAddWrap.innerHTML=`
      <div class="da-row-flat ripple-container" onclick="openCustomerFormModal(null,'${q.replace(/'/g,"\\'")}')" style="margin-bottom:10px">
        <div class="da-ico">➕</div>
        <div class="da-lbl">Tambah "${esc(q)}" sebagai Pelanggan Baru</div>
        <div class="da-chev">›</div>
      </div>`;
  }else{
    quickAddWrap.innerHTML='';
  }
  const wrap=document.getElementById('custListWrap');
  if(!list.length){
    wrap.innerHTML=q?'':'<div class="empty-state" style="padding:16px"><div class="empty-desc">Belum ada pelanggan tersimpan. Tambahkan saat transaksi pertama.</div></div>';
  }else{
    wrap.innerHTML=list.map(c=>{
      const t=getTier(c.totalSpend);
      return `<div class="cust-row" onclick="selectCustomer('${c.id}')">
        <div class="cust-row-av">${(c.name||'?').charAt(0).toUpperCase()}</div>
        <div class="cust-row-info">
          <div class="cust-row-name">${esc(c.name)} ${tierBadgeHTML(c.totalSpend)}</div>
          <div class="cust-row-sub">${esc(c.phone||'-')} · ${c.totalTrx||0}x transaksi · ${rp(c.totalSpend||0)}</div>
        </div>
        <div class="da-chev" style="cursor:pointer" onclick="event.stopPropagation();openCustomerFormModal('${c.id}')">✏️</div>
      </div>`;
    }).join('');
  }
  initRipples();
}
function selectCustomer(id){
  const c=S.customers.find(x=>x.id===id);
  if(!c)return;
  selectedCustomer=c;
  closeCustomerModal();
  renderCustCartRow();
  toast('👤 '+c.name+' dipilih sebagai pelanggan');
}
function useGuestCustomer(){
  selectedCustomer=null;
  closeCustomerModal();
  renderCustCartRow();
}
function openCustomerFormModal(id,prefillName){
  document.getElementById('custEditId').value=id||'';
  document.getElementById('custDelBtn').style.display=id?'block':'none';
  document.getElementById('custTierInfo').innerHTML='';
  if(id){
    const c=S.customers.find(x=>x.id===id);if(!c)return;
    document.getElementById('custFormTitle').textContent='✏️ Edit Pelanggan';
    document.getElementById('custName').value=c.name;
    document.getElementById('custPhone').value=c.phone;
    document.getElementById('custNote').value=c.note||'';
    const t=getTier(c.totalSpend);
    const next=nextTierInfo(c.totalSpend);
    document.getElementById('custTierInfo').innerHTML=`
      <div class="cust-suggest">
        ${t.icon} Tier saat ini: <b>${t.label}</b> · Total belanja ${rp(c.totalSpend||0)} (${c.totalTrx||0}x transaksi)<br>
        ${t.discount>0?'💡 Saran reward: diskon '+t.discount+'% untuk member '+t.label+'.':'Belum ada reward — kumpulkan riwayat belanja untuk naik tier.'}
        ${next?'<br>📈 Kurang '+rp(next.remaining)+' lagi menuju '+next.tier.icon+' '+next.tier.label+'.':''}
      </div>`;
  }else{
    document.getElementById('custFormTitle').textContent='➕ Pelanggan Baru';
    document.getElementById('custName').value=/^[0-9+]+$/.test(prefillName||'')?'':(prefillName||'');
    document.getElementById('custPhone').value=/^[0-9+]+$/.test(prefillName||'')?(prefillName||''):'';
    document.getElementById('custNote').value='';
  }
  ModalManager.openModal('customerFormModal');
}
function closeCustomerFormModal(){ModalManager.closeModal('customerFormModal');}
function saveCustomer(){
  const name=document.getElementById('custName').value.trim();
  const phone=document.getElementById('custPhone').value.trim();
  const note=document.getElementById('custNote').value.trim();
  if(!name){toast('⚠️ Nama pelanggan wajib diisi');return;}
  if(!phone){toast('⚠️ No. HP wajib diisi (untuk deteksi member berikutnya)');return;}
  const id=document.getElementById('custEditId').value;
  const dup=findCustomerByPhone(phone);
  if(dup&&dup.id!==id){toast('⚠️ No. HP sudah terdaftar atas nama '+dup.name);return;}
  if(id){
    const c=S.customers.find(x=>x.id===id);
    Object.assign(c,{name,phone,note});
    selectedCustomer=selectedCustomer&&selectedCustomer.id===id?c:selectedCustomer;
  }else{
    const c={id:uid(),name,phone,note,totalSpend:0,totalTrx:0,createdAt:new Date().toISOString(),lastTrxAt:null};
    S.customers.push(c);
    selectedCustomer=c;
  }
  save();
  closeCustomerFormModal();closeCustomerModal();
  renderCustCartRow();
  if(document.getElementById('pageLaporan').classList.contains('active'))renderLaporan();
  toast('✅ Data pelanggan disimpan');
}
function deleteCustomer(){
  const id=document.getElementById('custEditId').value;if(!id)return;
  appConfirm('Hapus data pelanggan ini? Riwayat transaksi yang sudah ada TIDAK ikut terhapus.',()=>{
    S.customers=S.customers.filter(c=>c.id!==id);
    if(selectedCustomer&&selectedCustomer.id===id)selectedCustomer=null;
    save();
    closeCustomerFormModal();
    closeCustomerModal();
    renderCustCartRow();
    if(document.getElementById('pageLaporan').classList.contains('active'))renderLaporan();
    toast('🗑️ Pelanggan dihapus');
  },'🗑️ Hapus Pelanggan');
}
function renderPayCustInfo(){
  const wrap=document.getElementById('payCustInfo');
  if(!wrap)return;
  if(!selectedCustomer){wrap.innerHTML='';return;}
  const t=getTier(selectedCustomer.totalSpend);
  wrap.innerHTML=`
    <div class="cust-selected-chip" style="cursor:default;margin-bottom:14px">
      <div class="cust-row-av" style="width:32px;height:32px;font-size:12px">${selectedCustomer.name.charAt(0).toUpperCase()}</div>
      <div class="cust-row-info">
        <div class="cust-row-name">${selectedCustomer.name} ${tierBadgeHTML(selectedCustomer.totalSpend)}</div>
        <div class="cust-row-sub">${selectedCustomer.totalTrx||0}x transaksi sebelumnya</div>
      </div>
    </div>
    ${t.discount>0?`<div class="cust-suggest">💡 Member ${t.label} — saran diskon <b>${t.discount}%</b> dari subtotal. <span style="color:var(--amber);font-weight:700;cursor:pointer" onclick="applySuggestedDiscount(${t.discount})">Terapkan →</span></div>`:''}`;
}
function applySuggestedDiscount(pct){
  const sub=cartTotalAmt();
  const disk=Math.round(sub*pct/100);
  document.getElementById('cartDiskon').value=disk;
  const {total}=calcCartTotals();
  document.getElementById('payTotalLbl').textContent=rp(total);
  toast('✅ Diskon '+pct+'% diterapkan');
}

/* ════════════════════════════════════════════════════
   HOLD / BOOKING PRODUK — form & pengelolaan
════════════════════════════════════════════════════ */
function openHoldPickModal(){
  if(cart.length===0){
    floatWarn('⚠️ Tambahkan produk ke keranjang dulu sebelum ditahan');
    return;
  }
  // Pre-fill form dengan nama/no HP pelanggan yang sudah dipilih jika ada
  document.getElementById('holdProductId').value='__CART__'; // flag = hold from cart
  document.getElementById('holdQty').value=1;
  document.getElementById('holdExpiry').value='';
  document.getElementById('holdCustName').value=selectedCustomer?selectedCustomer.name:'';
  document.getElementById('holdCustPhone').value=selectedCustomer?selectedCustomer.phone:'';
  document.getElementById('holdNote').value='';
  // Show cart item summary in preview
  const items=cart.map(c=>`${prodLetter(c.name)} ${c.name} ×${c.qty}`).join(', ');
  document.getElementById('holdProdPreview').innerHTML=`
    <div class="cust-row-av" style="background:rgba(251,191,36,.14);color:var(--amber);font-size:18px">📌</div>
    <div class="cust-row-info">
      <div class="cust-row-name">Tahan semua item di keranjang</div>
      <div class="cust-row-sub" style="white-space:normal">${items}</div>
    </div>`;
  ModalManager.openModal('holdFormModal');
}
function renderHoldPickList(){
  const q=(document.getElementById('holdPickSearch').value||'').toLowerCase();
  const list=S.products.filter(p=>p.name.toLowerCase().includes(q));
  const wrap=document.getElementById('holdPickListWrap');
  if(!list.length){
    wrap.innerHTML='<div class="empty-state" style="padding:16px"><div class="empty-desc">Produk tidak ditemukan.</div></div>';
    return;
  }
  wrap.innerHTML=list.map(p=>{
    const avail=availableStock(p);
    const held=holdQtyFor(p.id);
    return `<div class="cust-row ${avail<=0?'' :''}" onclick="${avail<=0?'':`selectProductForHold('${p.id}')`}" style="${avail<=0?'opacity:.45;cursor:default':''}">
      <div class="cust-row-av" style="background:rgba(251,191,36,.14);color:var(--amber)">${prodLetter(p.name)}</div>
      <div class="cust-row-info">
        <div class="cust-row-name">${p.name}${p.variant?' ('+p.variant+')':''}</div>
        <div class="cust-row-sub">Tersedia: ${avail}${held>0?' · '+held+' sudah ditahan':''}</div>
      </div>
    </div>`;
  }).join('');
  initRipples();
}
function selectProductForHold(productId){
  closeHoldPickModal();
  openHoldFormModal(productId);
}
function openHoldFormModal(productId){
  const p=S.products.find(x=>x.id===productId);if(!p)return;
  const avail=availableStock(p);
  if(avail<=0){toast('⚠️ Stok produk ini sudah habis/semua sedang ditahan');return;}
  document.getElementById('holdProductId').value=productId;
  document.getElementById('holdProdPreview').innerHTML=`
    <div class="cust-row-av" style="background:rgba(251,191,36,.14);color:var(--amber)">${prodLetter(p.name)}</div>
    <div class="cust-row-info">
      <div class="cust-row-name">${p.name}${p.variant?' ('+p.variant+')':''}</div>
      <div class="cust-row-sub">Tersedia untuk ditahan: ${avail}${p.unit&&p.unit!=='pcs'?' '+p.unit:''}</div>
    </div>`;
  document.getElementById('holdQty').value=1;
  document.getElementById('holdQty').max=avail;
  document.getElementById('holdExpiry').value='';
  document.getElementById('holdCustName').value='';
  document.getElementById('holdCustPhone').value='';
  document.getElementById('holdNote').value='';
  ModalManager.openModal('holdFormModal');
}
function closeHoldFormModal(){ModalManager.closeModal('holdFormModal');}
function saveHold(){
  const productId=document.getElementById('holdProductId').value;
  const custName=document.getElementById('holdCustName').value.trim();
  if(!custName){floatWarn('⚠️ Nama pemesan wajib diisi');return;}
  const custPhone=document.getElementById('holdCustPhone').value.trim();
  const note=document.getElementById('holdNote').value.trim();
  const expiry=document.getElementById('holdExpiry').value||'';

  if(productId==='__CART__'){
    // Hold semua item keranjang sekaligus
    const items=cart.map(c=>({id:c.id,name:c.name+(c.variant?' ('+c.variant+')':''),qty:c.qty}));
    items.forEach(it=>{
      S.holds.push({id:uid(),productId:it.id,productName:it.name,qty:it.qty,custName,custPhone,note,expiry,createdAt:new Date().toISOString()});
    });
    // Kosongkan keranjang setelah ditahan
    cart=[];document.getElementById('cartDiskon').value='';
    save();closeHoldFormModal();closeCartModal();
    updateCartBar();renderProducts();renderHoldCapsule();
    if(document.getElementById('pageLaporan').classList.contains('active'))renderLaporan();
    toast(`📌 ${items.length} item ditahan untuk ${custName}`);
    return;
  }

  // Mode normal: tahan satu produk tertentu
  const p=S.products.find(x=>x.id===productId);if(!p)return;
  const qty=Math.max(1,Number(document.getElementById('holdQty').value||1));
  const avail=availableStock(p);
  if(qty>avail){floatWarn('⚠️ Jumlah melebihi stok yang tersedia ('+avail+')');return;}
  S.holds.push({id:uid(),productId,productName:p.name+(p.variant?' ('+p.variant+')':''),qty,custName,custPhone,note,expiry,createdAt:new Date().toISOString()});
  save();closeHoldFormModal();renderProducts();renderHoldCapsule();
  if(document.getElementById('pageLaporan').classList.contains('active'))renderLaporan();
  toast('📌 Produk berhasil ditahan untuk '+custName);
}
function releaseHold(id){
  appConfirm('Batalkan booking ini? Stok akan kembali tersedia untuk dijual bebas.',()=>{
    S.holds=S.holds.filter(h=>h.id!==id);save();
    renderProducts();renderHoldCapsule();renderLaporan();
    toast('✅ Booking dibatalkan, stok tersedia kembali');
  },'Batalkan Booking');
}
function convertHoldToSale(id){
  const h=S.holds.find(x=>x.id===id);if(!h)return;
  const p=S.products.find(x=>x.id===h.productId);
  if(!p){toast('⚠️ Produk sudah tidak ada');return;}
  S.holds=S.holds.filter(x=>x.id!==id);save();
  if(h.custPhone){
    const c=findCustomerByPhone(h.custPhone);
    if(c)selectedCustomer=c;
  }
  const existing=cart.find(c=>c.id===p.id);
  if(existing)existing.qty+=h.qty;
  else cart.push({id:p.id,name:p.name,emoji:p.emoji,price:p.price,qty:h.qty,variant:p.variant||''});
  updateCartBar();renderProducts();renderHoldCapsule();renderLaporan();
  showPage('pageKasir');
  toast('🛒 Booking "'+h.custName+'" dipindahkan ke keranjang');
  openCartModal();
}
function renderHoldList(){
  const wrap=document.getElementById('lapHoldList');
  if(!wrap)return;
  if(!S.holds.length){
    wrap.innerHTML='<div class="empty-state" style="padding:16px"><div class="empty-desc">Belum ada produk yang ditahan/booking. Ketuk ikon 📌 di kartu produk untuk menahan stok buat pelanggan.</div></div>';
    return;
  }
  wrap.innerHTML=S.holds.slice().reverse().map(h=>`
    <div class="cust-row" style="cursor:default;align-items:flex-start;flex-wrap:wrap">
      <div class="cust-row-av" style="background:rgba(251,191,36,.14);color:var(--amber)">📌</div>
      <div class="cust-row-info">
        <div class="cust-row-name">${esc(h.productName)} <span class="tier-badge" style="background:rgba(251,191,36,.16);color:var(--amber)">x${h.qty}</span></div>
        <div class="cust-row-sub">${esc(h.custName)}${h.custPhone?' · '+esc(h.custPhone):''}${h.expiry?' · s/d '+esc(h.expiry):''}${h.note?' · '+esc(h.note):''}</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <span class="ripple-container" style="font-size:11px;font-weight:700;color:var(--green);cursor:pointer" onclick="convertHoldToSale('${h.id}')">🛒 Jual Sekarang</span>
          <span class="ripple-container" style="font-size:11px;font-weight:700;color:var(--red);cursor:pointer" onclick="releaseHold('${h.id}')">✕ Batalkan</span>
        </div>
      </div>
    </div>`).join('');
  initRipples();
}

/* QTY PAD modal (long-press alt entry, also usable for precise qty) */
function quickAddWithQty(id){
  if(!S.activeShift){toast('⚠️ Mulai shift (BOD) dulu sebelum jualan');openBodModal();return;}
  qtyPadProduct=S.products.find(p=>p.id===id);if(!qtyPadProduct)return;
  qtyPadVal=1;
  document.getElementById('qtyModalName').textContent=qtyPadProduct.name;
  document.getElementById('qtyPadNum').textContent=qtyPadVal;
  ModalManager.openModal('qtyModal');
}
function qtyPadChange(d){qtyPadVal=Math.max(1,qtyPadVal+d);document.getElementById('qtyPadNum').textContent=qtyPadVal;}
function qtyPadConfirm(){
  const p=qtyPadProduct;if(!p)return;
  const existing=cart.find(c=>c.id===p.id);
  const curQty=existing?existing.qty:0;
  if(curQty+qtyPadVal>availableStock(p)){toast('⚠️ Stok tidak cukup (sebagian sedang ditahan)');return;}
  if(existing)existing.qty+=qtyPadVal;
  else cart.push({id:p.id,name:p.name,emoji:p.emoji,price:p.price,qty:qtyPadVal,variant:p.variant||''});
  closeQtyModal();updateCartBar();renderProducts();
}
function closeQtyModal(){ModalManager.closeModal('qtyModal');}

/* ════════════════════════════════════════════════════
   PAYMENT
════════════════════════════════════════════════════ */
function openPaymentModal(){
  closeCartModal();
  selectedPM='Tunai';
  document.querySelectorAll('.pm-opt').forEach(o=>o.classList.toggle('active',o.dataset.pm==='Tunai'));
  document.getElementById('cashFieldWrap').style.display='block';
  document.getElementById('changeRow').style.display='none';
  document.getElementById('cashReceived').value='';
  document.getElementById('payNote').value='';
  const {total}=calcCartTotals();
  document.getElementById('payTotalLbl').textContent=rp(total);
  renderCashPresets(total);
  renderPayCustInfo();
  ModalManager.openModal('payModal');
  requestAnimationFrame(()=>requestAnimationFrame(()=>moveChipCapsule('payMethodGrid','pmCapsule','rmd')));
}
function renderCashPresets(total){
  const wrap=document.getElementById('cashPresets');
  if(!wrap||!total)return;
  const opts=[{label:'Uang Pas',val:total}];
  const added=new Set([total]);
  [10000,20000,50000,100000].forEach(r=>{
    const v=Math.ceil(total/r)*r;
    if(v>total&&!added.has(v)){opts.push({label:rp(v),val:v});added.add(v);}
  });
  wrap.innerHTML=opts.slice(0,4).map(o=>
    `<div class="cash-preset-chip ripple-container" onclick="setCashPreset(${o.val})">${o.label}</div>`).join('');
  initRipples();
}
function setCashPreset(val){
  document.getElementById('cashReceived').value=val;
  calcChange();
}
function closePaymentModal(){ModalManager.closeModal('payModal');}
function selectPM(el){
  selectedPM=el.dataset.pm;
  document.querySelectorAll('.pm-opt').forEach(o=>o.classList.remove('active'));
  el.classList.add('active');
  moveChipCapsule('payMethodGrid','pmCapsule','rmd');
  document.getElementById('cashFieldWrap').style.display=selectedPM==='Tunai'?'block':'none';
  document.getElementById('changeRow').style.display='none';
}
function calcChange(){
  const {total}=calcCartTotals();
  const cash=Number(document.getElementById('cashReceived').value||0);
  const change=cash-total;
  document.getElementById('changeRow').style.display=cash>0?'flex':'none';
  document.getElementById('changeVal').textContent=rp(Math.max(change,0));
  document.getElementById('changeVal').style.color=change<0?'var(--red)':'var(--green)';
}
function completeTransaction(){
  if(cart.length===0){toast('Keranjang kosong');return;}
  if(!S.activeShift){toast('⚠️ Buka shift (BOD) terlebih dahulu');closePaymentModal();showPage('pageKasir');openBodModal();return;}
  const {sub,disk,tax,total}=calcCartTotals();
  const taxCfg=getTaxConfig();
  const cash=Number(document.getElementById('cashReceived').value||0);
  if(selectedPM==='Tunai'&&cash<total){toast('⚠️ Uang diterima kurang dari total');return;}
  // deduct stock
  cart.forEach(c=>{
    const p=S.products.find(x=>x.id===c.id);
    if(p)p.stock=Math.max(0,p.stock-c.qty);
  });
  const trx={
    id:uid(),ts:new Date().toISOString(),
    items:cart.map(c=>({id:c.id,name:c.name,emoji:c.emoji,price:c.price,qty:c.qty,variant:c.variant||''})),
    subtotal:sub,diskon:disk,tax,taxLabel:tax>0?taxCfg.label:'',taxPct:tax>0?taxCfg.pct:0,total,
    method:selectedPM,cash:selectedPM==='Tunai'?cash:total,
    change:selectedPM==='Tunai'?Math.max(cash-total,0):0,
    note:document.getElementById('payNote').value||'',
    shiftId:S.activeShift.id,
    customerId:selectedCustomer?selectedCustomer.id:null,
    customerName:selectedCustomer?selectedCustomer.name:'',
    customerPhone:selectedCustomer?selectedCustomer.phone:'',
  };
  S.transactions.unshift(trx);
  if(selectedCustomer){
    const c=S.customers.find(x=>x.id===selectedCustomer.id);
    if(c){
      c.totalSpend=(c.totalSpend||0)+total;
      c.totalTrx=(c.totalTrx||0)+1;
      c.lastTrxAt=trx.ts;
    }
  }
  save();
  showReceipt(trx);
  cart=[];document.getElementById('cartDiskon').value='';
  updateCartBar();
  closePaymentModal();
  selectedCustomer=null;
}
let lastReceiptTrx=null;
function filledSocials(){
  return SOCIAL_PLATFORMS.map(p=>({...p,val:(S.socials||{})[p.k],url:socialUrlForStored(p.k,(S.socials||{})[p.k])})).filter(s=>s.val);
}
function socialUrlForStored(key,val){
  if(!val)return '';
  if(key==='whatsapp'){
    const num=val.replace(/[^0-9]/g,'');
    return num?`https://wa.me/${num}`:'';
  }
  if(/^https?:\/\//i.test(val))return val;
  const baseMap={instagram:'https://instagram.com/',tiktok:'https://tiktok.com/@',facebook:'https://facebook.com/',shopee:'https://shopee.co.id/',tokopedia:'https://tokopedia.com/',website:'https://'};
  const handle=val.replace(/^@/,'');
  return (baseMap[key]||'')+handle;
}
function receiptQrUrl(data,size){
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=6&data=${encodeURIComponent(data)}`;
}
function showReceiptById(id){
  const trx=S.transactions.find(t=>t.id===id);
  if(!trx){toast('⚠️ Transaksi tidak ditemukan');return;}
  showReceipt(trx);
}
function showReceipt(trx){
  lastReceiptTrx=trx;
  const lines=[];
  lines.push(`<div class="receipt-center" style="font-weight:700;font-size:13.5px;letter-spacing:.02em">${esc(S.storeName||'Toko Saya')}</div>`);
  if(S.storeCategory)lines.push(`<div class="receipt-center" style="opacity:.7">${esc(S.storeCategory)}</div>`);
  if(S.storeAddr)lines.push(`<div class="receipt-center">${esc(S.storeAddr)}</div>`);
  lines.push(`<div class="receipt-center">${new Date(trx.ts).toLocaleString('id-ID')}</div>`);
  lines.push(`<div class="receipt-center" style="opacity:.6">No. Struk: ${trx.id.toUpperCase()}</div>`);
  if(trx.customerName){
    lines.push(`<div class="receipt-center" style="margin-top:2px">Pelanggan: ${esc(trx.customerName)}</div>`);
    if(trx.customerPhone)lines.push(`<div class="receipt-center" style="opacity:.7">No. HP: ${esc(trx.customerPhone)}</div>`);
  }
  lines.push('<hr>');
  trx.items.forEach(it=>{
    lines.push(`<div class="receipt-item-name">${esc(it.name)}${it.variant?' ('+esc(it.variant)+')':''}</div>`);
    lines.push(`<div class="receipt-item-sub"><span>${it.qty} x ${rpNum(it.price)}</span><span>${rpNum(it.price*it.qty)}</span></div>`);
  });
  lines.push('<hr>');
  lines.push(`<div class="rline"><span>Subtotal</span><span>${rpNum(trx.subtotal)}</span></div>`);
  if(trx.diskon>0)lines.push(`<div class="rline"><span>Diskon</span><span>-${rpNum(trx.diskon)}</span></div>`);
  if(trx.tax>0)lines.push(`<div class="rline"><span>${trx.taxLabel||'Pajak'} (${trx.taxPct}%)</span><span>${rpNum(trx.tax)}</span></div>`);
  lines.push(`<div class="rline" style="font-weight:700;font-size:13px;margin-top:2px"><span>TOTAL</span><span>${rpNum(trx.total)}</span></div>`);
  lines.push(`<div class="rline"><span>${trx.method}</span><span>${trx.method==='Tunai'?rpNum(trx.cash):''}</span></div>`);
  if(trx.method==='Tunai')lines.push(`<div class="rline"><span>Kembali</span><span>${rpNum(trx.change)}</span></div>`);
  if(trx.note)lines.push(`<div style="margin-top:6px">Catatan: ${esc(trx.note)}</div>`);
  lines.push('<hr>');
  lines.push('<div class="receipt-center">Terima kasih atas kunjungan Anda 🙏</div>');
  const socs=filledSocials().slice(0,3);
  if(socs.length){
    lines.push('<div class="receipt-sub2">Hubungi & Ikuti Kami</div>');
    socs.forEach(s=>{
      lines.push(`<div class="receipt-center" style="font-size:10.5px;padding:2px 0">${s.val}</div>`);
    });
    const primary=socs[0];
    if(primary.url){
      lines.push(`<div class="receipt-qr-wrap">
        <img src="${receiptQrUrl(primary.url,150)}" alt="QR" style="width:84px;height:84px" onerror="this.parentElement.style.display='none'">
        <div style="font-size:8.5px;letter-spacing:.1em;color:#333;margin-top:4px">SCAN ${primary.l.toUpperCase()}</div>
      </div>`);
    }
  }
  lines.push(`<div class="receipt-center" style="margin-top:10px;font-size:9px;opacity:.55">${esc(S.storeName||'Toko Saya')}</div>`);
  document.getElementById('receiptBox').innerHTML=lines.join('');
  document.getElementById('receiptModalTitle').textContent=trx.voided?'🚫 Transaksi Dibatalkan':'✅ Transaksi Berhasil';
  document.getElementById('voidStatusNotice').innerHTML=trx.voided?`<div class="void-notice">🚫 Transaksi ini sudah dibatalkan${trx.voidedAt?' pada '+new Date(trx.voidedAt).toLocaleString('id-ID'):''}. Stok telah dikembalikan.</div>`:'';
  document.getElementById('voidTrxBtn').style.display=trx.voided?'none':'block';
  ModalManager.openModal('receiptModal');
}
function voidTransaction(){
  if(!lastReceiptTrx)return;
  const trx=S.transactions.find(t=>t.id===lastReceiptTrx.id);
  if(!trx){toast('⚠️ Transaksi tidak ditemukan');return;}
  if(trx.voided){toast('Transaksi ini sudah dibatalkan sebelumnya');return;}
  appConfirm('Batalkan transaksi ini? Stok produk akan dikembalikan otomatis dan omzet tidak lagi dihitung. Tindakan ini tidak bisa dibatalkan.',()=>{
    trx.voided=true;
    trx.voidedAt=new Date().toISOString();
    trx.items.forEach(it=>{
      const p=S.products.find(x=>x.id===it.id);
      if(p)p.stock+=it.qty;
    });
    if(trx.customerId){
      const c=S.customers.find(x=>x.id===trx.customerId);
      if(c){
        c.totalSpend=Math.max(0,(c.totalSpend||0)-trx.total);
        c.totalTrx=Math.max(0,(c.totalTrx||0)-1);
      }
    }
    save();
    showReceipt(trx);
    renderProducts();renderRiwayatList();
    if(document.getElementById('pageLaporan').classList.contains('active'))renderLaporan();
    toast('🚫 Transaksi dibatalkan, stok dikembalikan');
  },'🚫 Batalkan Transaksi');
}
function closeReceiptModal(){
  ModalManager.closeModal('receiptModal');
  renderProducts();
}
async function downloadReceiptPDF(){
  if(!lastReceiptTrx){toast('Tidak ada struk untuk diunduh');return;}
  if(typeof window.jspdf==='undefined'){toast('⚠️ Modul PDF belum siap, coba lagi');return;}
  const trx=lastReceiptTrx;
  const { jsPDF }=window.jspdf;
  const W=72; // mm, thermal-receipt-like width
  const lineH=4.6;
  const socs=filledSocials().slice(0,3);
  const hasQr=!!(socs.length&&socs[0].url);
  let estLines=10+trx.items.length*2+(trx.diskon>0?1:0)+(trx.tax>0?1:0)+(trx.note?1:0)+2+(socs.length?socs.length+1:0)+(hasQr?9:0)+(trx.customerName?2:0);
  const H=Math.max(95,estLines*lineH+30);
  const doc=new jsPDF({unit:'mm',format:[W,H]});
  const cx=W/2;

  let y=8;
  doc.setTextColor(0,0,0);
  doc.setFont('helvetica','bold');doc.setFontSize(11);
  doc.text(S.storeName||'Toko Saya',cx,y,{align:'center'});y+=5;
  doc.setFont('courier','normal');doc.setFontSize(7.5);
  if(S.storeCategory){doc.text(S.storeCategory,cx,y,{align:'center'});y+=4;}
  if(S.storeAddr){doc.text(S.storeAddr,cx,y,{align:'center'});y+=4;}
  doc.text(new Date(trx.ts).toLocaleString('id-ID'),cx,y,{align:'center'});y+=4;
  doc.setFontSize(6.8);
  doc.text('No. Struk: '+trx.id.toUpperCase(),cx,y,{align:'center'});y+=4.5;
  if(trx.customerName){
    doc.setFontSize(7);
    doc.text('Pelanggan: '+trx.customerName,cx,y,{align:'center'});y+=3.6;
    if(trx.customerPhone){doc.setFontSize(6.8);doc.text('No. HP: '+trx.customerPhone,cx,y,{align:'center'});y+=4;}
  }
  doc.setLineDashPattern([0.6,0.6],0);
  doc.line(4,y,W-4,y);y+=4.5;
  doc.setFont('courier','normal');doc.setFontSize(8);
  trx.items.forEach(it=>{
    doc.text(it.name+(it.variant?' ('+it.variant+')':''),4,y);y+=3.8;
    doc.text(`  ${it.qty} x ${rpNum(it.price)}`,4,y);
    doc.text(rpNum(it.price*it.qty),W-4,y,{align:'right'});
    y+=lineH;
  });
  doc.line(4,y,W-4,y);y+=4.5;
  doc.text('Subtotal',4,y);doc.text(rpNum(trx.subtotal),W-4,y,{align:'right'});y+=lineH;
  if(trx.diskon>0){doc.text('Diskon',4,y);doc.text('-'+rpNum(trx.diskon),W-4,y,{align:'right'});y+=lineH;}
  if(trx.tax>0){doc.text((trx.taxLabel||'Pajak')+' ('+trx.taxPct+'%)',4,y);doc.text(rpNum(trx.tax),W-4,y,{align:'right'});y+=lineH;}
  doc.setFont('courier','bold');doc.setFontSize(9);
  doc.text('TOTAL',4,y);doc.text(rpNum(trx.total),W-4,y,{align:'right'});y+=lineH;
  doc.setFont('courier','normal');doc.setFontSize(8);
  doc.text(trx.method,4,y);
  if(trx.method==='Tunai')doc.text(rpNum(trx.cash),W-4,y,{align:'right'});
  y+=lineH;
  if(trx.method==='Tunai'){doc.text('Kembali',4,y);doc.text(rpNum(trx.change),W-4,y,{align:'right'});y+=lineH;}
  if(trx.note){doc.setFontSize(7);doc.text('Catatan: '+trx.note,4,y);y+=lineH;}
  y+=2;doc.line(4,y,W-4,y);y+=5;
  doc.setFont('helvetica','normal');doc.setFontSize(8);
  doc.text('Terima kasih atas kunjungan Anda',cx,y,{align:'center'});y+=5;

  if(socs.length){
    doc.setFont('helvetica','bold');doc.setFontSize(6.8);
    doc.text('HUBUNGI & IKUTI KAMI',cx,y,{align:'center'});y+=4;
    doc.setFont('courier','normal');doc.setFontSize(7);
    socs.forEach(s=>{doc.text(s.val,cx,y,{align:'center'});y+=3.6;});
    y+=1;
    if(hasQr){
      try{
        const resp=await fetch(receiptQrUrl(socs[0].url,300));
        const blob=await resp.blob();
        const dataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob);});
        const qSize=26;
        doc.setFillColor(255,255,255);doc.rect(cx-qSize/2-2,y,qSize+4,qSize+8,'F');
        doc.addImage(dataUrl,'PNG',cx-qSize/2,y+2,qSize,qSize);y+=qSize+6;
        doc.setTextColor(60,60,60);doc.setFontSize(6.2);
        doc.text('SCAN '+socs[0].l.toUpperCase(),cx,y,{align:'center'});y+=5;
        doc.setTextColor(0,0,0);
      }catch(e){console.warn('[PIMAPOS] QR gagal disisipkan ke PDF',e);}
    }
  }
  doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(110,110,110);
  doc.text(S.storeName||'Toko Saya',cx,y,{align:'center'});

  doc.save(`Struk_${S.storeName||'PIMAPOS'}_${trx.id}.pdf`);
  toast('📄 Struk PDF berhasil diunduh!');
}

/* ════════════════════════════════════════════════════
   PRODUK PAGE
════════════════════════════════════════════════════ */
function renderProductList(){
  document.getElementById('prodCountLbl').textContent=S.products.length+' produk';
  const wrap=document.getElementById('prodListWrap');
  if(S.products.length===0){
    wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">📦</div><div class="empty-title">Belum Ada Produk</div><div class="empty-desc">Ketuk + untuk menambahkan produk pertama Anda.</div></div>`;
    return;
  }
  const byCat={};
  S.products.forEach(p=>{(byCat[p.cat]=byCat[p.cat]||[]).push(p);});
  let html='';
  Object.keys(byCat).forEach(cat=>{
    html+=`<div class="slabel">${cat}</div>`;
    byCat[cat].forEach(p=>{
      html+=`<div class="card-list ripple-container" onclick="openProdModal('${p.id}')">
        <div class="tx-icon" style="background:rgba(251,191,36,.12);border-radius:50%;color:var(--amber);font-weight:800">${prodLetter(p.name)}</div>
        <div class="tx-info"><div class="tx-name">${esc(p.name)}${p.variant?' <span style="opacity:.6;font-weight:500">('+esc(p.variant)+')</span>':''}</div><div class="tx-cat">${p.artikel?esc(p.artikel)+' · ':''}Stok: ${p.stock}${p.unit&&p.unit!=='pcs'?' '+esc(p.unit):''}</div></div>
        <div class="tx-amt" style="color:var(--amber)">${rp(p.price)}</div>
      </div>`;
    });
  });
  wrap.innerHTML=html;
  initRipples();
}
function isRetailLikeStore(){return RETAIL_LIKE_CATS.includes(S.storeCategory);}
function renderProdArtikelField(){
  const wrap=document.getElementById('prodArtikelField');
  const nameVal=document.getElementById('prodName')?.value||'';
  const letter=prodLetter(nameVal);
  if(isRetailLikeStore()){
    wrap.innerHTML=`
      <div class="field">
        <label>Artikel Produk (Kode/Barcode)</label>
        <div class="field-row">
          <div class="artikel-icon-prev" id="prodIconPrev">${letter}</div>
          <input type="text" id="prodArtikel" placeholder="Scan atau ketik kode SKU/Barcode">
          <button type="button" class="scan-btn ripple-container" onclick="openScanModal()" title="Scan Barcode">📷</button>
        </div>
        <div class="scan-hint">Mode Retail/Fashion — scan barcode kemasan produk dengan kamera, atau isi manual.</div>
      </div>`;
  }else{
    wrap.innerHTML=`
      <div class="field">
        <label>Artikel Produk (Kode Menu)</label>
        <div class="field-row">
          <div class="artikel-icon-prev" id="prodIconPrev">${letter}</div>
          <input type="text" id="prodArtikel" placeholder="Contoh: MN-01" readonly>
          <button type="button" class="scan-btn ripple-container" onclick="generateAutoArtikel()" title="Buat Kode Otomatis">🔢</button>
        </div>
        <div class="scan-hint">Mode F&B/Jasa — produk biasanya tanpa barcode kemasan, jadi kode artikel dibuat otomatis.</div>
      </div>`;
  }
}
function generateAutoArtikel(){
  const prefixMap={'F&B':'FB','Cafe':'CF','Restoran':'RS','Laundry':'LD','Jasa/Servis':'JS','Lainnya':'LN'};
  const prefix=prefixMap[S.storeCategory]||'PR';
  const seq=String(S.products.length+1).padStart(3,'0');
  document.getElementById('prodArtikel').value=`${prefix}-${seq}`;
  toast('🔢 Kode artikel dibuat otomatis');
}
/* Scanner sekarang dikelola sepenuhnya oleh services/camera.js — stream
   dijamin berhenti saat modal ditutup (lewat ModalManager.onModalClose),
   tab disembunyikan, atau halaman berpindah. Lihat installCameraLifecycleGuards(). */
async function openScanModal(){
  ModalManager.openModal('scanModal');
  const video=document.getElementById('scanVideo');
  const status=document.getElementById('scanStatus');
  await Camera.startCamera(video,(code)=>{
    document.getElementById('prodArtikel').value=code;
    toast('✅ Barcode terdeteksi');
    setTimeout(closeScanModal,500);
  },(msg)=>{status.textContent=msg;});
}
function closeScanModal(){
  ModalManager.closeModal('scanModal');
}
ModalManager.onModalClose('scanModal',()=>Camera.stopCamera());
function populateCatSelect(){
  const sel=document.getElementById('prodCat');
  sel.innerHTML=S.categories.map(c=>`<option value="${c}">${c}</option>`).join('');
}
function variantLabelForStore(){
  const fashionLike=['Fashion/Clothing','Distro'].includes(S.storeCategory);
  return fashionLike?{label:'Ukuran (opsional)',placeholder:'S / M / L / XL / All Size'}:{label:'Varian (opsional)',placeholder:'Warna / Rasa / dll'};
}
function openProdModal(id){
  populateCatSelect();
  const vl=variantLabelForStore();
  document.getElementById('prodVariantLabel').textContent=vl.label;
  document.getElementById('prodVariant').placeholder=vl.placeholder;
  if(id){
    const p=S.products.find(x=>x.id===id);
    document.getElementById('prodModalTitle').textContent='Edit Produk';
    document.getElementById('prodEditId').value=id;
    document.getElementById('prodEmoji').value=p.emoji||CATEGORY_DEFAULT_ICON[S.storeCategory]||'📦';
    document.getElementById('prodName').value=p.name;
    document.getElementById('prodCat').value=p.cat;
    document.getElementById('prodPrice').value=p.price;
    document.getElementById('prodStock').value=p.stock;
    document.getElementById('prodUnit').value=p.unit||'pcs';
    document.getElementById('prodVariant').value=p.variant||'';
    renderProdArtikelField();
    document.getElementById('prodArtikel').value=p.artikel||'';
    document.getElementById('prodDelBtn').style.display='block';
  }else{
    document.getElementById('prodModalTitle').textContent='Tambah Produk';
    document.getElementById('prodEditId').value='';
    document.getElementById('prodEmoji').value=CATEGORY_DEFAULT_ICON[S.storeCategory]||'📦';
    document.getElementById('prodName').value='';
    document.getElementById('prodPrice').value='';
    document.getElementById('prodStock').value='';
    document.getElementById('prodUnit').value='pcs';
    document.getElementById('prodVariant').value='';
    renderProdArtikelField();
    document.getElementById('prodArtikel').value='';
    document.getElementById('prodDelBtn').style.display='none';
  }
  ModalManager.openModal('prodModal');
}
function closeProdModal(){ModalManager.closeModal('prodModal');closeScanModal();}
function saveProduct(){
  const name=document.getElementById('prodName').value.trim();
  const price=Number(document.getElementById('prodPrice').value||0);
  const stock=Number(document.getElementById('prodStock').value||0);
  if(!name||price<=0){toast('⚠️ Nama dan harga wajib diisi');return;}
  const id=document.getElementById('prodEditId').value;
  const artikel=(document.getElementById('prodArtikel')?.value||'').trim();
  const emoji=document.getElementById('prodEmoji').value||CATEGORY_DEFAULT_ICON[S.storeCategory]||'📦';
  const unit=document.getElementById('prodUnit').value||'pcs';
  const variant=document.getElementById('prodVariant').value.trim();
  const data={name,emoji,artikel,cat:document.getElementById('prodCat').value,price,stock,unit,variant};
  if(id){
    const p=S.products.find(x=>x.id===id);Object.assign(p,data);
  }else{
    S.products.push({id:uid(),...data});
  }
  save();closeProdModal();renderProductList();renderProducts();
  toast('✅ Produk disimpan');
}
function deleteProduct(){
  const id=document.getElementById('prodEditId').value;
  if(!id)return;
  appConfirm('Hapus produk ini? Tindakan ini tidak bisa dibatalkan.',()=>{
    S.products=S.products.filter(p=>p.id!==id);save();
    closeProdModal();renderProductList();renderProducts();
    toast('🗑️ Produk dihapus');
  },'🗑️ Hapus Produk');
}

/* CATEGORY MODAL */
function openCatModal(){renderCatList();ModalManager.openModal('catModal');}
function closeCatModal(){ModalManager.closeModal('catModal');}
function renderCatList(){
  document.getElementById('catListWrap').innerHTML=S.categories.map(c=>`
    <div class="card-list" style="cursor:default">
      <div class="tx-info"><div class="tx-name">${esc(c)}</div></div>
      <button class="qty-btn" style="background:rgba(248,113,113,.15);color:var(--red)" onclick="removeCategory('${c.replace(/'/g,"\\'")}')">×</button>
    </div>`).join('');
}
function addCategory(){
  const v=document.getElementById('newCatName').value.trim();
  if(!v)return;
  if(S.categories.includes(v)){toast('Kategori sudah ada');return;}
  S.categories.push(v);save();
  document.getElementById('newCatName').value='';
  renderCatList();renderCategoryChips();
}
function removeCategory(c){
  if(S.products.some(p=>p.cat===c)){toast('⚠️ Masih ada produk di kategori ini');return;}
  S.categories=S.categories.filter(x=>x!==c);save();
  renderCatList();renderCategoryChips();
}

/* ════════════════════════════════════════════════════
   RIWAYAT PAGE
════════════════════════════════════════════════════ */
function periodRange(p){
  const now=new Date();
  let start;
  if(p==='hari'){start=new Date(now.getFullYear(),now.getMonth(),now.getDate());}
  else if(p==='minggu'){const d=now.getDay()||7;start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-d+1);}
  else if(p==='bulan'){start=new Date(now.getFullYear(),now.getMonth(),1);}
  else{start=new Date(0);}
  return {start,end:now};
}
function renderRiwayatPeriodGrid(){
  const opts=[{k:'hari',l:'Hari Ini'},{k:'minggu',l:'Minggu'},{k:'bulan',l:'Bulan'},{k:'semua',l:'Semua'}];
  document.getElementById('riwayatPeriodGrid').innerHTML=opts.map(o=>
    `<div class="period-chip ${riwayatPeriod===o.k?'active':''}" data-period="${o.k}" onclick="setRiwayatPeriod('${o.k}')">${o.l}</div>`).join('');
  moveChipCapsule('riwayatPeriodGrid','riwayatCapsule','rmd');
}
function setRiwayatPeriod(p){
  riwayatPeriod=p;
  document.querySelectorAll('#riwayatPeriodGrid .period-chip').forEach(el=>el.classList.toggle('active',el.dataset.period===p));
  moveChipCapsule('riwayatPeriodGrid','riwayatCapsule','rmd');
  renderRiwayatList();
}
function filteredTrx(){
  const {start,end}=periodRange(riwayatPeriod);
  return S.transactions.filter(t=>{const d=new Date(t.ts);return d>=start&&d<=end;});
}
function renderRiwayat(){
  renderRiwayatPeriodGrid();
  renderRiwayatList();
}
function renderRiwayatList(){
  const list=filteredTrx();
  document.getElementById('riwayatSub').textContent=list.length+' transaksi';
  const wrap=document.getElementById('riwayatListWrap');
  if(list.length===0){
    wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">🧾</div><div class="empty-title">Belum Ada Transaksi</div><div class="empty-desc">Transaksi yang selesai akan muncul di sini.</div></div>`;
    return;
  }
  wrap.innerHTML=list.map(t=>{
    const d=new Date(t.ts);
    const itemsLbl=t.items.map(i=>esc(i.name)+' x'+i.qty).join(', ');
    return `<div class="card-list" onclick="showReceiptById('${t.id}')" style="align-items:flex-start;${t.voided?'opacity:.55':''}">
      <div class="tx-icon" style="${t.voided?'background:rgba(248,113,113,.12)':''}">${t.voided?'🚫':'🧾'}</div>
      <div class="tx-info">
        <div class="tx-name">${d.toLocaleDateString('id-ID',{day:'2-digit',month:'short'})} · ${d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})} · ${t.method}${t.voided?' · <span style="color:var(--red)">Dibatalkan</span>':''}</div>
        <div class="tx-cat" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${itemsLbl}</div>
      </div>
      <div class="tx-amt" style="${t.voided?'text-decoration:line-through;color:var(--t3)':''}">${rp(t.total)}</div>
    </div>`;
  }).join('');
  initRipples();
}

/* ════════════════════════════════════════════════════
   LAPORAN PAGE
════════════════════════════════════════════════════ */
function renderLaporan(){
  const list=filteredTrx().filter(t=>!t.voided);
  const omzet=list.reduce((s,t)=>s+t.total,0);
  const itemCount=list.reduce((s,t)=>s+t.items.reduce((a,i)=>a+i.qty,0),0);
  document.getElementById('lapOmzet').textContent=rpNum(omzet);
  document.getElementById('lapTrx').textContent=list.length;
  document.getElementById('lapItem').textContent=itemCount;
  document.getElementById('lapAvg').textContent=list.length?rpNum(omzet/list.length):'0';
  const labels={hari:'Hari Ini',minggu:'Minggu Ini',bulan:'Bulan Ini',semua:'Semua Waktu'};
  document.getElementById('lapPeriodLbl').textContent='Periode: '+(labels[riwayatPeriod]||'Hari Ini');

  // insight: omzet hari ini vs kemarin
  const now=new Date();
  const todayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const yestStart=new Date(todayStart);yestStart.setDate(yestStart.getDate()-1);
  const todayOmzet=S.transactions.filter(t=>!t.voided&&new Date(t.ts)>=todayStart).reduce((s,t)=>s+t.total,0);
  const yestOmzet=S.transactions.filter(t=>!t.voided&&new Date(t.ts)>=yestStart&&new Date(t.ts)<todayStart).reduce((s,t)=>s+t.total,0);
  let insightHTML='';
  if(yestOmzet>0){
    const diff=todayOmzet-yestOmzet;
    const pct=Math.round(Math.abs(diff)/yestOmzet*100);
    const up=diff>=0;
    insightHTML=`<div class="insight-card">
      <div class="insight-ic" style="background:${up?'rgba(52,211,153,.14)':'rgba(248,113,113,.14)'};color:${up?'var(--green)':'var(--red)'}">${up?'📈':'📉'}</div>
      <div class="insight-txt">Omzet hari ini <b>${rp(todayOmzet)}</b>, ${up?'naik':'turun'} <b style="color:${up?'var(--green)':'var(--red)'}">${pct}%</b> dibanding kemarin (${rp(yestOmzet)}).</div>
    </div>`;
  }else if(todayOmzet>0){
    insightHTML=`<div class="insight-card"><div class="insight-ic" style="background:rgba(52,211,153,.14);color:var(--green)">📈</div><div class="insight-txt">Omzet hari ini <b>${rp(todayOmzet)}</b>. Belum ada data kemarin untuk dibandingkan.</div></div>`;
  }
  document.getElementById('lapInsight').innerHTML=insightHTML;

  // top products
  const prodMap={};
  list.forEach(t=>t.items.forEach(i=>{
    prodMap[i.name]=prodMap[i.name]||{qty:0,amt:0,emoji:i.emoji};
    prodMap[i.name].qty+=i.qty;prodMap[i.name].amt+=i.price*i.qty;
  }));
  const topArr=Object.entries(prodMap).sort((a,b)=>b[1].qty-a[1].qty).slice(0,5);
  const maxQty=topArr.length?topArr[0][1].qty:1;
  document.getElementById('lapTopProd').innerHTML=topArr.length?topArr.map(([name,d])=>`
    <div class="bar-row">
      <div class="bar-row-top"><span class="n">${name}</span><span class="v">${d.qty} terjual</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(d.qty/maxQty*100)}%"></div></div>
    </div>`).join(''):'<div class="empty-state" style="padding:16px"><div class="empty-desc">Belum ada data penjualan.</div></div>';

  // payment method
  const pmMap={};
  list.forEach(t=>{pmMap[t.method]=(pmMap[t.method]||0)+t.total;});
  const pmArr=Object.entries(pmMap).sort((a,b)=>b[1]-a[1]);
  document.getElementById('lapPayMethod').innerHTML=pmArr.length?pmArr.map(([m,amt])=>`
    <div class="card-list" style="cursor:default"><div class="tx-icon">${m==='Tunai'?'💵':m==='QRIS'?'📱':'💳'}</div>
    <div class="tx-info"><div class="tx-name">${m}</div></div><div class="tx-amt">${rp(amt)}</div></div>`).join(''):
    '<div class="empty-state" style="padding:16px"><div class="empty-desc">Belum ada data.</div></div>';

  // low stock
  const low=S.products.filter(p=>p.stock<=5).sort((a,b)=>a.stock-b.stock);
  document.getElementById('lapLowStock').innerHTML=low.length?low.map(p=>`
    <div class="card-list" onclick="openProdModal('${p.id}')"><div class="tx-icon" style="background:rgba(248,113,113,.12);border-radius:50%;color:var(--red);font-weight:800">${prodLetter(p.name)}</div>
    <div class="tx-info"><div class="tx-name">${p.name}</div></div><div class="tx-amt" style="color:var(--red)">Stok: ${p.stock}</div></div>`).join(''):
    '<div class="empty-state" style="padding:16px"><div class="empty-desc">Semua stok aman 👍</div></div>';

  // member / pelanggan
  const tierCounts={};CUSTOMER_TIERS.forEach(t=>tierCounts[t.key]=0);
  S.customers.forEach(c=>{tierCounts[getTier(c.totalSpend).key]++;});
  document.getElementById('lapCustTiers').innerHTML=[...CUSTOMER_TIERS].reverse().map(t=>
    `<div class="mc"><div class="mv">${tierCounts[t.key]}</div><div class="ml">${t.icon} ${t.label}</div></div>`).join('');
  const topCust=[...S.customers].sort((a,b)=>(b.totalSpend||0)-(a.totalSpend||0)).slice(0,5);
  document.getElementById('lapTopCust').innerHTML=topCust.length?topCust.map(c=>{
    const t=getTier(c.totalSpend);
    return `<div class="cust-row" onclick="openCustomerFormModal('${c.id}')">
      <div class="cust-row-av">${c.name.charAt(0).toUpperCase()}</div>
      <div class="cust-row-info">
        <div class="cust-row-name">${c.name} ${tierBadgeHTML(c.totalSpend)}</div>
        <div class="cust-row-sub">${c.phone||'-'} · ${c.totalTrx||0}x transaksi</div>
      </div>
      <div class="tx-amt" style="color:var(--amber)">${rp(c.totalSpend||0)}</div>
    </div>`;
  }).join(''):'<div class="empty-state" style="padding:16px"><div class="empty-desc">Belum ada pelanggan tersimpan.</div></div>';
  renderHoldList();
  initRipples();
}

/* ════════════════════════════════════════════════════
   PROFIL PAGE
════════════════════════════════════════════════════ */
function renderProfil(){
  document.getElementById('profName').textContent=S.storeName||'Toko Saya';
  renderProfAvatar();
  document.getElementById('psTrx').textContent=S.transactions.length;
  document.getElementById('psProd').textContent=S.products.length;
  const omzet=S.transactions.reduce((s,t)=>s+t.total,0);
  document.getElementById('psOmzet').textContent='Rp'+(omzet>=1000000?(omzet/1000000).toFixed(1)+'jt':rpNum(omzet));
}
let syncModeTargetCat=null;
function manualSyncCategoryTemplate(){
  openSyncModeModal(S.storeCategory||'Lainnya');
}
function openSyncModeModal(cat){
  syncModeTargetCat=cat;
  document.getElementById('syncModeCatName').textContent=cat;
  ModalManager.openModal('syncModeModal');
}
function closeSyncModeModal(){
  ModalManager.closeModal('syncModeModal');
  syncModeTargetCat=null;
}
function runSyncMode(mode){
  const cat=syncModeTargetCat;
  if(!cat)return;
  closeSyncModeModal();
  applyCategoryTemplate(cat,{mode});
  activeCat='Semua';
  populateCatSelect();renderCategoryChips();renderProducts();
  toast(mode==='replace'?'🧹 Kategori & produk diganti sesuai "'+cat+'"':'✅ Kategori & produk "'+cat+'" ditambahkan');
}
/* ════════════════════════════════════════════════════
   ONBOARDING — PILIH JENIS TOKO (hanya tampil sekali saat
   pertama kali install, supaya kategori & contoh produk
   otomatis cocok dengan jenis toko sejak awal)
════════════════════════════════════════════════════ */
let onbSelectedCat='F&B';
function renderOnboardingChips(){
  document.getElementById('onbCatWrap').innerHTML=STORE_CATEGORIES.map(c=>
    `<div class="storecat-chip ${onbSelectedCat===c?'active':''}" data-storecat="${c}" onclick="selectOnboardingCat('${c.replace(/'/g,"\\'")}')">${c}</div>`).join('');
}
function selectOnboardingCat(c){
  onbSelectedCat=c;
  document.querySelectorAll('#onbCatWrap .storecat-chip').forEach(el=>el.classList.toggle('active',el.dataset.storecat===c));
}
function showOnboarding(){
  renderOnboardingChips();
  ModalManager.openModal('onboardingModal',{skipBackdropClose:true});
}
function closeOnboarding(){
  ModalManager.closeModal('onboardingModal');
  populateCatSelect();renderCategoryChips();renderProducts();renderProfil();
}
function confirmOnboarding(){
  applyCategoryTemplate(onbSelectedCat,{mode:'replace'});
  closeOnboarding();
  toast('✅ Template "'+onbSelectedCat+'" siap dipakai!');
}
function skipOnboarding(){
  S.storeCategory=onbSelectedCat;
  S.categories=['Lainnya'];
  S.products=[];
  save();
  closeOnboarding();
  toast('Mulai dari kosong — tambahkan produk pertamamu kapan saja');
}
let storeModalOriginalCat=null;
function openStoreModal(){
  storeModalOriginalCat=S.storeCategory;
  document.getElementById('storeName').value=S.storeName||'';
  document.getElementById('storeAddr').value=S.storeAddr||'';
  renderStoreCatChips();
  ModalManager.openModal('storeModal');
}

/* ════════════════════════════════════════════════════
   LOGO TOKO KUSTOM (avatar profil)
   Maks 300KB — dikompres otomatis via canvas jika lebih besar
════════════════════════════════════════════════════ */
function renderProfAvatar(){
  const letter=document.getElementById('profAvLetter');
  const img=document.getElementById('profAvImg');
  const removeRow=document.getElementById('removeLogoRow');
  if(S.storeLogo){
    img.src=S.storeLogo;img.style.display='block';
    letter.style.display='none';
    removeRow.style.display='flex';
  }else{
    img.style.display='none';img.src='';
    letter.style.display='block';
    letter.textContent=(S.storeName||'T').charAt(0).toUpperCase();
    removeRow.style.display='none';
  }
}
function removeLogo(){
  appConfirm('Hapus logo kustom dan kembali ke avatar huruf?',()=>{
    S.storeLogo='';save();renderProfAvatar();
    toast('🖼️ Logo kustom dihapus');
  },'Hapus Logo Kustom');
}
const LOGO_MAX_BYTES=300*1024;
function handleLogoUpload(e){
  const file=e.target.files[0];if(!file)return;
  if(!file.type||!file.type.startsWith('image/')){
    toast('⚠️ File harus berupa gambar (PNG/JPG/WEBP)');e.target.value='';return;
  }
  toast('⏳ Memproses gambar…');
  compressImageToMaxSize(file,LOGO_MAX_BYTES).then(dataUrl=>{
    S.storeLogo=dataUrl;save();renderProfAvatar();
    toast('✅ Logo toko diperbarui');
  }).catch(()=>{
    toast('❌ Gagal memproses gambar, coba file lain');
  }).finally(()=>{e.target.value='';});
}
function compressImageToMaxSize(file,maxBytes){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('read fail'));
    reader.onload=ev=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('decode fail'));
      img.onload=()=>{
        let w=img.naturalWidth,h=img.naturalHeight;
        const maxDim=512;
        if(Math.max(w,h)>maxDim){
          const scale=maxDim/Math.max(w,h);
          w=Math.round(w*scale);h=Math.round(h*scale);
        }
        const canvas=document.createElement('canvas');
        const ctx=canvas.getContext('2d');
        canvas.width=w;canvas.height=h;
        const draw=()=>{canvas.width=w;canvas.height=h;ctx.clearRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);};
        draw();
        const approxBytes=du=>Math.round((du.length-du.indexOf(',')-1)*0.75);
        let quality=0.92,dataUrl=canvas.toDataURL('image/jpeg',quality),tries=0;
        while(approxBytes(dataUrl)>maxBytes&&tries<16){
          if(quality>0.4){quality-=0.08;}
          else{w=Math.round(w*0.85);h=Math.round(h*0.85);draw();quality=0.6;}
          dataUrl=canvas.toDataURL('image/jpeg',quality);
          tries++;
        }
        if(approxBytes(dataUrl)>maxBytes){reject(new Error('too large'));return;}
        resolve(dataUrl);
      };
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ════════════════════════════════════════════════════
   SECURITY PIN (SHA-256 via WebCrypto)
════════════════════════════════════════════════════ */
async function sha256Hex(text){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function renderTaxUI(){
  const t=getTaxConfig();
  document.getElementById('taxToggle').classList.toggle('active',!!t.enabled);
  document.getElementById('taxDetailWrap').style.opacity=t.enabled?'1':'.45';
  document.getElementById('taxDetailWrap').style.pointerEvents=t.enabled?'auto':'none';
  document.getElementById('taxLabel').value=t.label||'PPN';
  document.getElementById('taxPct').value=t.pct||0;
}
function toggleTax(){
  S.tax=S.tax||{enabled:false,pct:10,label:'PPN'};
  S.tax.enabled=!S.tax.enabled;
  save();renderTaxUI();
  toast(S.tax.enabled?'✅ Pajak/Service Charge diaktifkan':'🔕 Pajak/Service Charge dimatikan');
}
function saveTaxSettings(){
  S.tax=S.tax||{enabled:false,pct:10,label:'PPN'};
  S.tax.label=document.getElementById('taxLabel').value.trim()||'PPN';
  S.tax.pct=Math.max(0,Math.min(100,Number(document.getElementById('taxPct').value||0)));
  save();
}
function renderPinToggleUI(){
  const on=!!S.security.pinEnabled;
  document.getElementById('pinToggle').classList.toggle('active',on);
  document.getElementById('pinChangeRow').style.display=on?'flex':'none';
}
function togglePinLock(){
  if(!S.security.pinEnabled){
    openSetPinModal(true);
  }else{
    openVerifyPinDisableModal();
  }
}
function openVerifyPinDisableModal(){
  document.getElementById('verifyPinDisableVal').value='';
  document.getElementById('verifyPinDisableErr').textContent='';
  ModalManager.openModal('verifyPinDisableModal');
  setTimeout(()=>document.getElementById('verifyPinDisableVal').focus(),350);
}
function closeVerifyPinDisableModal(){
  ModalManager.closeModal('verifyPinDisableModal');
  renderPinToggleUI(); // pastikan kapsul kembali ke posisi aktif kalau dibatalkan
}
async function confirmDisablePin(){
  const val=document.getElementById('verifyPinDisableVal').value.trim();
  if(!/^\d{6}$/.test(val)){
    document.getElementById('verifyPinDisableErr').textContent='⚠️ Masukkan 6 digit PIN';
    return;
  }
  const hash=await sha256Hex(val);
  if(hash!==S.security.pinHash){
    document.getElementById('verifyPinDisableErr').textContent='❌ PIN salah, coba lagi';
    document.getElementById('verifyPinDisableVal').value='';
    return;
  }
  appConfirm('PIN terverifikasi. Yakin ingin menonaktifkan kunci PIN aplikasi? Siapa saja akan bisa membuka aplikasi tanpa PIN.',()=>{
    S.security.pinEnabled=false;S.security.pinHash='';save();
    ModalManager.closeModal('verifyPinDisableModal');
    renderPinToggleUI();toast('🔓 Kunci PIN dinonaktifkan');
  },'Nonaktifkan PIN');
}
let _settingFirstPin=false;
function openSetPinModal(isFirstSetup){
  _settingFirstPin=!!isFirstSetup;
  document.getElementById('newPinVal').value='';
  document.getElementById('confirmPinVal').value='';
  ModalManager.openModal('setPinModal');
}
function closeSetPinModal(){
  ModalManager.closeModal('setPinModal');
  renderPinToggleUI();
}
async function saveNewPin(){
  const p1=document.getElementById('newPinVal').value.trim();
  const p2=document.getElementById('confirmPinVal').value.trim();
  if(!/^\d{6}$/.test(p1)){toast('⚠️ PIN harus 6 digit angka');return;}
  if(p1!==p2){toast('⚠️ Konfirmasi PIN tidak cocok');return;}
  const hash=await sha256Hex(p1);
  S.security.pinHash=hash;S.security.pinEnabled=true;save();
  ModalManager.closeModal('setPinModal');
  renderPinToggleUI();
  toast('✅ PIN keamanan disimpan');
}
let plEntry='';
function renderPlNumpad(){
  const wrap=document.getElementById('plNumpad');
  if(wrap.childElementCount)return;
  const keys=['1','2','3','4','5','6','7','8','9','','0','⌫'];
  wrap.innerHTML=keys.map(k=>k===''?'<div class="pl-key empty"></div>':`<div class="pl-key ripple-container" onclick="plKeyPress('${k}')">${k}</div>`).join('');
  initRipples();
}
function plKeyPress(k){
  if(k==='⌫'){plEntry=plEntry.slice(0,-1);}
  else if(plEntry.length<6){plEntry+=k;}
  renderPlDots();
  if(plEntry.length===6)verifyPin();
}
function renderPlDots(){
  document.querySelectorAll('#plDots .pl-dot').forEach((d,i)=>d.classList.toggle('filled',i<plEntry.length));
}
async function verifyPin(){
  const hash=await sha256Hex(plEntry);
  if(hash===S.security.pinHash){
    document.getElementById('pinLockScreen').style.display='none';
    plEntry='';renderPlDots();
    // Trigger deferred startup checks after PIN unlock
    if(window._pendingBodCheck){
      window._pendingBodCheck=false;
      setTimeout(checkBodReminder,300);
    }
    if(PIMAPOS_IS_FIRST_RUN&&window._pendingOnboarding){
      window._pendingOnboarding=false;
      setTimeout(showOnboarding,400);
    }
  }else{
    const dots=document.getElementById('plDots');
    dots.classList.add('shake');
    toast('❌ PIN salah');
    setTimeout(()=>{dots.classList.remove('shake');plEntry='';renderPlDots();},420);
  }
}
function forgotPin(){
  appConfirm('Lupa PIN? Karena PIMAPOS tidak memakai server, satu-satunya cara adalah menonaktifkan kunci PIN ini. Data toko TIDAK akan terhapus. Lanjutkan?',()=>{
    S.security.pinEnabled=false;S.security.pinHash='';save();
    document.getElementById('pinLockScreen').style.display='none';
    plEntry='';renderPlDots();renderPinToggleUI();
    toast('🔓 Kunci PIN direset, silakan atur ulang di Profil');
  },'Reset Kunci PIN');
}
function initPinLock(){
  if(S.security.pinEnabled&&S.security.pinHash){
    document.getElementById('plLogoLetter').textContent=(S.storeName||'T').charAt(0).toUpperCase();
    document.getElementById('plTitle').textContent=S.storeName||'Toko Saya';
    if(S.storeLogo){
      document.getElementById('plLogoImg').src=S.storeLogo;
      document.getElementById('plLogoImg').style.display='block';
      document.getElementById('plLogoLetter').style.display='none';
    }
    renderPlNumpad();
    plEntry='';renderPlDots();
    document.getElementById('pinLockScreen').style.display='flex';
  }
}

/* ════════════════════════════════════════════════════
   NOTIFIKASI PENGINGAT (Service Worker + Notification API)
   Catatan jujur: tanpa server backend, ini BUKAN push
   notification sungguhan dari server. Yang diimplementasikan
   adalah notifikasi lokal lewat Service Worker yang tetap
   terdaftar di browser lintas sesi — jadi begitu PIMAPOS
   dibuka kembali (tab aktif/background), pengingat akan
   muncul sebagai notifikasi sistem, bukan cuma modal di
   dalam app. Push murni dari server butuh backend terpisah.
════════════════════════════════════════════════════ */
let swReg=null;
async function registerSW(){
  if(!('serviceWorker' in navigator))return null;
  try{
    swReg=await navigator.serviceWorker.register('./sw.js');
    return swReg;
  }catch(e){
    console.warn('[PIMAPOS] Service worker gagal didaftarkan (mungkin dibuka via file:// atau tanpa sw.js di folder yang sama).',e);
    return null;
  }
}
function renderNotifToggleUI(){
  document.getElementById('notifToggle').classList.toggle('active',!!S.notif.enabled);
  const hint=document.getElementById('notifStatusHint');
  if(!('Notification' in window)){
    hint.textContent='⚠️ Browser ini tidak mendukung Notification API.';
  }else if(S.notif.enabled&&Notification.permission==='granted'){
    hint.textContent='✅ Notifikasi aktif. Pengingat BOD akan muncul kalau shift belum dibuka.';
  }else if(Notification.permission==='denied'){
    hint.textContent='⚠️ Izin notifikasi diblokir browser. Aktifkan lewat pengaturan situs.';
  }else{
    hint.textContent='Aktifkan supaya tidak lupa membuka shift, walau lupa membuka aplikasi.';
  }
}
async function toggleNotif(){
  if(!('Notification' in window)){toast('⚠️ Browser tidak mendukung notifikasi');return;}
  if(!S.notif.enabled){
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){toast('⚠️ Izin notifikasi ditolak');renderNotifToggleUI();return;}
    await registerSW();
    S.notif.enabled=true;save();
    toast('🔔 Notifikasi pengingat diaktifkan');
  }else{
    S.notif.enabled=false;save();
    toast('🔕 Notifikasi pengingat dimatikan');
  }
  renderNotifToggleUI();
}
function fireBodNotification(){
  if(!S.notif.enabled)return;
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  const title='🌅 Belum Mulai Shift — '+(S.storeName||'Toko Saya');
  const opts={body:'Shift (BOD) hari ini belum dibuka. Ketuk untuk segera mulai supaya kas & laporan tetap akurat.',tag:'pimapos-bod-reminder',renotify:true};
  if(swReg&&swReg.showNotification){swReg.showNotification(title,opts);}
  else{try{new Notification(title,opts);}catch(e){}}
}

/* ════════════════════════════════════════════════════
   PENGINGAT BOD (Begin of Day)
   Rekomendasi: (1) blokir tambah item ke keranjang jika
   shift belum dibuka, (2) pengingat otomatis sekali/hari
   saat app dibuka (modal + notifikasi sistem), (3) banner
   shift dengan badge pulsing merah saat jam buka toko.
════════════════════════════════════════════════════ */
function checkBodReminder(){
  if(PIMAPOS_IS_FIRST_RUN)return;
  const todayStr=new Date().toDateString();
  if(S.activeShift)return;
  if(S._lastBodReminder===todayStr)return;
  S._lastBodReminder=todayStr;save();
  // 350ms delay — splash already done at this point, just let main UI render first
  setTimeout(()=>{ModalManager.openModal('bodReminderModal');},350);
  fireBodNotification();
}
function closeBodReminderModal(){ModalManager.closeModal('bodReminderModal');}
function closeStoreModal(){ModalManager.closeModal('storeModal');}
function renderStoreCatChips(){
  document.getElementById('storeCatWrap').innerHTML=STORE_CATEGORIES.map(c=>
    `<div class="storecat-chip ${S.storeCategory===c?'active':''}" data-storecat="${c}" onclick="setStoreCategory('${c.replace(/'/g,"\\'")}')">${c}</div>`).join('');
}
function setStoreCategory(c){
  S.storeCategory=c;
  document.querySelectorAll('#storeCatWrap .storecat-chip').forEach(el=>el.classList.toggle('active',el.dataset.storecat===c));
}
function saveStore(){
  S.storeName=document.getElementById('storeName').value.trim()||'Toko Saya';
  S.storeAddr=document.getElementById('storeAddr').value.trim();
  const catChanged=storeModalOriginalCat&&storeModalOriginalCat!==S.storeCategory;
  const newCat=S.storeCategory;
  save();closeStoreModal();renderProfil();toast('✅ Info toko disimpan');
  if(catChanged){
    setTimeout(()=>{openSyncModeModal(newCat);},420);
  }
}

/* ════════════════════════════════════════════════════
   MEDIA SOSIAL & QR CODE TOKO
════════════════════════════════════════════════════ */
function renderSocialTabs(){
  const wrap=document.getElementById('socScroll');
  wrap.innerHTML=SOCIAL_PLATFORMS.map(p=>
    `<div class="soc-chip ${activeSocialTab===p.k?'active':''}" data-soc="${p.k}" onclick="setActiveSocialTab('${p.k}')"><span>${p.ic}</span>${p.l}</div>`).join('');
  moveChipCapsule('socScroll','socCapsule');
  document.getElementById('socValue').value=S.socials[activeSocialTab]||'';
  const cur=SOCIAL_PLATFORMS.find(p=>p.k===activeSocialTab);
  document.getElementById('socFieldLabel').textContent=`Username / Tautan ${cur?cur.l:''}`;
  renderSocialQR();
}
function setActiveSocialTab(k){
  activeSocialTab=k;
  document.querySelectorAll('#socScroll .soc-chip').forEach(el=>el.classList.toggle('active',el.dataset.soc===k));
  moveChipCapsule('socScroll','socCapsule');
  document.getElementById('socValue').value=S.socials[activeSocialTab]||'';
  const cur=SOCIAL_PLATFORMS.find(p=>p.k===activeSocialTab);
  document.getElementById('socFieldLabel').textContent=`Username / Tautan ${cur?cur.l:''}`;
  renderSocialQR();
}
function socialQrData(){
  const val=(document.getElementById('socValue').value||'').trim();
  if(!val)return '';
  if(activeSocialTab==='whatsapp'){
    const num=val.replace(/[^0-9]/g,'');
    return num?`https://wa.me/${num}`:'';
  }
  if(/^https?:\/\//i.test(val))return val;
  const baseMap={instagram:'https://instagram.com/',tiktok:'https://tiktok.com/@',facebook:'https://facebook.com/',shopee:'https://shopee.co.id/',tokopedia:'https://tokopedia.com/',website:'https://'};
  const handle=val.replace(/^@/,'');
  return (baseMap[activeSocialTab]||'')+handle;
}
function renderSocialQR(){
  const data=socialQrData();
  const img=document.getElementById('qrImg');
  const empty=document.getElementById('qrImgEmpty');
  const lbl=document.getElementById('qrLabel');
  const cur=SOCIAL_PLATFORMS.find(p=>p.k===activeSocialTab);
  if(!data){
    img.style.display='none';empty.style.display='flex';lbl.textContent='';
    return;
  }
  img.src=`https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=${encodeURIComponent(data)}`;
  img.style.display='block';empty.style.display='none';
  lbl.textContent=`${cur?cur.ic+' '+cur.l:''} · ${S.storeName||'Toko'}`;
}
function saveSocial(){
  S.socials[activeSocialTab]=(document.getElementById('socValue').value||'').trim();
  save();toast('✅ Akun sosial disimpan');
  renderSocialQR();
}
function downloadQR(){
  const data=socialQrData();
  if(!data){toast('⚠️ Isi data akun terlebih dahulu');return;}
  const url=`https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&data=${encodeURIComponent(data)}`;
  const cur=SOCIAL_PLATFORMS.find(p=>p.k===activeSocialTab);
  fetch(url).then(r=>r.blob()).then(blob=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`QR_${S.storeName||'Toko'}_${cur?cur.k:'sosial'}.png`;
    a.click();URL.revokeObjectURL(a.href);
    toast('⬇️ QR Code diunduh!');
  }).catch(()=>{
    // fallback: open in new tab if fetch blocked (CORS)
    window.open(url,'_blank');
    toast('QR dibuka di tab baru, simpan gambar secara manual');
  });
}


/* ════════════════════════════════════════════════════
   BOD / EOD — SHIFT MANAGEMENT
════════════════════════════════════════════════════ */
/* Asumsi jam operasional toko pada umumnya — dipakai untuk
   menentukan kapan badge pengingat BOD berkedip aktif. */
const STORE_OPEN_HOUR=8,STORE_CLOSE_HOUR=21;
function isWithinStoreHours(){
  const h=new Date().getHours();
  return h>=STORE_OPEN_HOUR&&h<STORE_CLOSE_HOUR;
}
function renderShiftBanner(){
  const banner=document.getElementById('shiftBanner');
  const ic=document.getElementById('shiftBannerIc');
  const title=document.getElementById('shiftBannerTitle');
  const sub=document.getElementById('shiftBannerSub');
  const cta=document.getElementById('shiftBannerCta');
  if(S.activeShift){
    banner.classList.remove('closed','urgent');banner.classList.add('open');
    ic.textContent='🟢';
    title.textContent='Shift Aktif';
    const t=new Date(S.activeShift.startTs);
    sub.textContent=`Dibuka ${t.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})} · Kas awal ${rp(S.activeShift.startCash)}`;
    cta.textContent='EOD';
  }else{
    banner.classList.remove('open');banner.classList.add('closed');
    banner.classList.toggle('urgent',isWithinStoreHours());
    ic.textContent='🔒';
    title.textContent='Toko Belum Buka';
    sub.textContent=isWithinStoreHours()?'Sudah jam operasional — ketuk untuk mulai BOD':'Ketuk untuk mulai BOD (Begin of Day)';
    cta.textContent='BOD';
  }
}
function onShiftBannerClick(){
  if(S.activeShift)openEodModal();else openBodModal();
}
function openBodModal(){
  document.getElementById('bodCash').value='';
  document.getElementById('bodNote').value='';
  ModalManager.openModal('bodModal');
}
function closeBodModal(){ModalManager.closeModal('bodModal');}
function startShift(){
  const cashRaw=document.getElementById('bodCash').value;
  if(cashRaw===''||cashRaw===null){
    floatWarn('⚠️ Isi modal awal kas sebelum membuka shift');
    document.getElementById('bodCash').focus();
    return;
  }
  const cash=Number(cashRaw);
  S.activeShift={
    id:uid(),
    startTs:new Date().toISOString(),
    startCash:cash,
    note:document.getElementById('bodNote').value||''
  };
  save();closeBodModal();renderShiftBanner();
  toast('🚀 Shift dibuka — selamat berjualan!');
}
function shiftTrx(shiftId){
  return S.transactions.filter(t=>t.shiftId===shiftId);
}
function openEodModal(){
  if(!S.activeShift){toast('Tidak ada shift aktif');return;}
  const trx=shiftTrx(S.activeShift.id);
  const cashSales=trx.filter(t=>t.method==='Tunai').reduce((s,t)=>s+t.total,0);
  const nonCashSales=trx.filter(t=>t.method!=='Tunai').reduce((s,t)=>s+t.total,0);
  const expected=S.activeShift.startCash+cashSales;
  document.getElementById('eodOpenedAt').textContent=new Date(S.activeShift.startTs).toLocaleString('id-ID');
  document.getElementById('eodStartCash').textContent=rp(S.activeShift.startCash);
  document.getElementById('eodTrxCount').textContent=trx.length;
  document.getElementById('eodCashSales').textContent=rp(cashSales);
  document.getElementById('eodNonCashSales').textContent=rp(nonCashSales);
  document.getElementById('eodExpected').textContent=rp(expected);
  document.getElementById('eodActualCash').value='';
  document.getElementById('eodNote').value='';
  document.getElementById('eodDiffRow').style.display='none';
  ModalManager.openModal('eodModal');
}
function closeEodModal(){ModalManager.closeModal('eodModal');}
function calcEodDiff(){
  const trx=shiftTrx(S.activeShift.id);
  const cashSales=trx.filter(t=>t.method==='Tunai').reduce((s,t)=>s+t.total,0);
  const expected=S.activeShift.startCash+cashSales;
  const actual=Number(document.getElementById('eodActualCash').value||0);
  const diff=actual-expected;
  const row=document.getElementById('eodDiffRow');
  const val=document.getElementById('eodDiffVal');
  row.style.display=document.getElementById('eodActualCash').value?'flex':'none';
  val.textContent=(diff>=0?'+':'')+rp(diff);
  val.style.color=diff===0?'var(--green)':(diff>0?'var(--blue-hi)':'var(--red)');
}
function closeShift(){
  if(!S.activeShift)return;
  // Blokir EOD jika masih ada produk yang ditahan/booking
  if(S.holds.length>0){
    floatWarn(`⚠️ Selesaikan ${S.holds.length} booking/hold produk dulu sebelum menutup shift`);
    closeEodModal();
    setTimeout(()=>{showPage('pageLaporan');},400);
    setTimeout(()=>{
      const el=document.getElementById('lapHoldList');
      if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
    },600);
    return;
  }
  const actualRaw=document.getElementById('eodActualCash').value;
  if(actualRaw===''||actualRaw===null){
    floatWarn('⚠️ Isi jumlah kas aktual yang dihitung sebelum menutup shift');
    document.getElementById('eodActualCash').focus();
    return;
  }
  const trx=shiftTrx(S.activeShift.id);
  const cashSales=trx.filter(t=>t.method==='Tunai').reduce((s,t)=>s+t.total,0);
  const nonCashSales=trx.filter(t=>t.method!=='Tunai').reduce((s,t)=>s+t.total,0);
  const expected=S.activeShift.startCash+cashSales;
  const actual=Number(document.getElementById('eodActualCash').value||0);
  const closed={
    ...S.activeShift,
    endTs:new Date().toISOString(),
    totalTrx:trx.length,
    cashSales,nonCashSales,
    totalSales:cashSales+nonCashSales,
    expectedCash:expected,
    actualCash:actual,
    diff:actual-expected,
    endNote:document.getElementById('eodNote').value||''
  };
  S.shifts.unshift(closed);
  S.activeShift=null;
  save();closeEodModal();renderShiftBanner();
  toast('🔒 Shift ditutup. Selamat istirahat!');
}
function openShiftHistoryModal(){renderShiftHistory();ModalManager.openModal('shiftHistoryModal');}
function closeShiftHistoryModal(){ModalManager.closeModal('shiftHistoryModal');}
function renderShiftHistory(){
  const wrap=document.getElementById('shiftHistoryWrap');
  if(!S.shifts.length){
    wrap.innerHTML=`<div class="empty-state"><div class="empty-icon">🕒</div><div class="empty-title">Belum Ada Riwayat</div><div class="empty-desc">Riwayat BOD/EOD akan muncul di sini setelah shift ditutup.</div></div>`;
    return;
  }
  wrap.innerHTML=S.shifts.map(s=>{
    const d=new Date(s.startTs);
    const diffColor=s.diff===0?'var(--green)':(s.diff>0?'var(--blue-hi)':'var(--red)');
    return `<div class="card-list" style="cursor:default;align-items:flex-start">
      <div class="tx-icon">🕒</div>
      <div class="tx-info">
        <div class="tx-name">${d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})} · ${d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}</div>
        <div class="tx-cat">${s.totalTrx} trx · Omzet ${rp(s.totalSales)} · Selisih <span style="color:${diffColor};font-weight:700">${s.diff>=0?'+':''}${rpNum(s.diff)}</span></div>
      </div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════
   DATA: EXPORT / IMPORT / RESET
════════════════════════════════════════════════════ */
function exportJSON(){
  const blob=new Blob([JSON.stringify(S,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;
  a.download=`pimapos_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();URL.revokeObjectURL(url);
  toast('📤 Backup JSON diekspor!');
}
function exportLaporanCSV(){
  const list=filteredTrx();
  if(!list.length){toast('⚠️ Tidak ada transaksi pada periode ini');return;}
  const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const header=['Tanggal','Waktu','No. Struk','Status','Item','Subtotal','Diskon','Pajak','Total','Metode','Pelanggan','No. HP'];
  const rows=list.map(t=>{
    const d=new Date(t.ts);
    const itemsLbl=t.items.map(i=>i.name+' x'+i.qty).join('; ');
    return [
      d.toLocaleDateString('id-ID'),d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}),
      t.id.toUpperCase(),t.voided?'Dibatalkan':'Selesai',itemsLbl,
      t.subtotal,t.diskon||0,t.tax||0,t.total,t.method,t.customerName||'',t.customerPhone||''
    ].map(esc).join(',');
  });
  const csv='\uFEFF'+[header.map(esc).join(','),...rows].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;
  a.download=`Laporan_${S.storeName||'PIMAPOS'}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();URL.revokeObjectURL(url);
  toast('⬇️ Laporan CSV diekspor!');
}
function importJSON(){document.getElementById('importFile').click();}
function handleImport(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const imp=JSON.parse(ev.target.result);
      if(!imp.products) throw new Error('invalid');
      S={...defState(),...imp,socials:{...defState().socials,...(imp.socials||{})},security:{...defState().security,...(imp.security||{})},notif:{...defState().notif,...(imp.notif||{})},tax:{...defState().tax,...(imp.tax||{})}};save();
      initTheme();renderProfil();activeCat='Semua';renderCategoryChips();renderProducts();renderShiftBanner();
      toast('✅ Data berhasil diimpor!');
    }catch{toast('❌ File tidak valid atau rusak');}
  };
  reader.readAsText(file);e.target.value='';
}
/* ════════════════════════════════════════════════════
   GENERIC IN-APP CONFIRM (pengganti window.confirm yang
   bisa diblokir oleh sandbox/webview sehingga tombol
   tampak "tidak berfungsi")
════════════════════════════════════════════════════ */
let _confirmCb=null;
function appConfirm(msg,onYes,title){
  document.getElementById('confirmTitle').textContent=title||'⚠️ Konfirmasi';
  document.getElementById('confirmMsg').textContent=msg;
  _confirmCb=onYes;
  ModalManager.openModal('confirmModal');
}
function confirmModalYes(){
  const cb=_confirmCb;
  closeConfirmModal();
  if(cb)cb();
}
function closeConfirmModal(){
  ModalManager.closeModal('confirmModal');
  _confirmCb=null;
}
function confirmReset(){
  appConfirm('Hapus SEMUA data (produk, transaksi, riwayat shift, pengaturan)? Tindakan ini tidak bisa dibatalkan.',()=>{
    S=defState();
    S.categories=['Lainnya'];S.products=[]; // kosongkan dulu, biar onboarding yang isi sesuai kategori pilihan
    save();initTheme();
    cart=[];updateCartBar();
    activeCat='Semua';renderCategoryChips();renderProducts();renderProfil();renderShiftBanner();
    toast('🗑️ Semua data dihapus');
    setTimeout(showOnboarding,400);
  },'🗑️ Hapus Semua Data');
}

/* ════════════════════════════════════════════════════
   KEYBOARD & BACKDROP
   Sekarang ditangani terpusat oleh ModalManager: Escape / tap
   backdrop hanya menutup modal PALING ATAS (bukan semua modal
   sekaligus seperti perilaku lama), dan onboardingModal dikecualikan
   dari backdrop-close lewat opsi skipBackdropClose di atas.
════════════════════════════════════════════════════ */
ModalManager.initModalManager();

/* ════════════════════════════════════════════════════
   SPLASH REMOVE
════════════════════════════════════════════════════ */
function removeSplash(onDone){
  const splash=document.getElementById('splashScreen');
  if(!splash){if(onDone)onDone();return;}
  let called=false;
  const done=()=>{
    if(called)return;called=true;
    splash.style.display='none';
    if(onDone)onDone();
  };
  // Dual safety: animationend event + hard timeout fallback
  // splashOut delay 2.4s + duration 0.6s = 3000ms total, +200ms buffer
  splash.addEventListener('animationend',done,{once:true});
  setTimeout(done,3200);
}

/* ════════════════════════════════════════════════════
   INIT — semua UI yang muncul saat pertama buka harus
   menunggu splash selesai agar tidak tumpang tindih
════════════════════════════════════════════════════ */
ErrorHandling.markBootPhase(true);
Camera.installCameraLifecycleGuards();
try{
  initTheme();
  document.getElementById('kasirGreet').textContent=greetTime();
  populateCatSelect();
  renderCategoryChips();
  renderProducts();
  renderProfil();
  renderShiftBanner();
  renderKasirCustChip();
  renderHoldCapsule();
  requestAnimationFrame(()=>requestAnimationFrame(moveCapsule));
  initNavBalloon();

  // POST-SPLASH: semua popup/overlay hanya boleh muncul SETELAH splash selesai
  removeSplash(()=>{
    try{
      // 1. PIN lock (prioritas tertinggi — tampil pertama)
      initPinLock();
      // 2. Service worker notif (silent, tidak tampilkan UI)
      if(S.notif.enabled&&'Notification' in window&&Notification.permission==='granted'){
        registerSW();
      }
      // 3. BOD reminder (hanya kalau tidak ada PIN lock yang sedang tampil)
      const pinActive=S.security.pinEnabled&&S.security.pinHash&&
        document.getElementById('pinLockScreen').style.display!=='none';
      if(!pinActive){
        checkBodReminder();
      }else{
        // Kalau PIN lock aktif, BOD reminder ditunda sampai PIN berhasil di-unlock
        const orig=verifyPin;
        // Override verifyPin sekali untuk trigger BOD setelah unlock
        window._pendingBodCheck=true;
      }
      // 4. Onboarding (hanya run pertama kali)
      if(PIMAPOS_IS_FIRST_RUN&&!S.security.pinEnabled){
        setTimeout(showOnboarding,400);
      }else if(PIMAPOS_IS_FIRST_RUN&&pinActive){
        window._pendingOnboarding=true;
      }
    }catch(e){
      console.error('[PIMAPOS] Post-splash init gagal:',e);
      toast('⚠️ Sebagian fitur gagal dimuat, coba muat ulang jika ada yang aneh.');
    }finally{
      ErrorHandling.markBootPhase(false);
    }
  });
}catch(e){
  console.error('[PIMAPOS] Boot gagal:',e);
  ErrorHandling.markBootPhase(true);
  throw e; // biar tertangkap window.onerror -> fatal recovery screen
}

