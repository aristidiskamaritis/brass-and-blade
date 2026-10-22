/* =========================================================
   Brass & Blade Barbershop — interactions & motion
   Content comes from data.js. Entrances and reveals are CSS (so the page
   never waits on a library); GSAP + ScrollTrigger + Lenis add smooth scrolling,
   parallax and the pinned "kit" row when they load and motion is allowed.
   ========================================================= */
(() => {
  window.__bbReady = true;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const html = document.documentElement;

  const hasGSAP = typeof window.gsap !== "undefined" && typeof window.ScrollTrigger !== "undefined";
  const reduceMotion = !html.classList.contains("force-motion") && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motion = hasGSAP && !reduceMotion;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const store = {
    // Storage is looked up inside try: it throws in private modes and locked-down viewers
    get(k, s = "localStorage") { try { return window[s].getItem(k); } catch { return null; } },
    set(k, v, s = "localStorage") { try { window[s].setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  store.set("bb-intro", "1", "sessionStorage");

  // saved choice → browser language → English
  let lang = store.get("bb-lang") || ((navigator.language || "en").toLowerCase().startsWith("el") ? "el" : "en");
  if (!I18N[lang]) lang = "en";

  const t = (key, vars = {}) => {
    const str = (I18N[lang] && I18N[lang][key]) ?? I18N.en[key] ?? key;
    return typeof str === "string" ? str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "") : str;
  };
  const L = (obj) => (obj ? obj[lang] ?? obj.en : "");
  const eur = (n) => `€${n}`;

  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fromIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const dayLabel = (d, long = false) => `${t(long ? "days" : "daysShort")[d.getDay()]} ${d.getDate()} ${t("months")[d.getMonth()]}`;

  /* =========================================================
     Toast
     ========================================================= */
  const toastEl = $("#toast");
  let toastTimer;
  function toast(msg) {
    toastEl.innerHTML = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
  }

  /* =========================================================
     Opening hours & live status
     ========================================================= */
  function openInfo(now = new Date()) {
    const d = now.getDay();
    const m = now.getHours() * 60 + now.getMinutes();
    const h = HOURS[d];
    if (h && m >= toMin(h[0]) && m < toMin(h[1])) return { open: true, until: h[1] };
    for (let i = 0; i < 8; i++) {
      const dd = (d + i) % 7;
      const hh = HOURS[dd];
      if (!hh || (i === 0 && m >= toMin(hh[0]))) continue;
      const day = i === 0 ? t("status.today") : i === 1 ? t("status.tomorrow") : t("days")[dd];
      return { open: false, day, time: hh[0] };
    }
    return { open: false, day: "", time: "" };
  }

  function renderStatus() {
    const info = openInfo();
    ["#open-status", "#open-status-2"].forEach((sel) => {
      const el = $(sel);
      if (!el) return;
      el.classList.toggle("open", info.open);
      el.classList.toggle("closed", !info.open);
      $(".status-text", el).textContent = info.open ? t("status.open", { time: info.until }) : t("status.closed", { day: info.day, time: info.time });
    });
    const next = nextFreeChair();
    $("#next-free .next-text").textContent = next ? t("status.next", { when: next }) : "";
    $("#next-free").hidden = !next;
  }

  function renderHours() {
    const today = new Date().getDay();
    $("#hours-table tbody").innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const h = HOURS[d];
      return `<tr class="${d === today ? "today" : ""}"${d === today ? ` data-today="${esc(t("visit.today"))}"` : ""}>
        <th scope="row"${d === today ? ` data-today="${esc(t("visit.today"))}"` : ""}>${t("days")[d]}</th>
        <td class="${h ? "" : "closed"}">${h ? `${h[0]} – ${h[1]}` : t("visit.closed")}</td></tr>`;
    }).join("");
  }

  /* =========================================================
     Availability (demo): a repeatable pattern of busy half-hours per
     barber and day, plus anything booked on this device.
     A real site would read this from the booking system instead.
     ========================================================= */
  const CELL = 30;
  const BOOK_DAYS = 21;
  const hash = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return ((h >>> 0) % 10000) / 10000;
  };
  const savedBookings = () => { try { return JSON.parse(store.get("bb-bookings") || "[]"); } catch { return []; } };

  function busy(barberId, iso, start) {
    const day = fromIso(iso).getDay();
    const load = day === 5 || day === 6 ? 0.24 : 0.14;
    if (hash(`${barberId}|${iso}|${start}`) < load) return true;
    return savedBookings().some((b) => b.barber === barberId && b.date === iso && start < b.start + b.mins && start + CELL > b.start);
  }
  const works = (barber, d) => HOURS[d.getDay()] && !barber.off.includes(d.getDay());

  // Is this barber free from `start` for `mins` minutes on `iso`?
  function freeFor(barber, iso, start, mins) {
    const d = fromIso(iso);
    if (!works(barber, d)) return false;
    const [o, c] = HOURS[d.getDay()].map(toMin);
    if (start < o || start + mins > c) return false;
    for (let s = start - (start % CELL); s < start + mins; s += CELL) if (busy(barber.id, iso, s)) return false;
    return true;
  }

  // Slot starts on a day for the chosen barber ("any" = whoever is free)
  function slotsFor(iso, barberId, mins) {
    const d = fromIso(iso);
    const h = HOURS[d.getDay()];
    if (!h) return [];
    const now = new Date();
    const earliest = iso === isoDate(now) ? now.getHours() * 60 + now.getMinutes() + 20 : 0;
    const team = barberId === "any" ? BARBERS : BARBERS.filter((b) => b.id === barberId);
    const out = [];
    for (let s = toMin(h[0]); s + mins <= toMin(h[1]); s += CELL) {
      const free = s >= earliest && team.some((b) => freeFor(b, iso, s, mins));
      out.push({ start: s, free });
    }
    return out;
  }

  function nextFreeChair() {
    const now = new Date();
    for (let i = 0; i < 8; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const slot = slotsFor(isoDate(d), "any", 40).find((s) => s.free);
      if (!slot) continue;
      const when = i === 0 ? t("status.today") : i === 1 ? t("status.tomorrow") : t("days")[d.getDay()];
      return `${when}, ${hhmm(slot.start)}`;
    }
    return "";
  }

  /* =========================================================
     Services price list
     ========================================================= */
  let svcCat = "hair";
  const svcTabs = $$("#svc-tabs [role=tab]");
  const svcPhoto = $(".svc-photo img");

  function renderServices(animate) {
    const list = $("#svc-panel");
    list.setAttribute("aria-labelledby", `tab-${svcCat}`);
    list.innerHTML = SERVICES.filter((s) => s.cat === svcCat).map((s) => `
      <li class="svc-item">
        <div class="svc-row"><span class="svc-name">${esc(L(s.name))}</span><span class="svc-dots" aria-hidden="true"></span></div>
        <span class="svc-price">${eur(s.price)}</span>
        <div class="svc-meta">
          <span class="mins"><svg class="ico"><use href="#i-clock"/></svg>${t("svc.mins", { n: s.mins })}</span>
          ${s.popular ? `<span class="svc-tag">${t("svc.popular")}</span>` : ""}
          <span>${esc(L(s.desc))}</span>
        </div>
        <button type="button" class="svc-add${bk.items.includes(s.id) ? " on" : ""}" data-add="${s.id}" aria-pressed="${bk.items.includes(s.id)}">
          <svg class="ico"><use href="#i-plus"/></svg><span>${bk.items.includes(s.id) ? t("svc.added") : t("svc.add")}</span>
        </button>
      </li>`).join("");
    if (animate) {
      $$(".svc-item", list).forEach((el, i) => {
        el.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 480, delay: i * 45, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
      });
    }
    const cat = SERVICE_CATS.find((c) => c.id === svcCat);
    const src = IMG(cat.img, 900, 1125);
    if (svcPhoto.getAttribute("src") !== src) {
      if (!svcPhoto.getAttribute("src")) svcPhoto.src = src;
      else {
        svcPhoto.classList.add("swap");
        const pre = new Image();
        pre.onload = pre.onerror = () => setTimeout(() => { svcPhoto.src = src; svcPhoto.classList.remove("swap"); }, 220);
        pre.src = src;
      }
    }
    moveInk();
  }

  function moveInk() {
    const active = svcTabs.find((b) => b.dataset.cat === svcCat);
    const ink = $(".tab-ink");
    if (!active || !ink) return;
    ink.style.width = `${active.offsetWidth}px`;
    ink.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  svcTabs.forEach((btn, i) => {
    btn.addEventListener("click", () => selectTab(btn));
    btn.addEventListener("keydown", (e) => {
      const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const next = svcTabs[(i + dir + svcTabs.length) % svcTabs.length];
      next.focus();
      selectTab(next);
    });
  });
  function selectTab(btn) {
    if (btn.dataset.cat === svcCat) return;
    svcCat = btn.dataset.cat;
    svcTabs.forEach((b) => {
      const on = b === btn;
      b.setAttribute("aria-selected", on);
      b.tabIndex = on ? 0 : -1;
    });
    renderServices(true);
  }

  $("#svc-panel").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    const id = btn.dataset.add;
    const had = bk.items.includes(id);
    toggleItem(id);
    renderServices(false);
    if (!had) toast(`${esc(L(SERVICES.find((s) => s.id === id).name))} · <a href="#book" data-goto-book>${t("nav.book")} →</a>`);
  });

  /* =========================================================
     Packages, barbers, kit, gallery, reviews, FAQ
     ========================================================= */
  function renderPackages() {
    $("#pk-grid").innerHTML = PACKAGES.filter((p) => !p.small).map((p) => `
      <article class="pk${p.featured ? " featured" : ""} reveal">
        <span class="pk-tag">${esc(L(p.tag))}</span>
        <h3>${esc(L(p.name))}</h3>
        <span class="pk-mins"><svg class="ico"><use href="#i-clock"/></svg>${t("svc.mins", { n: p.mins })}</span>
        <p class="pk-price"><strong>${eur(p.price)}</strong><s>${eur(p.was)}</s><span class="pk-save">${t("pk.save", { n: p.was - p.price })}</span></p>
        <ul>${L(p.items).map((i) => `<li><svg class="ico"><use href="#i-check"/></svg><span>${esc(i)}</span></li>`).join("")}</ul>
        <button type="button" class="btn ${p.featured ? "btn-brass" : "btn-ghost"}" data-book-item="${p.id}">${t("pk.book")}<svg class="ico"><use href="#i-arrow"/></svg></button>
      </article>`).join("");
  }

  function renderTeam() {
    $("#team-grid").innerHTML = BARBERS.map((b) => `
      <article class="barber reveal" tabindex="-1">
        <figure class="barber-photo">
          <img src="${IMG(b.img, 600, 800)}" srcset="${IMG(b.img, 400, 533)} 400w, ${IMG(b.img, 600, 800)} 600w, ${IMG(b.img, 900, 1200)} 900w" sizes="(max-width: 680px) 46vw, (max-width: 1100px) 45vw, 290px" width="600" height="800" alt="${esc(L(b.name))}" loading="lazy" decoding="async">
          <span class="barber-years"><span><b>${b.years}</b><small>${lang === "el" ? "χρόνια" : "years"}</small></span></span>
          <p class="barber-bio">${esc(L(b.bio))}</p>
        </figure>
        <h3>${esc(L(b.name))}</h3>
        <p class="barber-role">${esc(L(b.role))}</p>
        <ul class="chips">${L(b.skills).map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
        <div class="barber-foot">
          <span class="barber-off"><svg class="ico"><use href="#i-cal"/></svg>${t("team.off", { day: t("days")[b.off[0]] })}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-book-barber="${b.id}">${t("team.book", { name: esc(L(b.acc)) })}</button>
        </div>
      </article>`).join("");
  }

  function renderKit() {
    $("#kit-track").innerHTML = KIT.map((k, i) => `
      <article class="kit-card">
        <figure><img src="${IMG(k.img, 800, 640)}" srcset="${IMG(k.img, 500, 400)} 500w, ${IMG(k.img, 800, 640)} 800w" sizes="(max-width: 680px) 80vw, 400px" width="800" height="640" alt="${esc(L(k.name))}" loading="lazy" decoding="async" draggable="false"></figure>
        <div class="kit-body">
          <span class="kit-num">${String(i + 1).padStart(2, "0")} / ${String(KIT.length).padStart(2, "0")}</span>
          <h3>${esc(L(k.name))}</h3>
          <p>${esc(L(k.desc))}</p>
        </div>
      </article>`).join("");
  }

  function renderGallery() {
    $("#gal-grid").innerHTML = GALLERY.map((g, i) => `
      <button type="button" class="gal-item${g.tall ? " tall" : ""} reveal" data-index="${i}" aria-label="${esc(L(g.alt))}">
        <img src="${IMG(g.img, 700, g.tall ? 933 : 525)}" srcset="${IMG(g.img, 420, g.tall ? 560 : 315)} 420w, ${IMG(g.img, 700, g.tall ? 933 : 525)} 700w" sizes="(max-width: 680px) 46vw, 400px" alt="" loading="lazy" decoding="async">
        <span>${esc(L(g.alt))}</span>
      </button>`).join("");
  }

  let revIndex = 0;
  function renderReviews() {
    $("#rev-track").innerHTML = REVIEWS.map((r, i) => `
      <article class="review" aria-roledescription="slide" aria-label="${i + 1} / ${REVIEWS.length}"${i === revIndex ? "" : ' aria-hidden="true"'}>
        <span class="stars" aria-hidden="true">${'<svg class="ico"><use href="#i-star"/></svg>'.repeat(5)}</span>
        <blockquote>${esc(L(r.text))}</blockquote>
        <footer><span class="review-avatar" aria-hidden="true">${esc(r.name[0])}</span><span><strong>${esc(r.name)}</strong><small>${esc(L(r.service))} · ${esc(L(r.when))}</small></span></footer>
      </article>`).join("");
    showReview(revIndex);
  }
  function showReview(i) {
    revIndex = (i + REVIEWS.length) % REVIEWS.length;
    $("#rev-track").style.transform = `translateX(${-revIndex * 100}%)`;
    $$("#rev-track .review").forEach((el, n) => el.toggleAttribute("aria-hidden", n !== revIndex));
    $("#rev-count").textContent = `${revIndex + 1} / ${REVIEWS.length}`;
  }
  $("#rev-prev").addEventListener("click", () => { showReview(revIndex - 1); revPause = true; });
  $("#rev-next").addEventListener("click", () => { showReview(revIndex + 1); revPause = true; });
  // swipe on phones
  (() => {
    const stage = $(".rev-stage");
    let x0 = null;
    stage.addEventListener("pointerdown", (e) => { x0 = e.clientX; });
    stage.addEventListener("pointerup", (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 40) { showReview(revIndex + (dx < 0 ? 1 : -1)); revPause = true; }
      x0 = null;
    });
  })();
  // auto-advance while visible, until the visitor takes over
  let revPause = false;
  let revVisible = false;
  new IntersectionObserver(([en]) => { revVisible = en.isIntersecting; }, { threshold: 0.4 }).observe($(".rev-stage"));
  $(".rev-stage").addEventListener("mouseenter", () => { revPause = true; });
  setInterval(() => { if (revVisible && !revPause && !document.hidden) showReview(revIndex + 1); }, 6500);

  function renderFaq() {
    $("#faq-list").innerHTML = FAQ.map((f, i) => `
      <div class="faq-item reveal">
        <h3 style="margin:0"><button type="button" class="faq-q" aria-expanded="false" aria-controls="faq-a-${i}" id="faq-q-${i}">${esc(L(f.q))}<span class="pm" aria-hidden="true"></span></button></h3>
        <div class="faq-a" id="faq-a-${i}" role="region" aria-labelledby="faq-q-${i}"><div><p>${esc(L(f.a))}</p></div></div>
      </div>`).join("");
  }
  $("#faq-list").addEventListener("click", (e) => {
    const q = e.target.closest(".faq-q");
    if (!q) return;
    const item = q.closest(".faq-item");
    const open = !item.classList.contains("open");
    item.classList.toggle("open", open);
    q.setAttribute("aria-expanded", open);
    setTimeout(() => window.ScrollTrigger && ScrollTrigger.refresh(), 520);
  });

  /* =========================================================
     Booking
     ========================================================= */
  const ALL_ITEMS = [...PACKAGES, ...SERVICES];
  const itemById = (id) => ALL_ITEMS.find((i) => i.id === id);
  const bk = { step: 1, items: [], barber: "any", date: null, time: null };
  const booker = $("#booker");
  const totalMins = () => bk.items.reduce((n, id) => n + itemById(id).mins, 0);
  const totalPrice = () => bk.items.reduce((n, id) => n + itemById(id).price, 0);
  const barberById = (id) => BARBERS.find((b) => b.id === id);

  function toggleItem(id, only = false) {
    if (only) bk.items = [id];
    else if (bk.items.includes(id)) bk.items = bk.items.filter((x) => x !== id);
    else bk.items.push(id);
    bk.time = null;
    renderBooking();
  }

  function renderPick() {
    const opt = (it) => `
      <button type="button" class="opt" data-item="${it.id}" aria-pressed="${bk.items.includes(it.id)}">
        <span class="opt-box"><svg class="ico"><use href="#i-check"/></svg></span>
        <span class="opt-main"><span class="opt-name">${esc(L(it.name))}</span><span class="opt-sub">${t("svc.mins", { n: it.mins })}</span></span>
        <span class="opt-price">${eur(it.price)}</span>
      </button>`;
    const groups = [
      [t("book.packages"), PACKAGES],
      [t("svc.cat.hair"), SERVICES.filter((s) => s.cat === "hair")],
      [t("svc.cat.beard"), SERVICES.filter((s) => s.cat === "beard")],
      [t("svc.cat.extras"), SERVICES.filter((s) => s.cat === "extras")],
    ];
    $("#pick-services").innerHTML = groups.map(([title, items]) => `
      <div class="pick-group"><h4>${esc(title)}</h4><div class="pick-grid">${items.map(opt).join("")}</div></div>`).join("");
  }
  $("#pick-services").addEventListener("click", (e) => {
    const b = e.target.closest("[data-item]");
    if (!b) return;
    toggleItem(b.dataset.item);
    hideError();
  });

  function renderBarberPick() {
    const any = `
      <button type="button" class="opt bopt" role="radio" data-barber="any" aria-checked="${bk.barber === "any"}">
        <span class="bopt-img"><svg aria-hidden="true"><use href="#i-mark"/></svg></span>
        <span class="opt-name">${t("book.any")}</span><span class="opt-sub">${t("book.anyHint")}</span>
      </button>`;
    $("#pick-barbers").setAttribute("role", "radiogroup");
    $("#pick-barbers").innerHTML = any + BARBERS.map((b) => `
      <button type="button" class="opt bopt" role="radio" data-barber="${b.id}" aria-checked="${bk.barber === b.id}">
        <span class="bopt-img"><img src="${IMG(b.img, 160, 160)}" alt="" loading="lazy"></span>
        <span class="opt-name">${esc(L(b.name).split(" ")[0])}</span>
        <span class="opt-sub">${esc(L(b.role).split(" · ").pop())}</span>
        <span class="opt-off">${t("book.offThatDay", { day: t("days")[b.off[0]] })}</span>
      </button>`).join("");
  }
  $("#pick-barbers").addEventListener("click", (e) => {
    const b = e.target.closest("[data-barber]");
    if (!b) return;
    bk.barber = b.dataset.barber;
    bk.time = null;
    renderBooking();
  });

  function bookDays() {
    const now = new Date();
    return Array.from({ length: BOOK_DAYS }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
  }
  function dayState(d) {
    if (!HOURS[d.getDay()]) return { ok: false, note: t("book.closed") };
    if (bk.barber !== "any" && !works(barberById(bk.barber), d)) return { ok: false, note: t("book.dayOff") };
    const n = slotsFor(isoDate(d), bk.barber, Math.max(totalMins(), CELL)).filter((s) => s.free).length;
    return { ok: n > 0, note: n ? t("book.slotsLeft", { n }) : "—" };
  }

  function renderDates() {
    const days = bookDays();
    const states = days.map(dayState);
    if (!bk.date || !states[days.findIndex((d) => isoDate(d) === bk.date)]?.ok) {
      const first = states.findIndex((s) => s.ok);
      bk.date = first >= 0 ? isoDate(days[first]) : null;
    }
    const wrap = $("#pick-dates");
    const keepScroll = wrap.scrollLeft;
    wrap.innerHTML = days.map((d, i) => {
      const iso = isoDate(d);
      const st = states[i];
      return `<button type="button" class="date" role="option" data-date="${iso}" aria-selected="${iso === bk.date}"${st.ok ? "" : " disabled"} aria-label="${esc(dayLabel(d, true))}">
        <small>${t("daysShort")[d.getDay()]}</small><b>${d.getDate()}</b><em>${esc(st.ok ? t("months")[d.getMonth()] : st.note)}</em></button>`;
    }).join("");
    wrap.scrollLeft = keepScroll;
  }
  $("#pick-dates").addEventListener("click", (e) => {
    const b = e.target.closest("[data-date]");
    if (!b || b.disabled) return;
    bk.date = b.dataset.date;
    bk.time = null;
    renderBooking();
  });
  $$(".dates-btn").forEach((b) => b.addEventListener("click", () => {
    const wrap = $("#pick-dates");
    wrap.scrollBy({ left: Number(b.dataset.dir) * wrap.clientWidth * 0.8, behavior: "smooth" });
  }));

  function renderTimes() {
    const box = $("#pick-times");
    if (!bk.date) { box.innerHTML = `<p class="times-empty">${t("book.noSlots")}</p>`; return; }
    const slots = slotsFor(bk.date, bk.barber, Math.max(totalMins(), CELL));
    if (!slots.some((s) => s.free)) { box.innerHTML = `<p class="times-empty">${t("book.noSlots")}</p>`; return; }
    const groups = [["book.morning", 0, 720], ["book.afternoon", 720, 1020], ["book.evening", 1020, 1440]];
    box.innerHTML = groups.map(([key, a, b]) => {
      const list = slots.filter((s) => s.start >= a && s.start < b);
      if (!list.length) return "";
      return `<div class="time-group"><h4>${t(key)}</h4><div class="time-grid">${list.map((s) =>
        `<button type="button" class="slot" data-time="${hhmm(s.start)}" aria-pressed="${bk.time === hhmm(s.start)}"${s.free ? "" : " disabled"}>${hhmm(s.start)}</button>`).join("")}</div></div>`;
    }).join("");
  }
  $("#pick-times").addEventListener("click", (e) => {
    const b = e.target.closest("[data-time]");
    if (!b || b.disabled) return;
    bk.time = b.dataset.time;
    $$("#pick-times .slot").forEach((s) => s.setAttribute("aria-pressed", s === b));
    renderTicket();
    hideError();
  });

  // Who actually takes an "any barber" booking: the first one free at that time
  const assignedBarber = () => (bk.barber !== "any" ? barberById(bk.barber)
    : BARBERS.find((b) => bk.date && bk.time && freeFor(b, bk.date, toMin(bk.time), totalMins())) || null);

  function renderTicket() {
    $("#ticket-items").innerHTML = bk.items.length
      ? bk.items.map((id) => { const it = itemById(id); return `<li><span>${esc(L(it.name))}</span><span>${eur(it.price)}</span></li>`; }).join("")
      : `<li class="empty">${t("book.empty")}</li>`;
    const rows = [];
    if (bk.items.length) rows.push([t("book.duration"), t("svc.mins", { n: totalMins() })]);
    if (bk.step > 1 || bk.barber !== "any") rows.push([t("book.s2"), bk.barber === "any" ? t("book.any") : L(barberById(bk.barber).name).split(" ")[0]]);
    if (bk.date && bk.step > 2) rows.push([t("book.s3"), `${dayLabel(fromIso(bk.date))}${bk.time ? ` · ${bk.time}` : ""}`]);
    $("#ticket-meta").innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
    const total = $("#ticket-total");
    const next = eur(totalPrice());
    if (total.textContent !== next) {
      total.textContent = next;
      total.animate([{ transform: "translateY(-6px)", opacity: 0.3 }, { transform: "none", opacity: 1 }], { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" });
    }
  }

  function canReach(step) {
    if (step <= 1) return true;
    if (!bk.items.length) return false;
    if (step <= 3) return true;
    return Boolean(bk.date && bk.time);
  }

  function renderSteps() {
    booker.dataset.step = bk.step;
    $$("#book-steps li[data-step]").forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle("is-current", n === bk.step);
      li.classList.toggle("is-done", n < bk.step);
      $("button", li).disabled = n === bk.step || !canReach(n);
      if (n === bk.step) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
    $(".steps-bar i").style.transform = `scaleX(${bk.step / 4})`;
    const next = $("#book-next");
    $("span", next).textContent = bk.step === 4 ? t("book.confirm") : t("book.next");
  }

  function renderBooking() {
    renderPick();
    renderBarberPick();
    renderDates();
    renderTimes();
    renderTicket();
    renderSteps();
    // keep the price list buttons in sync
    $$("#svc-panel [data-add]").forEach((b) => {
      const on = bk.items.includes(b.dataset.add);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on);
      $("span", b).textContent = on ? t("svc.added") : t("svc.add");
    });
  }

  function goStep(n, scroll = true) {
    const back = n < bk.step;
    bk.step = n;
    $$(".pane").forEach((p) => {
      const on = Number(p.dataset.pane) === n;
      p.classList.toggle("is-active", on);
      p.classList.toggle("from-left", on && back);
    });
    hideError();
    renderBooking();
    if (scroll) {
      const top = booker.getBoundingClientRect().top;
      if (top < 0 || top > innerHeight * 0.6) scrollToEl(booker, -90);
    }
  }

  const errEl = $("#book-error");
  function showError(msg) {
    errEl.textContent = msg;
    errEl.classList.remove("shake");
    void errEl.offsetWidth;
    errEl.classList.add("shake");
  }
  function hideError() { errEl.textContent = ""; }

  $("#book-steps").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-step]");
    if (!li || $("button", li).disabled) return;
    goStep(Number(li.dataset.step));
  });
  $("#book-back").addEventListener("click", () => goStep(Math.max(1, bk.step - 1)));
  $("#book-next").addEventListener("click", () => {
    if (bk.step === 1 && !bk.items.length) return showError(t("book.err.items"));
    if (bk.step === 3 && !bk.time) return showError(t("book.err.time"));
    if (bk.step < 4) return goStep(bk.step + 1);
    confirmBooking();
  });

  function validateDetails() {
    const name = $("#bk-name");
    const phone = $("#bk-phone");
    const email = $("#bk-email");
    $$(".details .field").forEach((f) => f.classList.remove("invalid"));
    if (name.value.trim().length < 2) { name.parentNode.classList.add("invalid"); name.focus(); return t("book.err.name"); }
    if (phone.value.replace(/[^\d]/g, "").length < 8) { phone.parentNode.classList.add("invalid"); phone.focus(); return t("book.err.phone"); }
    if (email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { email.parentNode.classList.add("invalid"); email.focus(); return t("book.err.email"); }
    return "";
  }

  let lastBooking = null;
  function confirmBooking() {
    const err = validateDetails();
    if (err) return showError(err);
    const barber = assignedBarber();
    if (!barber) { goStep(3); return showError(t("book.err.time")); }
    lastBooking = {
      barber: barber.id, date: bk.date, start: toMin(bk.time), mins: totalMins(),
      items: bk.items.slice(), price: totalPrice(), anyBarber: bk.barber === "any",
    };
    const all = savedBookings();
    all.push({ barber: lastBooking.barber, date: lastBooking.date, start: lastBooking.start, mins: lastBooking.mins });
    store.set("bb-bookings", JSON.stringify(all.slice(-20)));

    $("#done-text").innerHTML = t("done.text", {
      date: esc(dayLabel(fromIso(bk.date), true)),
      time: bk.time,
      barber: esc(L(barber.acc)),
    });
    openLayer($("#done-modal"));
  }

  function resetBooking() {
    bk.items = [];
    bk.barber = "any";
    bk.time = null;
    $("#book-form").reset();
    $("#bk-remind").checked = true;
    goStep(1, false);
    renderStatus();
  }

  $("#done-close").addEventListener("click", () => { closeLayer($("#done-modal")); resetBooking(); });
  $("#done-ics").addEventListener("click", () => {
    if (!lastBooking) return;
    const pad = (n) => String(n).padStart(2, "0");
    const d = fromIso(lastBooking.date);
    const stamp = (min) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`;
    const what = lastBooking.items.map((id) => L(itemById(id).name)).join(" + ");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Brass & Blade//Demo//EN", "BEGIN:VEVENT",
      `UID:${Date.now()}@brassandblade.demo`,
      `DTSTART:${stamp(lastBooking.start)}`, `DTEND:${stamp(lastBooking.start + lastBooking.mins)}`,
      `SUMMARY:Brass & Blade: ${what}`,
      `DESCRIPTION:${L(barberById(lastBooking.barber).name)} · €${lastBooking.price} (demo booking)`,
      "LOCATION:Zinonos Kitieos 58\\, Larnaca 6022\\, Cyprus",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "brass-and-blade-appointment.ics";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });

  // Booking shortcuts from the rest of the page
  document.addEventListener("click", (e) => {
    const item = e.target.closest("[data-book-item]");
    const barber = e.target.closest("[data-book-barber]");
    const goto = e.target.closest("[data-goto-book]");
    if (item) {
      e.preventDefault();
      bk.items = [item.dataset.bookItem];
      bk.time = null;
      goStep(2, false);
      scrollToEl($("#book"));
    } else if (barber) {
      e.preventDefault();
      bk.barber = barber.dataset.bookBarber;
      bk.time = null;
      goStep(bk.items.length ? 3 : 1, false);
      scrollToEl($("#book"));
    } else if (goto) {
      e.preventDefault();
      toastEl.classList.remove("show");
      scrollToEl($("#book"));
    }
  });

  /* =========================================================
     Layers: modal, lightbox, hire panel (focus kept inside, Esc closes)
     ========================================================= */
  let lastFocus = null;
  function openLayer(el) {
    lastFocus = document.activeElement;
    el.hidden = false;
    html.classList.add("layer-open");
    if (lenis) lenis.stop();
    const f = $("button, a[href], input", el);
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 50);
  }
  function closeLayer(el) {
    el.hidden = true;
    html.classList.remove("layer-open", "hire-open");
    if (lenis) lenis.start();
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }
  document.addEventListener("keydown", (e) => {
    const open = $$(".modal:not([hidden]), .lightbox:not([hidden]), .hire:not([hidden])")[0];
    if (!open) {
      if (e.key === "Escape" && html.classList.contains("nav-open")) setNav(false);
      return;
    }
    if (e.key === "Escape") { open.id === "done-modal" ? $("#done-close").click() : closeLayer(open); }
    if (open.id === "lightbox" && (e.key === "ArrowRight" || e.key === "ArrowLeft")) lbShow(lbIndex + (e.key === "ArrowRight" ? 1 : -1));
    if (e.key === "Tab") {
      const f = $$("button:not([disabled]), a[href], input, textarea", open).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  // Lightbox
  const lb = $("#lightbox");
  let lbIndex = 0;
  function lbShow(i) {
    lbIndex = (i + GALLERY.length) % GALLERY.length;
    const g = GALLERY[lbIndex];
    const img = $(".lb-frame img", lb);
    img.style.opacity = 0;
    img.onload = () => { img.animate([{ opacity: 0, transform: "scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "ease-out" }); img.style.opacity = 1; };
    img.src = IMG(g.img, 1600);
    img.alt = L(g.alt);
    $("figcaption", lb).textContent = `${L(g.alt)} · ${lbIndex + 1} / ${GALLERY.length}`;
  }
  $("#gal-grid").addEventListener("click", (e) => {
    const b = e.target.closest(".gal-item");
    if (!b) return;
    lbShow(Number(b.dataset.index));
    openLayer(lb);
  });
  $(".lb-close", lb).addEventListener("click", () => closeLayer(lb));
  $(".lb-backdrop", lb).addEventListener("click", () => closeLayer(lb));
  $(".lb-prev", lb).addEventListener("click", () => lbShow(lbIndex - 1));
  $(".lb-next", lb).addEventListener("click", () => lbShow(lbIndex + 1));
  (() => {
    let x0 = null;
    lb.addEventListener("pointerdown", (e) => { x0 = e.clientX; });
    lb.addEventListener("pointerup", (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 50) lbShow(lbIndex + (dx < 0 ? 1 : -1));
      x0 = null;
    });
  })();

  // Hire panel ("Want a site like this?")
  const hire = $("#hire-panel");
  $$("[data-hire]").forEach((b) => b.addEventListener("click", () => { html.classList.add("hire-open"); openLayer(hire); }));
  $(".hire-close", hire).addEventListener("click", () => closeLayer(hire));
  $(".hire-backdrop", hire).addEventListener("click", () => closeLayer(hire));
  $(".modal-backdrop").addEventListener("click", () => $("#done-close").click());

  // Placeholder contact links on a demo site
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-ig]")) { e.preventDefault(); toast(t("demo.social")); }
    else if (e.target.closest("[data-tel]")) { e.preventDefault(); toast(t("demo.tel")); }
  });

  /* =========================================================
     Language
     ========================================================= */
  let rendered = false;
  function applyLang() {
    html.lang = lang;
    $$("[data-i18n]").forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
    $$("[data-i18n-label]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nLabel)));
    $$("[data-i18n-ph]").forEach((el) => el.setAttribute("placeholder", t(el.dataset.i18nPh)));
    $$(".lang-switch button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === lang));
    $(".lang-switch").classList.toggle("el", lang === "el");
    $("#hire-email").href = `mailto:aristidiskamaritis@gmail.com?subject=${encodeURIComponent(t("hire.emailSubject"))}`;

    const openFaq = $$(".faq-item.open").map((el) => $$(".faq-item").indexOf(el));
    renderStatus();
    renderHours();
    renderServices(false);
    renderPackages();
    renderTeam();
    renderKit();
    renderGallery();
    renderReviews();
    renderFaq();
    renderBooking();
    openFaq.forEach((i) => { const it = $$(".faq-item")[i]; if (it) { it.classList.add("open"); $(".faq-q", it).setAttribute("aria-expanded", true); } });

    if (rendered) {
      // re-rendered content shows straight away; only the first render animates in
      $$(".reveal:not(.in)").forEach((el) => el.classList.add("in"));
      if (window.ScrollTrigger) ScrollTrigger.refresh();
    }
    rendered = true;
  }
  $$(".lang-switch button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    store.set("bb-lang", lang);
    applyLang();
  }));

  /* =========================================================
     Header, nav, scroll helpers
     ========================================================= */
  const header = $(".site-header");
  const navToggle = $(".nav-toggle");
  function setNav(open) {
    html.classList.toggle("nav-open", open);
    navToggle.setAttribute("aria-expanded", open);
    if (lenis) open ? lenis.stop() : lenis.start();
  }
  navToggle.addEventListener("click", () => setNav(!html.classList.contains("nav-open")));

  let lenis = null;
  function scrollToEl(el, offset = 0) {
    if (!el) return;
    const headerOffset = el.id === "home" ? 0 : -(header.offsetHeight - 6);
    if (lenis) lenis.scrollTo(el, { offset: headerOffset + offset, duration: 1.1 });
    else window.scrollTo({ top: el.getBoundingClientRect().top + scrollY + headerOffset + offset, behavior: reduceMotion ? "auto" : "smooth" });
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.hasAttribute("data-goto-book") || a.hasAttribute("data-ig")) return;
    const id = a.getAttribute("href");
    if (id.length < 2) return;
    const target = $(id);
    if (!target) return;
    e.preventDefault();
    if (html.classList.contains("nav-open")) setNav(false);
    scrollToEl(target);
    history.replaceState(null, "", id);
  });
  $("#to-top").addEventListener("click", () => scrollToEl($("#home")));

  const progress = $(".scroll-progress span");
  const mbar = $("#mbar");
  let lastY = scrollY;
  function onScroll() {
    const y = scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    header.classList.toggle("scrolled", y > 30);
    const goingDown = y > lastY + 4;
    const goingUp = y < lastY - 4;
    if (y > 700 && goingDown && !html.classList.contains("nav-open")) header.classList.add("away");
    else if (goingUp || y < 700) header.classList.remove("away");
    lastY = y;
    mbar.classList.toggle("show", y > innerHeight * 0.7);
    html.classList.toggle("mbar-on", y > innerHeight * 0.7 && !html.classList.contains("mbar-hidden"));
  }
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Hide the phone bar and the hire button while the booking form or footer is on screen
  const awayIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => en.target.__vis = en.isIntersecting);
    const anyVis = [$("#book"), $(".site-footer")].some((el) => el.__vis);
    html.classList.toggle("mbar-hidden", anyVis);
    html.classList.toggle("mbar-on", scrollY > innerHeight * 0.7 && !anyVis);
    html.classList.toggle("fab-away", Boolean($(".site-footer").__vis) || Boolean($("#book").__vis && innerWidth < 681));
  }, { threshold: 0.08 });
  awayIO.observe($("#book"));
  awayIO.observe($(".site-footer"));

  // Highlight the nav link of the section on screen
  const navLinks = $$(".main-nav a[href^='#']");
  const sectIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${en.target.id}`));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  ["home", "services", "packages", "barbers", "kit", "gallery", "visit"].forEach((id) => sectIO.observe($(`#${id}`)));

  /* =========================================================
     Reveals: CSS transitions triggered on scroll, staggered per batch
     ========================================================= */
  // A fully clipped element never counts as "on screen", so clip reveals are watched through their parent
  const revealIO = new IntersectionObserver((entries) => {
    let i = 0;
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const targets = en.target.matches(".reveal") ? [en.target] : $$(".clip-reveal", en.target);
      targets.forEach((el) => {
        el.style.transitionDelay = `${Math.min(i++, 6) * 70}ms`;
        el.classList.add("in");
        setTimeout(() => { el.style.transitionDelay = ""; }, 1400);
      });
      revealIO.unobserve(en.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  const watchReveals = () => {
    $$(".reveal:not(.in)").forEach((el) => revealIO.observe(el));
    new Set($$(".clip-reveal:not(.in)").map((el) => el.parentElement)).forEach((el) => revealIO.observe(el));
  };

  // Count-up numbers in the hero
  function countUp() {
    $$("[data-count]").forEach((el) => {
      const end = parseFloat(el.dataset.count);
      const dec = Number(el.dataset.decimals || 0);
      const suffix = el.dataset.suffix || "";
      const t0 = performance.now();
      const dur = 1400;
      const fmt = (v) => (lang === "el" ? v.toFixed(dec).replace(".", ",") : v.toFixed(dec)) + suffix;
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        el.textContent = fmt(end * (1 - Math.pow(1 - p, 4)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /* =========================================================
     Kit row: drag to scroll on any device; pinned + scrubbed on desktop
     ========================================================= */
  const kitVp = $(".kit-viewport");
  const kitBar = $(".kit-progress i");
  function kitProgress(p) { kitBar.style.transform = `scaleX(${0.1 + 0.9 * Math.max(0, Math.min(1, p))})`; }
  kitVp.addEventListener("scroll", () => {
    if ($("#kit").classList.contains("pinned")) return;
    kitProgress(kitVp.scrollLeft / Math.max(1, kitVp.scrollWidth - kitVp.clientWidth));
  }, { passive: true });
  (() => {
    let down = false; let x0 = 0; let s0 = 0; let moved = false;
    kitVp.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || $("#kit").classList.contains("pinned")) return;
      down = true; moved = false; x0 = e.clientX; s0 = kitVp.scrollLeft;
    });
    addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 4) { moved = true; kitVp.classList.add("dragging"); }
      kitVp.scrollLeft = s0 - dx;
    });
    addEventListener("pointerup", () => { if (!down) return; down = false; kitVp.classList.remove("dragging"); });
    kitVp.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
  })();

  /* =========================================================
     Map: load the iframe only when it comes near the screen
     ========================================================= */
  const mapFrame = $(".visit-map iframe");
  new IntersectionObserver((entries, io) => {
    if (!entries[0].isIntersecting) return;
    mapFrame.src = mapFrame.dataset.src;
    io.disconnect();
  }, { rootMargin: "400px" }).observe(mapFrame);

  /* =========================================================
     Motion layer (GSAP + Lenis)
     ========================================================= */
  function initMotion() {
    gsap.registerPlugin(ScrollTrigger);
    html.classList.add("gsap-on");

    if (typeof window.Lenis !== "undefined") {
      lenis = new Lenis({ duration: 1.05, easing: (x) => 1 - Math.pow(1 - x, 4), smoothWheel: true, wheelMultiplier: 1.05, touchMultiplier: 1.4 });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
      html.classList.add("lenis");
    }

    // Hero: the room drifts and darkens as you scroll away
    gsap.to(".hero-media", { yPercent: 18, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
    const mm = gsap.matchMedia();
    mm.add("(min-width: 961px)", () => {
      gsap.to(".hero-content", { y: -60, opacity: 0.15, ease: "none", scrollTrigger: { trigger: ".hero", start: "40% top", end: "bottom top", scrub: true } });

      // About: the two photos move at different speeds
      gsap.fromTo(".about-img.a2", { y: 60 }, { y: -40, ease: "none", scrollTrigger: { trigger: ".about", start: "top bottom", end: "bottom top", scrub: true } });
      gsap.fromTo(".about-img.a1", { y: -20 }, { y: 30, ease: "none", scrollTrigger: { trigger: ".about", start: "top bottom", end: "bottom top", scrub: true } });

      // Kit: pin the section and slide the cards sideways
      const kit = $("#kit");
      const track = $("#kit-track");
      kit.classList.add("pinned");
      // how far the row must travel so the last card ends one gutter from the right edge
      const dist = () => Math.max(0, track.scrollWidth - (innerWidth - track.getBoundingClientRect().left) + (parseFloat(getComputedStyle(track).paddingRight) || 32));
      const tween = gsap.to(track, {
        x: () => -dist(), ease: "none",
        scrollTrigger: {
          trigger: kit, start: "top top", end: () => `+=${dist()}`, pin: true, scrub: 0.7, invalidateOnRefresh: true,
          onUpdate: (self) => kitProgress(self.progress),
        },
      });
      return () => { tween.scrollTrigger && tween.scrollTrigger.kill(); tween.kill(); gsap.set(track, { clearProps: "x" }); kit.classList.remove("pinned"); };
    });

    gsap.fromTo(".packages-bg img", { yPercent: -10 }, { yPercent: 0, ease: "none", scrollTrigger: { trigger: ".packages", start: "top bottom", end: "bottom top", scrub: true } });
    gsap.fromTo(".footer-wordmark", { yPercent: 40, opacity: 0.2 }, { yPercent: 0, opacity: 1, ease: "none", scrollTrigger: { trigger: ".site-footer", start: "top bottom", end: "bottom bottom", scrub: true } });

    // Magnetic main buttons (mouse only)
    if (finePointer) {
      $$(".magnetic").forEach((btn) => {
        const xTo = gsap.quickTo(btn, "x", { duration: 0.5, ease: "power3.out" });
        const yTo = gsap.quickTo(btn, "y", { duration: 0.5, ease: "power3.out" });
        btn.addEventListener("pointermove", (e) => {
          const r = btn.getBoundingClientRect();
          xTo((e.clientX - r.left - r.width / 2) * 0.25);
          yTo((e.clientY - r.top - r.height / 2) * 0.35);
        });
        btn.addEventListener("pointerleave", () => { xTo(0); yTo(0); });
      });
    }

    addEventListener("load", () => ScrollTrigger.refresh());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
  }

  /* =========================================================
     Start
     ========================================================= */
  $("#year").textContent = new Date().getFullYear();
  applyLang();
  watchReveals();
  if (motion) initMotion();
  setTimeout(countUp, html.classList.contains("no-intro") ? 300 : 1100);
  setInterval(renderStatus, 60000);
  addEventListener("resize", () => { moveInk(); }, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveInk);
})();
