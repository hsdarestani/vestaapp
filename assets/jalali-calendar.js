(() => {
  if (window.__vestalandJalaliCalendar) return;
  window.__vestalandJalaliCalendar = true;

  const $ = (s, r = document) => r.querySelector(s);
  const fmt = n => new Intl.NumberFormat('fa-IR').format(Number(n || 0));
  const token = () => localStorage.getItem('vestaland:token') || '';
  const monthNames = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const weekdays = ['ش','ی','د','س','چ','پ','ج'];
  let latestCycle = null;
  let cursor = new Date();
  let renderBusy = false;
  let renderTimer = null;

  const jalaliFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', {
    year:'numeric', month:'numeric', day:'numeric'
  });
  const jalaliLongFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year:'numeric', month:'long'
  });
  const jalaliDateFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year:'numeric', month:'long', day:'numeric'
  });

  function injectStyle(){
    if ($('#vxJalaliStyle')) return;
    const style = document.createElement('style');
    style.id = 'vxJalaliStyle';
    style.textContent = `
      .vx-jalali-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:14px 0 8px;padding:0 2px}
      .vx-jalali-title{font-weight:800;font-size:15px;color:var(--ink,#211a20)}
      .vx-jalali-nav{display:flex;align-items:center;gap:6px}
      .vx-jalali-nav button{border:0;background:#f5f1f4;border-radius:10px;width:34px;height:34px;font:inherit;font-weight:800;cursor:pointer;color:inherit}
      .vx-jalali-day{font-variant-numeric:tabular-nums}
      .vx-jalali-selects{display:grid;grid-template-columns:1fr 1.35fr 1fr;gap:8px}
      .vx-jalali-selects select{width:100%;min-height:46px;border:1px solid rgba(35,25,33,.14);border-radius:13px;background:#fff;padding:0 10px;font:inherit;color:inherit}
      .vx-jalali-date-preview{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 13px;border-radius:13px;background:#f8f4f7;margin-top:8px;font-size:13px}
      @media(max-width:520px){.vx-jalali-selects{grid-template-columns:1fr 1fr 1fr;gap:6px}.vx-jalali-selects select{padding:0 5px;font-size:13px}}
    `;
    document.head.appendChild(style);
  }

  function normalDate(d){
    const x = new Date(d); x.setHours(12,0,0,0); return x;
  }
  function addDays(d, n){
    const x = normalDate(d); x.setDate(x.getDate() + n); return x;
  }
  function iso(d){
    const x = normalDate(d);
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  }
  function fromISO(value){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const [y,m,d] = value.split('-').map(Number);
    return normalDate(new Date(y,m-1,d));
  }
  function jparts(date){
    const out = {};
    jalaliFormatter.formatToParts(normalDate(date)).forEach(p => {
      if (p.type === 'year' || p.type === 'month' || p.type === 'day') out[p.type] = Number(p.value);
    });
    return out;
  }
  function firstOfJMonth(anchor){
    const p = jparts(anchor);
    return addDays(anchor, -(p.day - 1));
  }
  function inRange(key, a, b){ return !!a && !!b && key >= a && key <= b; }
  function classForDate(key, cycle){
    let period = false, fertile = false;
    for (const r of cycle?.ranges || []){
      if (inRange(key, r.period_start, r.period_end)) period = true;
      if (inRange(key, r.fertile_start, r.fertile_end)) fertile = true;
    }
    return period ? 'period-day' : fertile ? 'fertile-day' : '';
  }

  function ensureMonthHead(cal){
    let head = $('#vxJalaliMonthHead');
    if (!head){
      head = document.createElement('div');
      head.id = 'vxJalaliMonthHead';
      head.className = 'vx-jalali-head';
      cal.insertAdjacentElement('beforebegin', head);
    }
    return head;
  }

  function renderCalendar(cycle = latestCycle, anchor = cursor){
    const cal = $('#calendar');
    if (!cal || renderBusy) return;
    renderBusy = true;
    latestCycle = cycle || null;
    cursor = normalDate(anchor || new Date());
    const first = firstOfJMonth(cursor);
    const jp = jparts(first);
    const days = [];
    for (let i=0; i<32; i++){
      const d = addDays(first, i), p = jparts(d);
      if (p.year !== jp.year || p.month !== jp.month) break;
      days.push({date:d, day:p.day});
    }
    const offset = (first.getDay() + 1) % 7;
    const todayKey = iso(new Date());
    let html = weekdays.map(x => `<div class="cal-cell head">${x}</div>`).join('');
    for (let i=0; i<offset; i++) html += '<div class="cal-cell"></div>';
    for (const item of days){
      const key = iso(item.date);
      const cls = [classForDate(key, latestCycle), key === todayKey ? 'today-day' : '', 'vx-jalali-day'].filter(Boolean).join(' ');
      html += `<div class="cal-cell ${cls}" data-gdate="${key}">${fmt(item.day)}</div>`;
    }
    cal.innerHTML = html;
    cal.dataset.vxCalendar = 'jalali';
    const head = ensureMonthHead(cal);
    head.innerHTML = `<strong class="vx-jalali-title">${jalaliLongFormatter.format(first)}</strong><div class="vx-jalali-nav"><button type="button" data-vx-jmonth="-1" aria-label="ماه قبل">›</button><button type="button" data-vx-jmonth="1" aria-label="ماه بعد">‹</button></div>`;

    if (latestCycle?.next_period_date){
      const next = fromISO(latestCycle.next_period_date);
      const el = $('#nextPeriod');
      if (el && next){
        const relative = latestCycle.days_until_next === 0 ? 'امروز' : `${fmt(latestCycle.days_until_next)} روز دیگه`;
        el.textContent = `${relative} · ${jalaliDateFormatter.format(next)}`;
      }
    }
    renderBusy = false;
  }

  async function api(path, options = {}){
    const headers = {'Content-Type':'application/json', ...(options.headers || {})};
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const res = await fetch(path, {...options, headers, cache:'no-store'});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'یه خطا پیش اومد.');
    return data;
  }

  async function refresh(){
    try{
      if (token()){
        const d = await api('/api/wellbeing');
        latestCycle = d.cycle || null;
      }
    }catch(_){ }
    renderCalendar(latestCycle, cursor);
  }

  function findGregorian(jy, jm, jd){
    const start = normalDate(new Date(Number(jy) + 621, 0, 1));
    for (let i=0; i<500; i++){
      const d = addDays(start, i), p = jparts(d);
      if (p.year === Number(jy) && p.month === Number(jm) && p.day === Number(jd)) return d;
    }
    return null;
  }

  function selectOptions(values, selected, labels){
    return values.map((v, i) => `<option value="${v}" ${Number(v)===Number(selected)?'selected':''}>${labels ? labels[i] : fmt(v)}</option>`).join('');
  }

  async function openEditor(){
    let cycle = latestCycle;
    try{ if (token()) cycle = (await api('/api/wellbeing')).cycle || cycle; }catch(_){ }
    const base = cycle?.last_period_date ? fromISO(cycle.last_period_date) : new Date();
    const p = jparts(base || new Date());
    const nowJ = jparts(new Date());
    const years = [nowJ.year, nowJ.year-1, nowJ.year-2, nowJ.year-3];
    const days = Array.from({length:31}, (_,i)=>i+1);
    const modalRoot = $('#modal'), content = $('#modalContent');
    if (!modalRoot || !content) return;
    content.innerHTML = `<p class="kicker">چرخه من</p><h2>تنظیم چرخه</h2><form id="vxJalaliCycleForm" class="modal-form">
      <label>شروع آخرین پریود<div class="vx-jalali-selects">
        <select name="jy" aria-label="سال">${selectOptions(years,p.year)}</select>
        <select name="jm" aria-label="ماه">${selectOptions(Array.from({length:12},(_,i)=>i+1),p.month,monthNames)}</select>
        <select name="jd" aria-label="روز">${selectOptions(days,p.day)}</select>
      </div><div id="vxJDatePreview" class="vx-jalali-date-preview"><span>تاریخ شمسی</span><b>${jalaliDateFormatter.format(base || new Date())}</b></div></label>
      <label>طول معمول چرخه<input type="number" name="cycle_length" min="20" max="45" required value="${cycle?.cycle_length || 28}"></label>
      <label>مدت معمول پریود<input type="number" name="period_length" min="1" max="10" required value="${cycle?.period_length || 5}"></label>
      <p class="vx-help">روزهای باروری و پریود بعدی تخمینی‌ان و برای تصمیم پزشکی یا جلوگیری از بارداری مناسب نیستن.</p>
      <button class="primary-btn" type="submit">ذخیره چرخه</button></form>`;
    modalRoot.classList.remove('hidden'); document.body.style.overflow='hidden';

    const form = $('#vxJalaliCycleForm');
    const updatePreview = () => {
      const f = new FormData(form), d = findGregorian(f.get('jy'), f.get('jm'), f.get('jd'));
      const preview = $('#vxJDatePreview b');
      if (preview) preview.textContent = d ? jalaliDateFormatter.format(d) : 'تاریخ نامعتبر';
    };
    form?.querySelectorAll('select').forEach(s => s.addEventListener('change', updatePreview));
    form?.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form), chosen = findGregorian(fd.get('jy'),fd.get('jm'),fd.get('jd'));
      if (!chosen) return window.toast?.('این تاریخ شمسی معتبر نیست.');
      if (chosen > normalDate(new Date())) return window.toast?.('شروع آخرین پریود نمی‌تونه در آینده باشه.');
      const btn = form.querySelector('button[type="submit"]'); if (btn) btn.disabled = true;
      try{
        const d = await api('/api/cycle',{method:'POST',body:JSON.stringify({
          last_period_date: iso(chosen),
          cycle_length: Number(fd.get('cycle_length')),
          period_length: Number(fd.get('period_length'))
        })});
        latestCycle = d.cycle; cursor = new Date(); renderCalendar(latestCycle, cursor);
        modalRoot.classList.add('hidden'); document.body.style.overflow='';
        window.toast?.('چرخه با تاریخ شمسی ذخیره شد ✓');
      }catch(err){ window.toast?.(err.message); }
      finally{ if (btn) btn.disabled = false; }
    });
  }

  function moveMonth(delta){
    const first = firstOfJMonth(cursor);
    cursor = delta < 0 ? addDays(first, -1) : addDays(first, 32);
    renderCalendar(latestCycle, cursor);
  }

  function bind(){
    document.addEventListener('click', e => {
      const edit = e.target.closest('[data-action="edit-cycle"]');
      if (edit){ e.preventDefault(); e.stopImmediatePropagation(); openEditor(); return; }
      const nav = e.target.closest('[data-vx-jmonth]');
      if (nav){ e.preventDefault(); moveMonth(Number(nav.dataset.vxJmonth)); }
    }, true);

    const observe = () => {
      const cal = $('#calendar');
      if (!cal) return setTimeout(observe, 150);
      const mo = new MutationObserver(() => {
        if (renderBusy || cal.querySelector('.vx-jalali-day')) return;
        clearTimeout(renderTimer); renderTimer = setTimeout(refresh, 40);
      });
      mo.observe(cal, {childList:true});
      refresh();
    };
    observe();
  }

  injectStyle();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once:true});
  else bind();
})();
