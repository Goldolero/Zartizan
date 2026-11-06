/* Zartizan — application des artisans péi
 * Données : Supabase (tables `artisans` et `demandes`, voir supabase/schema.sql)
 */
(function () {
"use strict";

const METIERS = ["Plomberie","Électricité","Entretien chauffe-eau","Photovoltaïque","Climatisation","Maçonnerie","Peinture","Menuiserie","Autre"];
const COMMUNES = ["Le Tampon","Saint-Pierre","Saint-Louis","Saint-Joseph","Petite-Île","Entre-Deux","L'Étang-Salé","Les Avirons","Saint-Leu","Les Trois-Bassins","Saint-Paul","Le Port","La Possession","Saint-Denis","Sainte-Marie","Sainte-Suzanne","Saint-André","Bras-Panon","Saint-Benoît","Sainte-Rose","Saint-Philippe","La Plaine-des-Palmistes","Salazie","Cilaos"];
const STATUTS = [["nouvelle","Nouvelle"],["attribuee","Attribuée"],["devis","Devis envoyé"],["planifiee","Planifiée"],["terminee","Terminée"],["annulee","Annulée"]];
const STLABEL = Object.fromEntries(STATUTS);
const COLORS = ["#0f766e","#1d4ed8","#c2410c","#7e22ce","#be185d","#4d7c0f","#0369a1","#a16207"];
const VIEWS = [["demandes","📋","Demandes"],["nouvelle","➕","Nouvelle"],["planning","📅","Planning"],["rappels","🔔","Rappels"],["equipe","👥","Équipe"]];

const S = {
  sb: null, session: null, me: "", isAdmin: false,
  artisans: [], demandes: [], loaded: false,
  view: "demandes", filtre: "actives", qui: "tous", _prefill: null, _editing: false
};
try { const h = (location.hash || "").slice(1); if (VIEWS.some(v => v[0] === h)) S.view = h; } catch (e) {}

// ---------- utilitaires ----------
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = new Date(s + "T12:00"); d.setDate(d.getDate() + n); return ymd(d); };
const addMonths = n => { const d = new Date(); d.setMonth(d.getMonth() + n); return ymd(d); };
const JOURS = ["dim.","lun.","mar.","mer.","jeu.","ven.","sam."];
const MOIS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
const fmtDay = s => { const d = new Date(s.slice(0, 10) + "T12:00"); return JOURS[d.getDay()] + " " + d.getDate() + " " + MOIS[d.getMonth()]; };
const fmtRdv = s => s ? fmtDay(s) + (s.length > 10 ? " à " + s.slice(11, 16) : "") : "";
const fmtStamp = ms => { const d = new Date(ms); return d.getDate() + " " + MOIS[d.getMonth()] + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
function ago(ms) { const m = Math.round((Date.now() - ms) / 60000); if (m < 60) return "il y a " + Math.max(m, 1) + " min"; const h = Math.round(m / 60); if (h < 24) return "il y a " + h + " h"; return "il y a " + Math.round(h / 24) + " j"; }
const art = id => S.artisans.find(a => a.id === id);
const artName = id => { const a = art(id); return a ? a.nom : "Non attribuée"; };
function phoneDigits(t) { let d = String(t || "").replace(/\D/g, ""); if (d.startsWith("0")) d = "262" + d.slice(1); return d; }
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600); }
function setView(v) { S.view = v; try { history.replaceState(null, "", "#" + v); } catch (e) {} render(); window.scrollTo(0, 0); }

// camelCase (appli) <-> snake_case (base)
const toSnake = k => k.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
const toCamel = k => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const UUIDS = ["artisanId","origineId","creePar"];
function toRow(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === "id" || k === "createdAt") continue;
    r[toSnake(k)] = (k === "updatedAt" && typeof v === "number") ? new Date(v).toISOString() : (v === "" && UUIDS.includes(k) ? null : v);
  }
  return r;
}
function fromRow(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[toCamel(k)] = v;
  if (o.createdAt) o.createdAt = Date.parse(o.createdAt);
  if (o.updatedAt) o.updatedAt = Date.parse(o.updatedAt);
  ["artisanId","origineId","creePar"].forEach(k => { if (o[k] == null) o[k] = ""; });
  ["rdv","rappelDate"].forEach(k => { if (o[k] == null) o[k] = ""; });
  return o;
}
function hist(d, type, texte, extra) {
  const h = Array.isArray(d.historique) ? d.historique.slice(-40) : [];
  h.push(Object.assign({ t: Date.now(), type, texte, par: S.me || "" }, extra || {}));
  return h;
}

// ---------- accès base ----------
async function run(p, okMsg) {
  let res;
  try { res = await p; } catch (e) { toast("Pas de réseau, réessayez"); return null; }
  if (res && res.error) { toast("Erreur : " + res.error.message); return null; }
  if (okMsg) toast(okMsg);
  return res || {};
}
const D = {
  insert: o => run(S.sb.from("demandes").insert(toRow(o))),
  update: (id, o, msg) => run(S.sb.from("demandes").update(toRow(Object.assign({ updatedAt: Date.now() }, o))).eq("id", id), msg),
  remove: (id, msg) => run(S.sb.from("demandes").delete().eq("id", id), msg)
};
const A = {
  insert: (o, msg) => run(S.sb.from("artisans").insert(toRow(o)), msg),
  update: (id, o, msg) => run(S.sb.from("artisans").update(toRow(o)).eq("id", id), msg),
  remove: (id, msg) => run(S.sb.from("artisans").delete().eq("id", id), msg)
};

async function loadAll() {
  const [a, d] = await Promise.all([
    S.sb.from("artisans").select("*").order("created_at"),
    S.sb.from("demandes").select("*").order("created_at", { ascending: false }).limit(1000)
  ]);
  if (a.error || d.error) { toast("Impossible de charger les données"); return; }
  S.artisans = a.data.map(fromRow);
  S.demandes = d.data.map(fromRow);
  const email = (S.session && S.session.user.email || "").toLowerCase();
  const meA = S.artisans.find(x => (x.email || "").toLowerCase() === email);
  S.me = meA ? meA.id : "";
  S.isAdmin = !!(meA && meA.role === "admin");
  S.loaded = true;
  render(); refreshModal();
}
let reloadT = null;
const scheduleReload = () => { clearTimeout(reloadT); reloadT = setTimeout(loadAll, 250); };

// ---------- démarrage ----------
async function boot() {
  const cfg = window.ZARTIZAN_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
    $("main").innerHTML = `<div class="login"><div class="card"><h2>Configuration manquante</h2>
      <p class="small">Renseigne <b>SUPABASE_URL</b> et <b>SUPABASE_ANON_KEY</b> dans le fichier <code>config.js</code> (voir README).</p></div></div>`;
    return;
  }
  S.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  if (/type=recovery/.test(location.hash)) S.recovery = true;
  const { data } = await S.sb.auth.getSession();
  S.session = data.session;
  if (S.recovery) { if (S.session) showNewPassword(); else showLogin("Lien expiré ou déjà utilisé : redemande un email."); }
  S.sb.auth.onAuthStateChange((ev, session) => {
    const was = !!S.session; S.session = session;
    if (ev === "PASSWORD_RECOVERY") { S.recovery = true; showNewPassword(); return; }
    if (S.recovery) return;
    if (!!session !== was) start();
  });
  if (!S.recovery) start();
}

let channel = null;
function start() {
  if (!S.session) { if (channel) { S.sb.removeChannel(channel); channel = null; } return showLogin(); }
  $("hdr").style.display = ""; $("navwrap").style.display = "";
  S.loaded = false; render();
  loadAll();
  if (!channel) {
    channel = S.sb.channel("zartizan")
      .on("postgres_changes", { event: "*", schema: "public", table: "demandes" }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "artisans" }, scheduleReload)
      .subscribe();
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.session) scheduleReload(); });

function showNewPassword() {
  $("hdr").style.display = "none"; $("navwrap").style.display = "none"; $("modal").innerHTML = "";
  $("main").innerHTML = `<div class="login">
    <div class="logo"><img src="icon-192.png" alt=""><div><b>Zartizan</b><span>Nouveau mot de passe</span></div></div>
    <form id="fpwd" class="card">
      <div class="f"><label>Nouveau mot de passe</label><input name="p1" type="password" autocomplete="new-password" minlength="6" required></div>
      <div class="f"><label>Confirmer</label><input name="p2" type="password" autocomplete="new-password" minlength="6" required></div>
      <div class="actions"><button class="btn" type="submit" style="flex:1">Enregistrer</button></div>
    </form></div>`;
  const f = $("fpwd");
  f.onsubmit = async e => {
    e.preventDefault();
    const a = f.elements.p1.value, b = f.elements.p2.value;
    if (a !== b) { toast("Les deux mots de passe sont différents"); return; }
    const { error } = await S.sb.auth.updateUser({ password: a });
    if (error) { toast(error.message); return; }
    toast("Mot de passe modifié ✓");
    S.recovery = false;
    try { history.replaceState(null, "", location.pathname); } catch (_) {}
    start();
  };
}

function showLogin(msg) {
  $("hdr").style.display = "none"; $("navwrap").style.display = "none"; $("modal").innerHTML = "";
  $("main").innerHTML = `<div class="login">
    <div class="logo"><img src="icon-192.png" alt=""><div><b>Zartizan</b><span>Les artisans péi, ensemble</span></div></div>
    ${msg ? `<div class="banner info">${esc(msg)}</div>` : ""}
    <form id="flog" class="card">
      <div class="f"><label>Email</label><input name="email" type="email" autocomplete="email" required></div>
      <div class="f"><label>Mot de passe</label><input name="pwd" type="password" autocomplete="current-password" minlength="6" required></div>
      <div class="actions"><button class="btn" type="submit" style="flex:1">Se connecter</button></div>
      <button type="button" class="linkbtn" id="signup">Première connexion ? Créer mon mot de passe</button>
      <button type="button" class="linkbtn" id="forgot">Mot de passe oublié</button>
    </form>
    <p class="small">L'accès est réservé aux membres du collectif. Ton email doit avoir été ajouté dans l'onglet « Équipe ».</p>
  </div>`;
  const f = $("flog");
  const vals = () => ({ email: f.elements.email.value.trim(), password: f.elements.pwd.value });
  f.onsubmit = async e => {
    e.preventDefault();
    const { error } = await S.sb.auth.signInWithPassword(vals());
    if (error) toast(error.message.includes("Invalid") ? "Email ou mot de passe incorrect" : error.message);
  };
  $("signup").onclick = async () => {
    const v = vals();
    if (!v.email || v.password.length < 6) { toast("Email + mot de passe (6 caractères min.)"); return; }
    const { data, error } = await S.sb.auth.signUp({ email: v.email, password: v.password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) { toast(error.message); return; }
    if (!data.session) showLogin("Compte créé. Clique sur le lien reçu par email, puis reviens te connecter.");
  };
  $("forgot").onclick = async () => {
    const v = vals(); if (!v.email) { toast("Saisis ton email d'abord"); return; }
    const { error } = await S.sb.auth.resetPasswordForEmail(v.email, { redirectTo: location.origin + location.pathname });
    if (error) toast(/rate|seconds/i.test(error.message) ? "Trop de demandes : réessaie dans une heure" : error.message);
    else showLogin("Email envoyé à " + v.email + ". Ouvre le lien sur cet appareil (pense à regarder les spams).");
  };
}
$("logout").onclick = async () => { await S.sb.auth.signOut(); };

// Bouton « Installer » (Android / Chrome)
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; $("install").style.display = ""; });
$("install").onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $("install").style.display = "none"; };
window.addEventListener("appinstalled", () => { $("install").style.display = "none"; });

// ---------- rendu ----------
function renderNav() {
  const nNew = S.demandes.filter(d => d.statut === "nouvelle").length;
  const nRap = rappelsDus().length;
  $("nav").innerHTML = VIEWS.map(([k, ic, l]) => {
    let b = ""; if (k === "demandes" && nNew) b = `<span class="badge">${nNew}</span>`; if (k === "rappels" && nRap) b = `<span class="badge">${nRap}</span>`;
    return `<button data-v="${k}" class="${S.view === k ? "on" : ""}"><span class="ic">${ic}</span><span>${l}${b}</span></button>`;
  }).join("");
  $("nav").querySelectorAll("button").forEach(b => b.onclick = () => setView(b.dataset.v));
  $("who").textContent = S.me ? artName(S.me) + (S.isAdmin ? " · admin" : "") : (S.session ? S.session.user.email : "");
}

function render() {
  if (!S.session) return;
  renderNav();
  const m = $("main");
  if (!S.loaded) { m.innerHTML = '<div class="empty">Chargement…</div>'; return; }
  if (!S.me) {
    m.innerHTML = `<div class="login"><div class="card"><h2>Accès en attente</h2>
      <p>Ton compte <b>${esc(S.session.user.email)}</b> n'est pas encore dans l'équipe.</p>
      <p class="small">Demande à un membre du collectif de t'ajouter dans l'onglet « Équipe » avec cet email exact, puis recharge l'appli.</p>
      <div class="actions"><button class="btn" id="retry">Réessayer</button></div></div></div>`;
    $("retry").onclick = loadAll; return;
  }
  ({ demandes: vDemandes, nouvelle: vNouvelle, planning: vPlanning, rappels: vRappels, equipe: vEquipe }[S.view] || vDemandes)(m);
}

function demCard(d) {
  const a = art(d.artisanId); const col = a ? a.couleur : "#d6d1c6";
  const transfert = (d.historique || []).some(h => h.type === "transfert");
  return `<div class="card dem" data-id="${esc(d.id)}">
    <div class="bar" style="background:${esc(col)}"></div>
    <div class="body">
      <div class="row between"><span class="title">${esc(d.client || "Client")}</span><span class="pill st-${esc(d.statut)}">${esc(STLABEL[d.statut] || d.statut)}</span></div>
      <div class="small">${esc(d.metier || "")} · ${esc(d.commune || "")}${d.rdv ? " · 📅 " + esc(fmtRdv(d.rdv)) : ""}</div>
      <div class="desc">${esc(d.description || "")}</div>
      <div class="row">
        ${d.urgence === "urgent" ? '<span class="pill urg">Urgent</span>' : ""}
        ${transfert ? '<span class="pill tr">↔ Recommandé par un collègue</span>' : ""}
        <span class="small">${esc(a ? a.nom : "Non attribuée")} · ${esc(ago(d.createdAt || Date.now()))}</span>
      </div>
    </div></div>`;
}
const bindCards = root => root.querySelectorAll(".dem").forEach(c => c.onclick = () => openDetail(c.dataset.id));
const artOptions = (sel, empty) => `<option value="">${esc(empty || "— Non attribuée —")}</option>` +
  S.artisans.map(a => `<option value="${esc(a.id)}" ${a.id === sel ? "selected" : ""}>${esc(a.nom)} (${esc(a.metier || "")})</option>`).join("");

function vDemandes(m) {
  const F = [["actives","En cours"],["nouvelle","Nouvelles"],["planifiee","Planifiées"],["terminee","Terminées"],["toutes","Toutes"]];
  let list = S.demandes.slice();
  if (S.filtre === "actives") list = list.filter(d => !["terminee","annulee"].includes(d.statut));
  else if (S.filtre !== "toutes") list = list.filter(d => d.statut === S.filtre);
  if (S.isAdmin && S.qui === "moi") list = list.filter(d => d.artisanId && d.artisanId === S.me);
  if (S.isAdmin && S.qui === "libre") list = list.filter(d => !d.artisanId);
  const ord = { nouvelle: 0, attribuee: 1, devis: 2, planifiee: 3, terminee: 4, annulee: 5 };
  list.sort((a, b) => (b.urgence === "urgent") - (a.urgence === "urgent") || (ord[a.statut] - ord[b.statut]) || (b.createdAt || 0) - (a.createdAt || 0));
  m.innerHTML = `<h2>${S.isAdmin ? "Demandes" : "Mes demandes"}</h2>
    <div class="chips">${F.map(([k, l]) => `<button class="chip ${S.filtre === k ? "on" : ""}" data-f="${k}">${l}</button>`).join("")}</div>
    ${S.isAdmin ? `<div class="chips">${[["tous","Tout le monde"],["moi","Mes demandes"],["libre","Non attribuées"]].map(([k, l]) => `<button class="chip ${S.qui === k ? "on" : ""}" data-q="${k}">${l}</button>`).join("")}</div>` : ""}
    ${list.length ? list.map(demCard).join("") : `<div class="empty">Aucune demande ici.<br><br><button class="btn" id="go-new">➕ Saisir une demande</button></div>`}`;
  m.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { S.filtre = b.dataset.f; render(); });
  m.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { S.qui = b.dataset.q; render(); });
  const g = $("go-new"); if (g) g.onclick = () => setView("nouvelle");
  bindCards(m);
}

function vNouvelle(m) {
  const p = S._prefill || {}; S._prefill = null;
  m.innerHTML = `<h2>${p.origineId ? "Nouvelle demande (entretien)" : "Nouvelle demande"}</h2>
  <form id="fnew" class="card">
    <div class="grid2">
      <div class="f"><label>Nom du client *</label><input name="client" required value="${esc(p.client || "")}"></div>
      <div class="f"><label>Téléphone *</label><input name="tel" type="tel" required value="${esc(p.tel || "")}" placeholder="0692 …"></div>
    </div>
    <div class="grid2">
      <div class="f"><label>Commune</label><input name="commune" list="dl-communes" value="${esc(p.commune || "")}"></div>
      <div class="f"><label>Adresse</label><input name="adresse" value="${esc(p.adresse || "")}"></div>
    </div>
    <div class="grid2">
      <div class="f"><label>Métier</label><select name="metier">${METIERS.map(x => `<option ${x === (p.metier || "") ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
      <div class="f"><label>Urgence</label><select name="urgence"><option value="normale">Normale</option><option value="urgent">Urgent (panne, fuite…)</option></select></div>
    </div>
    <div class="f"><label>Description du besoin *</label><textarea name="description" required placeholder="Ex : chauffe-eau 200 L qui fuit, installé en 2015…">${esc(p.description || "")}</textarea></div>
    <div class="grid2">
      ${S.isAdmin ? `<div class="f"><label>Attribuer à</label><select name="artisanId">${artOptions(p.artisanId || "")}</select></div>` : ""}
      <div class="f"><label>Source</label><select name="source">${["Appel direct","Bouche-à-oreille","Facebook","Site / formulaire","Client existant","Autre"].map(x => `<option ${x === (p.source || "") ? "selected" : ""}>${x}</option>`).join("")}</select></div>
    </div>
    <div class="actions"><button class="btn" type="submit">Enregistrer la demande</button></div>
  </form>
  <datalist id="dl-communes">${COMMUNES.map(c => `<option value="${esc(c)}">`).join("")}</datalist>`;
  const f = $("fnew"), E = f.elements;
  if (!p.metier && art(S.me) && METIERS.includes(art(S.me).metier)) E.metier.value = art(S.me).metier;
  f.onsubmit = async e => {
    e.preventDefault();
    const now = Date.now(), aid = S.isAdmin ? E.artisanId.value : S.me;
    const doc = {
      client: E.client.value.trim(), tel: E.tel.value.trim(), commune: E.commune.value.trim(), adresse: E.adresse.value.trim(),
      metier: E.metier.value, urgence: E.urgence.value, description: E.description.value.trim(), source: E.source.value,
      artisanId: aid, statut: aid ? "attribuee" : "nouvelle", rdv: "", rappelDate: "", rappelFait: false,
      origineId: p.origineId || "", creePar: S.me, updatedAt: now,
      historique: [{ t: now, type: "creation", texte: "Demande créée" + (aid ? " et attribuée à " + artName(aid) : ""), par: S.me }]
    };
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    const ok = await D.insert(doc);
    btn.disabled = false;
    if (ok) {
      toast("Demande enregistrée ✓");
      if (p.origineId) await D.update(p.origineId, { rappelFait: true });
      setView("demandes"); scheduleReload();
    }
  };
}

function vPlanning(m) {
  const t = todayStr(), lim = addDays(t, 21);
  let list = S.demandes.filter(d => d.rdv && !["terminee","annulee"].includes(d.statut));
  if (S.isAdmin && S.qui === "moi") list = list.filter(d => d.artisanId === S.me);
  list.sort((a, b) => a.rdv.localeCompare(b.rdv));
  const late = list.filter(d => d.rdv.slice(0, 10) < t);
  const up = list.filter(d => d.rdv.slice(0, 10) >= t && d.rdv.slice(0, 10) <= lim);
  const groups = {}; up.forEach(d => (groups[d.rdv.slice(0, 10)] = groups[d.rdv.slice(0, 10)] || []).push(d));
  const aPlanifier = S.demandes.filter(d => ["attribuee","devis"].includes(d.statut) && !d.rdv && (!S.isAdmin || S.qui !== "moi" || d.artisanId === S.me));
  m.innerHTML = `<h2>${S.isAdmin ? "Planning" : "Mon planning"} (3 semaines)</h2>
   <div class="chips" style="${S.isAdmin ? "" : "display:none"}">${[["tous","Toute l'équipe"],["moi","Mon planning"]].map(([k, l]) => `<button class="chip ${(S.qui === "moi") === (k === "moi") ? "on" : ""}" data-q="${k}">${l}</button>`).join("")}</div>
   <div class="row" style="margin-bottom:6px">${S.artisans.map(a => `<span class="small"><span class="dot" style="background:${esc(a.couleur)}"></span> ${esc(a.nom)}</span>`).join("")}</div>
   ${late.length ? `<div class="day late">⚠ RDV passés non clôturés</div>${late.map(demCard).join("")}` : ""}
   ${Object.keys(groups).length ? Object.keys(groups).map(k => `<div class="day">${k === t ? "Aujourd'hui · " : ""}${esc(fmtDay(k))}</div>${groups[k].map(demCard).join("")}`).join("") : `<div class="empty">Aucun rendez-vous prévu dans les 3 semaines.</div>`}
   ${aPlanifier.length ? `<h3>À planifier (${aPlanifier.length})</h3>${aPlanifier.map(demCard).join("")}` : ""}`;
  m.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { S.qui = b.dataset.q; render(); });
  bindCards(m);
}

function rappelsDus() { const lim = addDays(todayStr(), 30); return S.demandes.filter(d => d.rappelDate && !d.rappelFait && d.rappelDate <= lim); }
function vRappels(m) {
  const t = todayStr();
  const dus = rappelsDus().sort((a, b) => a.rappelDate.localeCompare(b.rappelDate));
  const futurs = S.demandes.filter(d => d.rappelDate && !d.rappelFait && d.rappelDate > addDays(t, 30)).sort((a, b) => a.rappelDate.localeCompare(b.rappelDate));
  const row = (d, due) => `<div class="card"><div class="row between"><span class="title">${esc(d.client)}</span><span class="pill ${d.rappelDate < t ? "urg" : "st-planifiee"}">${esc(fmtDay(d.rappelDate))}</span></div>
     <div class="small">${esc(d.metier)} · ${esc(d.commune)} · dernier passage : ${esc(artName(d.artisanId))}</div>
     <div class="links" style="margin-top:6px"><a href="tel:${esc(d.tel)}">📞 ${esc(d.tel)}</a><a href="https://wa.me/${esc(phoneDigits(d.tel))}" target="_blank" rel="noopener">WhatsApp</a></div>
     ${due ? `<div class="actions"><button class="btn sm" data-new="${esc(d.id)}">Créer la demande d'entretien</button><button class="btn sec sm" data-skip="${esc(d.id)}">Ignorer</button><button class="btn sec sm" data-open="${esc(d.id)}">Historique</button></div>` : ""}</div>`;
  m.innerHTML = `<h2>Rappels d'entretien</h2>
   <p class="small">Quand vous clôturez une intervention, programmez un rappel (ex. entretien chauffe-eau tous les 12 mois). Les clients à recontacter dans les 30 jours apparaissent ici.</p>
   ${dus.length ? dus.map(d => row(d, true)).join("") : `<div class="empty">Aucun client à recontacter pour l'instant.</div>`}
   ${futurs.length ? `<h3>À venir (${futurs.length})</h3>${futurs.slice(0, 30).map(d => row(d, false)).join("")}` : ""}`;
  m.querySelectorAll("[data-new]").forEach(b => b.onclick = () => {
    const d = S.demandes.find(x => x.id === b.dataset.new); if (!d) return;
    S._prefill = { client: d.client, tel: d.tel, commune: d.commune, adresse: d.adresse, metier: d.metier, artisanId: d.artisanId, source: "Client existant",
      description: "Entretien périodique — " + (d.metier || "") + ". Dernière intervention : " + (d.description || "").slice(0, 120), origineId: d.id };
    setView("nouvelle");
  });
  m.querySelectorAll("[data-skip]").forEach(b => b.onclick = async () => { if (await D.update(b.dataset.skip, { rappelFait: true }, "Rappel ignoré")) scheduleReload(); });
  m.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openDetail(b.dataset.open));
}

function vEquipe(m) {
  if (!S.isAdmin) {
    const mine = S.demandes.filter(d => d.artisanId === S.me);
    m.innerHTML = `<h2>Équipe</h2>
     <div class="stats">
       <div class="stat"><b>${mine.filter(d => !["terminee","annulee"].includes(d.statut)).length}</b><span>mes demandes en cours</span></div>
       <div class="stat"><b>${mine.filter(d => d.statut === "terminee").length}</b><span>mes interventions terminées</span></div>
       <div class="stat"><b>${mine.filter(d => (d.historique || []).some(h => h.type === "transfert" && h.vers === S.me)).length}</b><span>clients reçus de collègues</span></div>
     </div>
     <h3>Mes collègues</h3>
     ${S.artisans.filter(a => a.id !== S.me).map(a => `<div class="card"><div class="row between"><span><span class="dot" style="background:${esc(a.couleur)}"></span> <b>${esc(a.nom)}</b></span><span class="small">${esc(a.metier || "")}</span></div>
       ${a.tel ? `<div class="links" style="margin-top:6px"><a href="tel:${esc(a.tel)}">📞 ${esc(a.tel)}</a><a href="https://wa.me/${esc(phoneDigits(a.tel))}" target="_blank" rel="noopener">WhatsApp</a></div>` : ""}
       ${a.zone ? `<div class="small">Zone : ${esc(a.zone)}</div>` : ""}</div>`).join("") || `<div class="empty">Pas encore de collègues.</div>`}`;
    return;
  }
  const st = S.artisans.map(a => {
    const mine = S.demandes.filter(d => d.artisanId === a.id);
    let envoyes = 0, recus = 0;
    S.demandes.forEach(d => (d.historique || []).forEach(h => { if (h.type === "transfert") { if (h.de === a.id) envoyes++; if (h.vers === a.id) recus++; } }));
    return { a, faites: mine.filter(d => d.statut === "terminee").length, encours: mine.filter(d => !["terminee","annulee"].includes(d.statut)).length, envoyes, recus };
  });
  let totalTr = 0; S.demandes.forEach(d => (d.historique || []).forEach(h => { if (h.type === "transfert") totalTr++; }));
  const ca = S.demandes.filter(d => d.statut === "terminee").reduce((s, d) => s + (Number(d.montant) || 0), 0);
  m.innerHTML = `<h2>Équipe</h2>
   <div class="stats">
     <div class="stat"><b>${S.demandes.filter(d => d.statut === "terminee").length}</b><span>interventions terminées</span></div>
     <div class="stat"><b>${totalTr}</b><span>clients échangés entre vous</span></div>
     <div class="stat"><b>${Math.round(ca).toLocaleString("fr-FR")} €</b><span>facturé via Zartizan</span></div>
   </div>
   <div class="card" style="overflow-x:auto"><table>
     <tr><th>Artisan</th><th class="n">En cours</th><th class="n">Terminées</th><th class="n">Envoyés</th><th class="n">Reçus</th><th></th></tr>
     ${st.map(x => `<tr><td><span class="dot" style="background:${esc(x.a.couleur)}"></span> <b>${esc(x.a.nom)}</b><br><span class="small">${esc(x.a.metier || "")} · ${esc(x.a.tel || "")}</span></td>
       <td class="n">${x.encours}</td><td class="n">${x.faites}</td><td class="n">${x.envoyes}</td><td class="n">${x.recus}</td>
       <td class="n">${x.a.role === "admin" ? '<span class="pill st-planifiee">admin</span> ' : ""}<button class="btn sec sm" data-edit="${esc(x.a.id)}">Modifier</button></td></tr>`).join("")}
   </table></div>
   <h3 id="fa-title">Ajouter un artisan</h3>
   <p class="hint">L'artisan pourra ensuite se connecter avec cet email (bouton « Première connexion »).</p>
   <form id="fart" class="card">
     <input type="hidden" name="aid">
     <div class="grid2">
       <div class="f"><label>Nom / entreprise *</label><input name="nom" required></div>
       <div class="f"><label>Email de connexion *</label><input name="email" type="email" required></div>
     </div>
     <div class="grid2">
       <div class="f"><label>Métier</label><select name="metier">${METIERS.map(x => `<option>${esc(x)}</option>`).join("")}</select></div>
       <div class="f"><label>Téléphone</label><input name="tel" type="tel"></div>
     </div>
     <div class="grid2">
       <div class="f"><label>Zone d'intervention</label><input name="zone" placeholder="Sud, Ouest, toute l'île…"></div>
       <div class="f"><label>Rôle</label><select name="role"><option value="artisan">Artisan (voit ses demandes)</option><option value="admin">Admin (voit tout)</option></select></div>
     </div>
     <div class="actions"><button class="btn" type="submit">Enregistrer</button><button class="btn sec" type="button" id="fa-cancel" style="display:none">Annuler</button><button class="btn danger" type="button" id="fa-del" style="display:none">Retirer de l'équipe</button></div>
   </form>`;
  const f = $("fart"), E = f.elements;
  const reset = () => { f.reset(); E.aid.value = ""; $("fa-title").textContent = "Ajouter un artisan"; $("fa-cancel").style.display = "none"; $("fa-del").style.display = "none"; };
  m.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
    const a = art(b.dataset.edit); if (!a) return;
    E.aid.value = a.id; E.nom.value = a.nom || ""; E.email.value = a.email || ""; E.metier.value = METIERS.includes(a.metier) ? a.metier : "Autre"; E.tel.value = a.tel || ""; E.zone.value = a.zone || ""; E.role.value = a.role === "admin" ? "admin" : "artisan";
    $("fa-title").textContent = "Modifier " + a.nom; $("fa-cancel").style.display = ""; $("fa-del").style.display = a.id === S.me ? "none" : ""; f.scrollIntoView({ behavior: "smooth" });
  });
  $("fa-cancel").onclick = reset;
  $("fa-del").onclick = () => {
    const id = E.aid.value; const a = art(id); if (!a) return;
    confirmBox(`Retirer ${a.nom} de l'équipe ? Il n'aura plus accès à l'appli. Ses demandes resteront, « non attribuées ».`, async () => {
      if (await A.remove(id, "Artisan retiré")) { reset(); scheduleReload(); }
    });
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const body = { nom: E.nom.value.trim(), email: E.email.value.trim().toLowerCase(), metier: E.metier.value, tel: E.tel.value.trim(), zone: E.zone.value.trim(), role: E.role.value };
    if (E.aid.value === S.me && body.role !== "admin") { toast("Tu ne peux pas retirer ton propre rôle admin"); return; }
    let ok;
    if (E.aid.value) ok = await A.update(E.aid.value, body, "Artisan modifié ✓");
    else { body.couleur = COLORS[S.artisans.length % COLORS.length]; ok = await A.insert(body, "Artisan ajouté ✓"); }
    if (ok) { reset(); scheduleReload(); }
  };
}

// ---------- fiche demande ----------
let OPEN = null;
function closeModal() { OPEN = null; $("modal").innerHTML = ""; }
function refreshModal() { if (OPEN && !S._editing && $("d-st")) openDetail(OPEN); }
function confirmBox(msg, onYes) {
  $("modal").innerHTML = `<div class="overlay"><div class="sheet"><p>${esc(msg)}</p><div class="actions"><button class="btn danger" id="cb-y">Confirmer</button><button class="btn sec" id="cb-n">Annuler</button></div></div></div>`;
  $("cb-n").onclick = () => { $("modal").innerHTML = ""; if (OPEN) openDetail(OPEN); };
  $("cb-y").onclick = async () => { $("modal").innerHTML = ""; await onYes(); if (OPEN) openDetail(OPEN); };
}

function openDetail(id) {
  const d = S.demandes.find(x => x.id === id); if (!d) { closeModal(); return; }
  OPEN = id;
  const others = S.artisans.filter(a => a.id !== d.artisanId);
  const maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([d.adresse, d.commune, "La Réunion"].filter(Boolean).join(", "));
  $("modal").innerHTML = `<div class="overlay" id="ov"><div class="sheet">
    <div class="row between"><h2 style="margin:0">${esc(d.client)}</h2><button class="btn sec sm" id="x">Fermer</button></div>
    <div class="row" style="margin:8px 0"><span class="pill st-${esc(d.statut)}">${esc(STLABEL[d.statut])}</span>${d.urgence === "urgent" ? '<span class="pill urg">Urgent</span>' : ""}<span class="small">${esc(d.metier)} · ${esc(d.source || "")}</span></div>
    <div class="links"><a href="tel:${esc(d.tel)}">📞 ${esc(d.tel)}</a><a href="https://wa.me/${esc(phoneDigits(d.tel))}" target="_blank" rel="noopener">💬 WhatsApp</a><a href="${esc(maps)}" target="_blank" rel="noopener">📍 Itinéraire</a></div>
    <p class="small" style="margin:6px 0">${esc(d.adresse || "")} ${esc(d.commune || "")}</p>
    <div class="card" style="background:#faf8f3">${esc(d.description).replace(/\n/g, "<br>")}</div>
    <div class="grid2">
      <div class="f"><label>Statut</label><select id="d-st">${STATUTS.map(([k, l]) => `<option value="${k}" ${k === d.statut ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="f"><label>Artisan</label><select id="d-art" ${S.isAdmin ? "" : "disabled"}>${artOptions(d.artisanId)}</select></div>
    </div>
    <div class="grid2">
      <div class="f"><label>Rendez-vous</label><input type="datetime-local" id="d-rdv" value="${esc(d.rdv || "")}"></div>
      <div class="f"><label>Montant devis / facturé (€)</label><input type="number" step="1" inputmode="decimal" id="d-mt" value="${esc(d.montant == null ? "" : d.montant)}"></div>
    </div>
    <div class="actions" style="margin-top:0"><button class="btn" id="d-save">Enregistrer</button>
      ${d.statut !== "terminee" ? `<button class="btn sec" id="d-done">✓ Terminer l'intervention</button>` : ""}</div>

    <h3>↔ Recommander à un collègue</h3>
    ${others.length ? `<div class="grid2"><div class="f"><select id="t-to">${others.map(a => `<option value="${esc(a.id)}">${esc(a.nom)} (${esc(a.metier || "")})</option>`).join("")}</select></div>
      <div class="f"><select id="t-mode"><option value="transfer">Lui confier la demande</option><option value="new">Créer une demande en plus (autre besoin)</option></select></div></div>
      <div class="f"><input id="t-note" placeholder="Note pour le collègue (ex : tableau électrique vétuste, client OK pour devis)"></div>
      <button class="btn warn" id="t-go">Envoyer au collègue</button>` : `<p class="small">Ajoutez d'autres artisans dans l'onglet Équipe.</p>`}

    <h3>Notes & historique</h3>
    <div class="row"><input id="n-txt" placeholder="Ajouter une note…" style="flex:1"><button class="btn sec" id="n-add">Ajouter</button></div>
    <div class="hist">${(d.historique || []).slice().reverse().map(h => `<div><span class="when">${esc(fmtStamp(h.t))} · ${esc(h.par ? artName(h.par) : "")}</span><br>${esc(h.texte)}</div>`).join("")}</div>
    ${d.rappelDate ? `<p class="small">🔔 Rappel d'entretien : ${esc(fmtDay(d.rappelDate))}${d.rappelFait ? " (traité)" : ""}</p>` : ""}
    ${S.isAdmin ? `<div class="actions"><button class="btn danger sm" id="d-del">Supprimer la demande</button></div>` : ""}
  </div></div>`;
  $("x").onclick = closeModal;
  $("ov").onclick = e => { if (e.target.id === "ov") closeModal(); };
  ["d-st","d-art","d-rdv","d-mt","t-note","n-txt"].forEach(k => { const el = $(k); if (el) { el.onfocus = () => S._editing = true; el.onblur = () => setTimeout(() => S._editing = false, 300); } });
  const cur = () => S.demandes.find(x => x.id === id) || d;
  const after = ok => { if (ok) scheduleReload(); return ok; };

  $("d-save").onclick = async () => {
    const c = cur();
    let st = $("d-st").value; const aid = S.isAdmin ? $("d-art").value : (c.artisanId || ""), rdv = $("d-rdv").value, mt = $("d-mt").value;
    const ch = [];
    if (aid !== (c.artisanId || "")) { ch.push("Attribuée à " + artName(aid)); if (st === "nouvelle" && aid) st = "attribuee"; }
    if (rdv !== (c.rdv || "")) { ch.push(rdv ? "RDV fixé : " + fmtRdv(rdv) : "RDV supprimé"); if (rdv && ["nouvelle","attribuee","devis"].includes(st)) st = "planifiee"; }
    if (st !== c.statut) ch.push("Statut : " + STLABEL[st]);
    const mtv = mt === "" ? null : Number(mt);
    if (mtv !== (c.montant == null ? null : Number(c.montant))) ch.push("Montant : " + (mtv == null ? "—" : mtv + " €"));
    if (!ch.length) { toast("Rien à enregistrer"); return; }
    S._editing = false;
    after(await D.update(id, { statut: st, artisanId: aid, rdv, montant: mtv, historique: hist(c, "maj", ch.join(" · ")) }, "Enregistré ✓"));
  };

  const dd = $("d-done"); if (dd) dd.onclick = () => {
    $("modal").innerHTML = `<div class="overlay"><div class="sheet"><h2>Terminer l'intervention</h2>
      <div class="f"><label>Programmer un rappel d'entretien ?</label><select id="r-m"><option value="0">Pas de rappel</option><option value="6">Dans 6 mois</option><option value="12" ${/chauffe-eau|clim|photovolt/i.test(d.metier) ? "selected" : ""}>Dans 12 mois</option><option value="24">Dans 24 mois</option></select></div>
      <div class="f"><label>Montant facturé (€)</label><input type="number" inputmode="decimal" id="r-mt" value="${esc(d.montant == null ? "" : d.montant)}"></div>
      <div class="actions"><button class="btn" id="r-ok">Valider</button><button class="btn sec" id="r-no">Annuler</button></div></div></div>`;
    $("r-no").onclick = () => openDetail(id);
    $("r-ok").onclick = async () => {
      const c = cur(); const n = Number($("r-m").value); const rd = n ? addMonths(n) : ""; const mt = $("r-mt").value;
      await D.update(id, { statut: "terminee", rappelDate: rd, rappelFait: false, montant: mt === "" ? (c.montant == null ? null : Number(c.montant)) : Number(mt),
        historique: hist(c, "fin", "Intervention terminée" + (rd ? " · rappel le " + fmtDay(rd) : "")) }, "Intervention terminée ✓");
      await loadAll(); openDetail(id);
    };
  };

  const tg = $("t-go"); if (tg) tg.onclick = async () => {
    const c = cur(); const to = $("t-to").value, mode = $("t-mode").value, note = $("t-note").value.trim();
    if (!to) return;
    const de = S.me || c.artisanId || "";
    const extra = { de, vers: to };
    const texte = "Recommandé par " + artName(de) + " à " + artName(to) + (note ? " : « " + note + " »" : "");
    if (mode === "transfer") {
      after(await D.update(id, { artisanId: to, statut: ["terminee","annulee"].includes(c.statut) ? c.statut : "attribuee", rdv: "", historique: hist(c, "transfert", texte, extra) }, "Demande confiée à " + artName(to) + " ✓"));
    } else {
      const a = art(to); const now = Date.now();
      const ok = await D.insert({ client: c.client, tel: c.tel, commune: c.commune || "", adresse: c.adresse || "", metier: (a && METIERS.includes(a.metier)) ? a.metier : "Autre",
        urgence: "normale", description: note || ("Besoin repéré lors de l'intervention : " + (c.description || "").slice(0, 100)), source: "Recommandation collègue",
        artisanId: to, statut: "attribuee", rdv: "", rappelDate: "", rappelFait: false, origineId: id, creePar: S.me, updatedAt: now,
        historique: [Object.assign({ t: now, type: "transfert", texte, par: S.me }, extra)] });
      if (ok) { toast("Nouvelle demande créée pour " + artName(to) + " ✓"); after(await D.update(id, { historique: hist(c, "note", "A recommandé le client à " + artName(to) + (note ? " : « " + note + " »" : "")) })); }
    }
  };

  $("n-add").onclick = async () => {
    const t = $("n-txt").value.trim(); if (!t) return; S._editing = false;
    after(await D.update(id, { historique: hist(cur(), "note", t) }, "Note ajoutée"));
  };
  if ($("d-del")) $("d-del").onclick = () => confirmBox("Supprimer définitivement la demande de " + d.client + " ?", async () => {
    if (await D.remove(id, "Demande supprimée")) { closeModal(); scheduleReload(); }
  });
}

boot();
})();
