/* Finanças Família — controlo financeiro (vanilla JS).
   Dados: cópia local (localStorage) + sincronização na nuvem quando corre como página do claude.ai (capability db). */
"use strict";

const STORE_KEY = "impactfinance_v2";
const USER_KEY = "finance_user";
const SESSION_KEY = "finance_logged_in";
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const MESES_CURTOS = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const CORES = ["--c1","--c2","--c3","--c4","--c5","--c6","--c7","--c8"].map(v => `var(${v})`);

const $ = (id) => document.getElementById(id);
try { if (!document.documentElement.dataset.tema) document.documentElement.dataset.tema = localStorage.getItem("fin_tema") || "roxo"; } catch (e) { document.documentElement.dataset.tema = "roxo"; }
// Corre como página (artifact) do claude.ai? Aí há window.claude.use e a nuvem sincroniza entre aparelhos.
const NO_CLAUDE = typeof window.claude === "object" && typeof window.claude?.use === "function";
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const eur = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
const fmt = (v) => eur.format(v || 0);
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtBRL = (v) => brl.format(v || 0);
const fmtTaxa = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtMoeda = (v, moeda) => (moeda === "BRL" ? fmtBRL(v) : fmt(v));
const r2 = (v) => Math.round(v * 100) / 100;
const CAMBIO_API = "https://economia.awesomeapi.com.br/json/last/EUR-BRL";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- Datas (como texto, sem problemas de fuso horário) ---------- */
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const mesDe = (data) => data.slice(0, 7);
function somarMeses(ym, n) {
  let [y, m] = ym.split("-").map(Number);
  m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
function somarMesesData(data, n) {
  const ym = somarMeses(mesDe(data), n);
  const [y, m] = ym.split("-").map(Number);
  const dia = Math.min(Number(data.slice(8, 10)), new Date(y, m, 0).getDate());
  return `${ym}-${String(dia).padStart(2, "0")}`;
}
const nomeMes = (ym) => { const [y, m] = ym.split("-").map(Number); return `${MESES[m - 1]} ${y}`; };
const fimDoMes = (ym) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
const dataCurta = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/* ---------- Estado ---------- */
function estadoVazio() {
  return { versao: 2, transacoes: [], orcamentos: [], metas: [], config: { saldoInicial: { valor: 0, data: "" }, cambio: { valor: 6, data: "", fonte: "" }, saldoReal: null, ultimoBackup: "" } };
}
function normalizarTransacao(t) {
  return {
    id: String(t.id ?? uid()),
    data: String(t.data),
    descricao: String(t.descricao ?? "").trim(),
    categoria: String(t.categoria ?? "Outros").trim() || "Outros",
    tipo: t.tipo === "receita" ? "receita" : "despesa",
    valor: Math.abs(Number(t.valor) || 0),
    valorBRL: t.valorBRL ? Math.abs(Number(t.valorBRL)) : null,
    vencimento: t.vencimento ? Number(t.vencimento) : null,
    serieId: t.serieId || null,
    nota: t.nota || "",
    origem: t.origem || "",
    pago: !!t.pago,
    pagoEm: t.pagoEm || "",
    valorPrevisto: t.valorPrevisto != null ? Number(t.valorPrevisto) : null,
  };
}
function normalizarMeta(m) {
  return { id: String(m.id || uid()), nome: String(m.nome || "Meta"), moeda: m.moeda === "BRL" ? "BRL" : "EUR",
    alvo: Number(m.alvo) || 0, atual: Number(m.atual) || 0, prazo: m.prazo || "", nota: m.nota || "", vinculo: m.vinculo || "",
    tipo: m.tipo === "financiamento" ? "financiamento" : "meta",
    parcela: Number(m.parcela) || 0, taxa: Number(m.taxa) || 0, primeiraParcela: m.primeiraParcela || "", dataSaldo: m.dataSaldo || "",
    antecipacoes: Array.isArray(m.antecipacoes) ? m.antecipacoes.map(a => ({ id: String(a.id || uid()), data: String(a.data), valor: Number(a.valor) || 0, nota: a.nota || "", pago: !!a.pago })) : [] };
}
function carregar() {
  try {
    const raw = LS.get(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const base = estadoVazio();
      return { ...base, ...s, config: { ...base.config, ...(s.config || {}) }, transacoes: (s.transacoes || []).map(normalizarTransacao), metas: (s.metas || []).map(normalizarMeta) };
    }
    // migração da versão antiga (chave "transacoes")
    const antigas = JSON.parse(LS.get("transacoes") || "[]");
    const s = estadoVazio();
    s.transacoes = antigas.filter(t => t && t.data).map(normalizarTransacao);
    return s;
  } catch (e) {
    console.error(e);
    return estadoVazio();
  }
}
let state = carregar();
function salvar() { LS.set(STORE_KEY, JSON.stringify(state)); agendarNuvem(); }

/* ---------- Nuvem (claude.ai): os mesmos dados no telemóvel e no computador ---------- */
// Documentos: fin/meta (metas, config, anos, rev), fin/tx-AAAA (lançamentos do ano), fin/painel (resumo para o e-mail diário), fin/cambio (escrito pela tarefa da manhã).
// Erros vão para a nuvem (fin/debug) para se poder diagnosticar sem acesso à consola.
function registarErro(onde, err) {
  try { console.error(onde, err); if (nuvem.db) nuvem.db.doc("fin/debug").set({ quando: new Date().toISOString(), onde, msg: String(err && err.message || err), stack: String(err && err.stack || "").slice(0, 1500), ua: navigator.userAgent }); } catch (e) {}
}
window.addEventListener("error", (e) => registarErro("window", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => registarErro("promise", e.reason));
const nuvem = { db: null, rev: null, enviados: {}, gravando: false, pendente: false, timer: null, pronta: false, estado: "local" };
function setNuvem(estado, txt) {
  nuvem.estado = estado; const el = $("nuvem-pill"); if (!el) return;
  el.hidden = !NO_CLAUDE; el.className = "nuvem-pill " + estado; el.textContent = txt;
}
function porAno(tx) { const m = {}; tx.forEach(t => { const a = t.data.slice(0, 4); (m[a] = m[a] || []).push(t); }); return m; }
function compacto(t) { const o = {}; for (const [k, v] of Object.entries(t)) if (v !== null && v !== "" && v !== false && v !== undefined) o[k] = v; return o; }
async function iniciarNuvem() {
  if (!NO_CLAUDE) return;
  setNuvem("sync", "☁️ a ligar…");
  let db = null;
  try { db = await window.claude.use("db"); } catch (e) { db = null; }
  if (!db) { setNuvem("off", "⚠️ só neste aparelho"); return; }
  nuvem.db = db;
  const timer = setTimeout(() => { if (!nuvem.pronta) setNuvem("off", "⚠️ sem ligação à nuvem"); }, 10000);
  db.doc("fin/meta").onSnapshot(async (snap) => {
    if (snap.metadata && snap.metadata.hasPendingWrites) return;
    clearTimeout(timer);
    if (!snap.exists) {
      nuvem.pronta = true;
      if (state.transacoes.length || state.metas.length) { setNuvem("sync", "☁️ a enviar…"); await enviarNuvem(true); }
      else setNuvem("ok", "☁️ nuvem vazia — importe os dados");
      return;
    }
    const meta = snap.data();
    if (meta.rev && meta.rev === nuvem.rev) { nuvem.pronta = true; setNuvem("ok", "☁️ sincronizado"); return; }
    await carregarDaNuvem(meta);
  }, (err) => { clearTimeout(timer); setNuvem("off", "⚠️ nuvem indisponível"); console.warn("nuvem", err); });
  db.doc("fin/cambio-hist").onSnapshot((snap) => {
    if (!snap.exists) return;
    try { juntarHist(lerHist(snap.data())); renderEuro(); } catch (e) { registarErro("hist-snap", e); }
  }, (err) => registarErro("hist-sub", err));
  db.doc("fin/cambio").onSnapshot((snap) => {
    if (!snap.exists) return;
    const c = JSON.parse(JSON.stringify(snap.data())), v = Number(c.valor);
    if (v > 0 && Math.abs(v - cambio()) > 0.00005 && String(c.data || "") > String(state.config.cambio?.data || "")) {
      state.config.cambioAnterior = { ...state.config.cambio };
      state.config.cambio = { valor: v, data: c.data, fonte: c.fonte || "tarefa diária", pct: c.pct };
      try { registarCotacaoHist(v, c.data); } catch (e) { registarErro("hist-reg", e); }
      aplicarCambio(); salvar(); render();
    }
  }, () => {});
}
async function carregarDaNuvem(meta) {
  setNuvem("sync", "☁️ a receber…");
  try {
    meta = JSON.parse(JSON.stringify(meta)); // os dados da nuvem chegam congelados (só leitura): trabalhar numa cópia
    const anos = meta.anos || [];
    const docs = await Promise.all(anos.map(a => nuvem.db.doc("fin/tx-" + a).get()));
    const tx = []; nuvem.enviados = {};
    docs.forEach((d, i) => { const itens = JSON.parse(JSON.stringify((d.exists && d.data().itens) || [])); nuvem.enviados[anos[i]] = JSON.stringify(itens); itens.forEach(t => tx.push(normalizarTransacao(t))); });
    const base = estadoVazio();
    state = { ...base, versao: meta.versao || 2, transacoes: tx, metas: (meta.metas || []).map(normalizarMeta), orcamentos: meta.orcamentos || [], config: { ...base.config, ...(meta.config || {}) } };
    nuvem.rev = meta.rev; nuvem.pronta = true;
    LS.set(STORE_KEY, JSON.stringify(state));
    if (aplicarCambio()) agendarNuvem();
    render(); setNuvem("ok", "☁️ sincronizado");
  } catch (e) { console.warn(e); setNuvem("off", "⚠️ erro ao receber"); }
}
function agendarNuvem() {
  if (!nuvem.db || !nuvem.pronta) return;
  clearTimeout(nuvem.timer); setNuvem("sync", "☁️ a guardar…");
  nuvem.timer = setTimeout(() => enviarNuvem(false), 900);
}
async function enviarNuvem(forcar) {
  if (!nuvem.db) return;
  if (nuvem.gravando) { nuvem.pendente = true; return; }
  nuvem.gravando = true;
  try {
    const grupos = porAno(state.transacoes), anos = Object.keys(grupos).sort();
    for (const a of anos) {
      const itens = grupos[a].map(compacto), js = JSON.stringify(itens);
      if (forcar || nuvem.enviados[a] !== js) { await nuvem.db.doc("fin/tx-" + a).set({ itens }); nuvem.enviados[a] = js; }
    }
    for (const a of Object.keys(nuvem.enviados)) if (!grupos[a]) { await nuvem.db.doc("fin/tx-" + a).set({ itens: [] }); delete nuvem.enviados[a]; }
    const rev = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    nuvem.rev = rev;
    await nuvem.db.doc("fin/meta").set({ versao: state.versao || 2, metas: state.metas, orcamentos: state.orcamentos, config: state.config, anos, rev, atualizadoEm: new Date().toISOString() });
    try { await nuvem.db.doc("fin/painel").set(resumoNuvem()); } catch (e) { console.warn("painel", e); }
    nuvem.pronta = true; setNuvem("ok", "☁️ sincronizado");
  } catch (e) {
    console.warn("nuvem", e);
    setNuvem("off", e && e.code === "quota_exceeded" ? "⚠️ nuvem cheia" : "⚠️ não guardou na nuvem");
  } finally {
    nuvem.gravando = false;
    if (nuvem.pendente) { nuvem.pendente = false; enviarNuvem(false); }
  }
}
// Resumo pequeno para a tarefa da manhã (que corre sem abrir o app).
function resumoNuvem() {
  const hoje = hojeISO(), lim = somarDias(hoje, 60);
  const desde = state.config.saldoReal?.desde || `${mesDe(hoje)}-01`;
  const pend = state.transacoes.filter(t => !t.pago && t.data >= desde && dataVenc(t) <= lim)
    .map(t => ({ d: dataVenc(t), desc: t.descricao, v: t.valor, tipo: t.tipo, brl: t.valorBRL || null }))
    .sort((a, b) => a.d.localeCompare(b.d));
  let alertas = []; try { alertas = calcularInsights().ins.filter(i => i.tom === "alto" || i.tom === "medio").slice(0, 5).map(i => String(i.txt).replace(/<[^>]+>/g, "")); } catch (e) {}
  const metas = state.metas.filter(m => m.alvo > 0).map(m => { const p = progressoMeta(m); return { nome: m.nome, pct: Math.round(Math.max(0, Math.min(100, (p.atual / m.alvo) * 100))), fim: p.quitacao || null }; });
  return { geradoEm: new Date().toISOString(), saldoReal: state.config.saldoReal || null, cambio: state.config.cambio || null, pendentes: pend, alertas, metas, dicas: DICAS };
}

/* ---------- Câmbio EUR → BRL ---------- */
const cambio = () => Number(state.config.cambio?.valor) || 6;
const paraEUR = (valorBRL) => r2(valorBRL / cambio());
// Recalcula em euros os lançamentos em reais do mês atual em diante (os passados ficam com a cotação da época).
function aplicarCambio() {
  const inicio = `${mesDe(hojeISO())}-01`;
  let n = 0;
  state.transacoes.forEach(t => {
    if (t.valorBRL && !t.pago && t.data >= inicio) { const v = paraEUR(t.valorBRL); if (v !== t.valor) { t.valor = v; n++; } }
  });
  return n;
}
async function atualizarCambio(manual = false) {
  if (NO_CLAUDE) { if (manual) toast("A cotação é atualizada todas as manhãs pela tarefa diária. Pode pôr uma manual abaixo."); return; }
  try {
    const r = await fetch(CAMBIO_API, { cache: "no-store" });
    const j = await r.json();
    const v = Number(j?.EURBRL?.bid);
    if (!(v > 0)) throw new Error("resposta inválida");
    if (state.config.cambio?.valor && Math.round(v * 10000) / 10000 !== state.config.cambio.valor) state.config.cambioAnterior = { ...state.config.cambio };
    state.config.cambio = { valor: Math.round(v * 10000) / 10000, data: j.EURBRL.create_date || hojeISO(), fonte: "AwesomeAPI" };
    const n = aplicarCambio();
    salvar(); render();
    if (manual) toast(`Cotação atualizada: 1 € = ${fmtTaxa(state.config.cambio.valor)}${n ? ` · ${n} lançamento(s) recalculado(s)` : ""}`);
  } catch (e) {
    console.warn("Câmbio:", e);
    if (manual) toast("Não foi possível obter a cotação agora. Pode introduzir uma manualmente.");
  }
}

/* ---------- UI state ---------- */
let mesAtual = mesDe(hojeISO());
let viewAtual = "dashboard";
let editandoId = null;
let editandoMetaId = null;

function toast(msg) {
  const el = $("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (el.hidden = true), 2600);
}

/* ---------- Cálculos ---------- */
const doMes = (ym) => state.transacoes.filter(t => mesDe(t.data) === ym);
const soma = (lista, tipo) => lista.filter(t => !tipo || t.tipo === tipo).reduce((a, t) => a + t.valor, 0);
const sinal = (t) => (t.tipo === "receita" ? t.valor : -t.valor);
function categorias() {
  const set = new Set(state.transacoes.map(t => t.categoria));
  state.orcamentos.forEach(o => set.add(o.categoria));
  return [...set].sort((a, b) => a.localeCompare(b, "pt"));
}
function saldoAte(dataLimite) {
  const ini = state.config.saldoInicial || { valor: 0, data: "" };
  return (Number(ini.valor) || 0) + state.transacoes
    .filter(t => (!ini.data || t.data >= ini.data) && t.data <= dataLimite)
    .reduce((a, t) => a + sinal(t), 0);
}
// Data em que o lançamento é pago/recebido: o dia de vencimento dentro do mês do lançamento, ou a própria data.
function dataVenc(t) {
  if (!t.vencimento) return t.data;
  const ym = mesDe(t.data), [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(Math.min(t.vencimento, new Date(y, m, 0).getDate())).padStart(2, "0")}`;
}
const temSaldoReal = () => !!(state.config.saldoReal && state.config.saldoReal.data);
// Saldo previsto numa data: saldo real + tudo o que ainda está pendente até essa data (inclui atrasados).
function saldoPrevisto(dataLimite) {
  if (!temSaldoReal()) return saldoAte(dataLimite);
  const sr = state.config.saldoReal;
  return (Number(sr.valor) || 0) + state.transacoes
    .filter(t => !t.pago && t.data >= (sr.desde || `${mesDe(hojeISO())}-01`) && dataVenc(t) <= dataLimite)
    .reduce((a, t) => a + sinal(t), 0);
}
function pendentesAte(dataLimite) {
  const desde = state.config.saldoReal?.desde || `${mesDe(hojeISO())}-01`;
  return state.transacoes.filter(t => !t.pago && t.data >= desde && dataVenc(t) <= dataLimite)
    .sort((a, b) => dataVenc(a).localeCompare(dataVenc(b)) || (a.tipo === "receita" ? -1 : 1));
}
function somarDias(data, n) {
  const d = new Date(Number(data.slice(0, 4)), Number(data.slice(5, 7)) - 1, Number(data.slice(8, 10)) + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ---------- Confirmar pagamentos / saldo real ---------- */
function abrirModal({ titulo, sub = "", campos, ok = "Confirmar", onOk }) {
  $("modal-titulo").textContent = titulo; $("modal-sub").textContent = sub;
  $("modal-campos").innerHTML = campos; $("modal-ok").textContent = ok;
  $("modal").hidden = false;
  posicionarModal();
  const f = $("modal-campos").querySelector("input"); if (f) setTimeout(() => f.focus(), 30);
  abrirModal._ok = onOk;
}
// No claude.ai a página pode ficar com a altura toda do conteúdo (sobretudo no telemóvel):
// um modal "fixo" aparecia no topo, fora da vista. Por isso abre junto de onde se tocou.
let ultimoToqueY = null;
document.addEventListener("pointerdown", (e) => { ultimoToqueY = e.pageY; }, true);
function posicionarModal() {
  const m = $("modal"), card = m.querySelector(".modal-card");
  if (!NO_CLAUDE) { m.style.cssText = ""; card.style.marginTop = ""; return; }
  const alturaDoc = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  m.style.cssText = `position:absolute;top:0;left:0;right:0;bottom:auto;height:${alturaDoc}px;align-items:start;place-items:start center`;
  const h = card.offsetHeight || 320;
  const y = ultimoToqueY == null ? window.scrollY + 40 : ultimoToqueY - h / 2;
  card.style.marginTop = Math.max(8, Math.min(y, alturaDoc - h - 24)) + "px";
  try { card.scrollIntoView({ block: "nearest" }); } catch (e) {}
}
function fecharModal() { $("modal").hidden = true; abrirModal._ok = null; }

// confirm() não funciona dentro do claude.ai: pergunta num modal próprio.
function perguntar(texto, ok = "Sim", nao = "Cancelar") {
  return new Promise((res) => {
    let feito = false;
    abrirModal({ titulo: "Confirmar", sub: "", campos: `<p style="margin:0;white-space:pre-line">${esc(texto)}</p>`, ok, onOk: () => { feito = true; res(true); } });
    $("modal-cancelar").textContent = nao;
    const obs = new MutationObserver(() => { if ($("modal").hidden) { obs.disconnect(); $("modal-cancelar").textContent = "Cancelar"; if (!feito) res(false); } });
    obs.observe($("modal"), { attributes: true, attributeFilter: ["hidden"] });
  });
}

function confirmarTransacao(id) {
  const t = state.transacoes.find(x => x.id === id); if (!t) return;
  if (t.pago) { // desfazer
    if (temSaldoReal()) state.config.saldoReal.valor = r2(state.config.saldoReal.valor - sinal(t));
    t.pago = false; t.pagoEm = "";
    if (t.valorPrevisto != null) { t.valor = t.valorPrevisto; t.valorPrevisto = null; }
    salvar(); render(); toast(`"${t.descricao}" voltou a pendente.`); return;
  }
  const rec = t.tipo === "receita";
  abrirModal({
    titulo: rec ? `Confirmar recebimento` : `Confirmar pagamento`,
    sub: `${t.descricao} · previsto ${fmt(t.valor)}${t.valorBRL ? ` (${fmtBRL(t.valorBRL)})` : ""} · vence ${dataCurta(dataVenc(t))}`,
    campos: `<label>Valor ${rec ? "recebido" : "pago"} (€)<input type="number" step="0.01" min="0" id="mc-valor" value="${t.valor}" required></label>
             <label>Data<input type="date" id="mc-data" value="${hojeISO()}" required></label>
             ${temSaldoReal() ? `<p class="muted small">O saldo real vai ${rec ? "aumentar" : "diminuir"} este valor.</p>` : `<p class="muted small">Dica: defina o saldo real no Resumo para o app ir atualizando o saldo sozinho.</p>`}`,
    ok: rec ? "Recebido ✓" : "Pago ✓",
    onOk: () => {
      const v = r2(Number($("mc-valor").value));
      if (!(v >= 0)) return false;
      if (v !== t.valor) { t.valorPrevisto = t.valor; t.valor = v; }
      t.pago = true; t.pagoEm = $("mc-data").value || hojeISO();
      if (temSaldoReal()) state.config.saldoReal.valor = r2(state.config.saldoReal.valor + sinal(t));
      salvar(); render(); toast(`${rec ? "Recebimento" : "Pagamento"} confirmado: ${t.descricao} ${fmt(v)}.`);
    },
  });
}

function ajustarValor(id) {
  const t = state.transacoes.find(x => x.id === id); if (!t) return;
  const emBRL = !!t.valorBRL && !t.pago;
  // mesma série e mesmo dia do mês (ex.: o salário do dia 1 e o do dia 15 são séries paralelas)
  const prox = t.serieId ? state.transacoes.filter(x => x.serieId === t.serieId && x.data > t.data && !x.pago && x.data.slice(8) === t.data.slice(8)) : [];
  abrirModal({
    titulo: "Ajustar valor",
    sub: `${t.descricao} · ${dataCurta(dataVenc(t))}${t.pago ? " · já confirmado (o saldo real acompanha a diferença)" : ""}`,
    campos: `<label>Novo valor (${emBRL ? "R$" : "€"})<input type="number" step="0.01" min="0" id="ma-valor" value="${emBRL ? t.valorBRL : t.valor}" required></label>
      ${emBRL ? `<p class="muted small">≈ convertido ao câmbio de ${fmtTaxa(cambio())}</p>` : ""}
      ${prox.length ? `<label class="check"><input type="checkbox" id="ma-serie"> Aplicar também aos próximos ${prox.length} desta série</label>` : ""}`,
    ok: "Guardar",
    onOk: () => {
      const v = r2(Number($("ma-valor").value)); if (!(v >= 0)) return false;
      const antes = t.valor;
      if (emBRL) { t.valorBRL = v; t.valor = paraEUR(v); } else { t.valor = v; if (t.pago) t.valorBRL = null; }
      if (t.pago && temSaldoReal()) state.config.saldoReal.valor = r2(state.config.saldoReal.valor + (t.tipo === "receita" ? 1 : -1) * (t.valor - antes));
      let n = 0;
      if ($("ma-serie") && $("ma-serie").checked) prox.forEach(x => { if (emBRL) { x.valorBRL = v; x.valor = paraEUR(v); } else { x.valor = v; x.valorBRL = null; } n++; });
      salvar(); render(); toast(`Valor atualizado${n ? ` (e mais ${n} da série)` : ""}: ${t.descricao} ${fmt(t.valor)}.`);
    },
  });
}

function editarSaldoReal() {
  const hoje = hojeISO();
  const atrasados = pendentesAte(hoje);
  const sr = state.config.saldoReal;
  abrirModal({
    titulo: "Atualizar saldo real",
    sub: "Escreva quanto tem agora na conta (como aparece no banco).",
    campos: `<label>Saldo atual (€)<input type="number" step="0.01" id="ms-valor" value="${sr ? sr.valor : ""}" required></label>
      ${atrasados.length ? `<label class="check"><input type="checkbox" id="ms-quitar" ${sr ? "" : "checked"}> Já paguei/recebi os ${atrasados.length} lançamento(s) previstos até hoje (marcar como confirmados)</label>
      <p class="muted small">${atrasados.slice(0, 6).map(t => `${dataCurta(dataVenc(t)).slice(0, 5)} ${esc(t.descricao)} ${t.tipo === "receita" ? "+" : "−"}${fmt(t.valor)}`).join(" · ")}${atrasados.length > 6 ? " …" : ""}</p>` : ""}`,
    ok: "Guardar saldo",
    onOk: () => {
      const v = Number($("ms-valor").value);
      if (Number.isNaN(v)) return false;
      if ($("ms-quitar") && $("ms-quitar").checked) atrasados.forEach(t => { t.pago = true; t.pagoEm = hoje; });
      state.config.saldoReal = { valor: r2(v), data: new Date().toISOString(), desde: sr?.desde || `${mesDe(hoje)}-01` };
      salvar(); render(); toast("Saldo real atualizado.");
    },
  });
}

function gastoCategoria(ym, cat) {
  return doMes(ym).filter(t => t.tipo === "despesa" && t.categoria === cat).reduce((a, t) => a + t.valor, 0);
}

/* ---------- Gráficos SVG ---------- */
function graficoBarras(el) {
  const meses = [];
  for (let i = -4; i <= 2; i++) meses.push(somarMeses(mesAtual, i));
  const dados = meses.map(ym => { const l = doMes(ym); return { ym, r: soma(l, "receita"), d: soma(l, "despesa") }; });
  const max = Math.max(1, ...dados.flatMap(x => [x.r, x.d]));
  const W = 560, H = 230, pb = 34, pt = 22, pl = 6, gw = (W - pl) / meses.length, bw = Math.min(22, gw / 3.2);
  const y = (v) => H - pb - (v / max) * (H - pb - pt);
  let g = "";
  for (let k = 0; k <= 3; k++) {
    const yy = pt + (k * (H - pb - pt)) / 3;
    g += `<line x1="0" x2="${W}" y1="${yy}" y2="${yy}" stroke="var(--border)" stroke-dasharray="2 4"/>`;
  }
  dados.forEach((x, i) => {
    const cx = pl + gw * i + gw / 2, cur = x.ym === mesAtual;
    const [yy, mm] = x.ym.split("-");
    g += `<g class="${cur ? "bar-cur" : ""}" style="cursor:pointer" data-ym="${x.ym}">
      <rect x="${cx - gw / 2 + 2}" y="${pt - 14}" width="${gw - 4}" height="${H - pt + 10}" rx="8" fill="${cur ? "var(--surface-2)" : "transparent"}"/>
      <rect x="${cx - bw - 2}" y="${y(x.r)}" width="${bw}" height="${Math.max(0, H - pb - y(x.r))}" rx="4" fill="var(--pos)"><title>Receitas: ${fmt(x.r)}</title></rect>
      <rect x="${cx + 2}" y="${y(x.d)}" width="${bw}" height="${Math.max(0, H - pb - y(x.d))}" rx="4" fill="var(--neg)"><title>Despesas: ${fmt(x.d)}</title></rect>
      <text class="lbl" x="${cx}" y="${H - 14}" text-anchor="middle">${MESES_CURTOS[Number(mm) - 1]}</text>
      <text x="${cx}" y="${H - 1}" text-anchor="middle" font-size="9">${yy}</text>
    </g>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas e despesas por mês">${g}</svg>`;
  el.querySelectorAll("[data-ym]").forEach(n => n.addEventListener("click", () => { mesAtual = n.dataset.ym; render(); }));
}

function graficoDonut(el) {
  const por = {};
  doMes(mesAtual).filter(t => t.tipo === "despesa").forEach(t => (por[t.categoria] = (por[t.categoria] || 0) + t.valor));
  const itens = Object.entries(por).sort((a, b) => b[1] - a[1]);
  const total = itens.reduce((a, [, v]) => a + v, 0);
  if (!total) { el.innerHTML = `<p class="empty">Sem despesas neste mês.</p>`; return; }
  const R = 70, r = 46, C = 90;
  let ang = -Math.PI / 2, arcs = "";
  itens.forEach(([cat, v], i) => {
    const a = (v / total) * Math.PI * 2, a2 = ang + a - (itens.length > 1 ? 0.015 : 0);
    const big = a > Math.PI ? 1 : 0;
    const p = (rad, ang) => `${C + rad * Math.cos(ang)} ${C + rad * Math.sin(ang)}`;
    const path = itens.length === 1
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`
      : `M ${p(R, ang)} A ${R} ${R} 0 ${big} 1 ${p(R, a2)} L ${p(r, a2)} A ${r} ${r} 0 ${big} 0 ${p(r, ang)} Z`;
    arcs += `<path d="${path}" fill="${CORES[i % CORES.length]}"><title>${esc(cat)}: ${fmt(v)}</title></path>`;
    ang += a;
  });
  arcs += `<text x="${C}" y="${C - 4}" text-anchor="middle" font-size="11">Total</text>
           <text x="${C}" y="${C + 14}" text-anchor="middle" font-size="15" style="fill:var(--text);font-weight:600">${esc(fmt(total))}</text>`;
  const legenda = itens.map(([cat, v], i) =>
    `<li><i class="sw" style="background:${CORES[i % CORES.length]}"></i><span>${esc(cat)}</span><span class="v">${fmt(v)}</span><span class="p">${Math.round((v / total) * 100)}%</span></li>`).join("");
  el.innerHTML = `<svg viewBox="0 0 180 180" width="180" height="180">${arcs}</svg><ul class="donut-legend">${legenda}</ul>`;
}

/* ---------- Render: Resumo ---------- */
function linhaProgresso(nome, gasto, limite, extra = "", f = fmt) {
  const pct = limite > 0 ? (gasto / limite) * 100 : 0;
  const cls = pct > 100 ? "over" : pct >= 85 ? "warn" : "";
  return `<div class="progress-row">
    <div class="progress-top"><span>${esc(nome)}</span><span class="v">${f(gasto)} / ${extra || f(limite)}</span></div>
    <div class="bar ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div>
  </div>`;
}

/* ---------- Gráfico do euro (semana, mês, ano, 5 anos) ---------- */
// Histórico em fin/cambio-hist {pts: [[AAAA-MM-DD, taxa], ...]}: diário no último ano, semanal antes.
const HIST_KEY = "fin_cambio_hist";
let cambioHist = []; try { cambioHist = JSON.parse(LS.get(HIST_KEY) || "[]"); } catch (e) { cambioHist = []; }
let euroPeriodo = Number(LS.get("fin_euro_periodo")) || 30;
function juntarHist(pts) {
  const m = new Map(cambioHist.map(p => [p[0], p[1]]));
  pts.forEach(p => { if (p && p[0] && p[1] > 0) m.set(p[0], +p[1]); });
  cambioHist = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  LS.set(HIST_KEY, JSON.stringify(cambioHist));
}
// Guardado como texto "AAAA-MM-DD:taxa,..." (a base de dados não aceita listas dentro de listas).
function lerHist(doc) {
  const p = doc && doc.pts;
  if (typeof p === "string") return p.split(",").map(x => { const [d, v] = x.split(":"); return [d, Number(v)]; });
  if (Array.isArray(p)) return p.map(x => Array.isArray(x) ? [x[0], Number(x[1])] : [x.d, Number(x.v)]);
  return [];
}
const histTexto = () => cambioHist.map(p => `${p[0]}:${p[1]}`).join(",");
function registarCotacaoHist(valor, quando) {
  const d = String(quando || hojeISO()).slice(0, 10); if (!(valor > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
  const antes = cambioHist.find(p => p[0] === d);
  if (antes && Math.abs(antes[1] - valor) < 0.00005) return;
  juntarHist([[d, +(+valor).toFixed(4)]]);
  if (nuvem.db && nuvem.pronta) nuvem.db.doc("fin/cambio-hist").set({ pts: histTexto() }).catch(e => registarErro("hist", e));
}
function renderEuro() {
  const graf = $("euro-graf"); if (!graf) return;
  document.querySelectorAll("#euro-periodos button").forEach(b => b.classList.toggle("on", Number(b.dataset.p) === euroPeriodo));
  const atual = cambio();
  $("euro-atual").textContent = fmtTaxa(atual);
  const desde = somarDias(hojeISO(), -euroPeriodo);
  let pts = cambioHist.filter(p => p[0] >= desde);
  const fonte = state.config.cambio || {};
  const hojeD = String(fonte.data || "").slice(0, 10) || hojeISO();
  if (atual > 0 && (!pts.length || pts[pts.length - 1][0] < hojeD)) pts = [...pts, [hojeD, atual]];
  else if (pts.length && pts[pts.length - 1][0] === hojeD) pts = [...pts.slice(0, -1), [hojeD, atual]];
  $("euro-nota").textContent = fonte.data ? `atualizado ${dataCurta(hojeD)}` : "";
  if (pts.length < 2) { graf.innerHTML = `<p class="muted small">Ainda sem histórico suficiente para este período.</p>`; $("euro-var").textContent = ""; $("euro-rodape").innerHTML = ""; return; }
  const ini = pts[0][1], fim = pts[pts.length - 1][1], pct = (fim / ini - 1) * 100;
  const nomes = { 7: "na semana", 30: "no mês", 365: "no ano", 1826: "em 5 anos" };
  // Euro mais barato = o salário em reais rende mais euros (bom para a família).
  $("euro-var").className = pct <= 0 ? "pos" : "neg";
  $("euro-var").textContent = `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(2).replace(".", ",")}% ${nomes[euroPeriodo] || ""}`;
  const W = 600, H = 170, pad = { l: 8, r: 8, t: 22, b: 8 };
  const vs = pts.map(p => p[1]), mn = Math.min(...vs), mx = Math.max(...vs), rg = (mx - mn) || 0.01;
  const t0 = new Date(pts[0][0] + "T12:00:00").getTime(), t1 = new Date(pts[pts.length - 1][0] + "T12:00:00").getTime(), tr = (t1 - t0) || 1;
  const X = (d) => pad.l + (new Date(d + "T12:00:00").getTime() - t0) / tr * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - mn) / rg) * (H - pad.t - pad.b);
  const linha = pts.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
  const cor = pct <= 0 ? "var(--pos)" : "var(--neg)";
  const iMx = vs.indexOf(mx), iMn = vs.indexOf(mn);
  graf.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Cotação do euro em reais">
      <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${cor}" stop-opacity=".28"/><stop offset="1" stop-color="${cor}" stop-opacity="0"/></linearGradient></defs>
      <path d="${linha}L${X(pts[pts.length - 1][0]).toFixed(1)},${H - pad.b}L${pad.l},${H - pad.b}Z" fill="url(#eg)"/>
      <path d="${linha}" fill="none" stroke="${cor}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      <line id="euro-cursor" x1="0" x2="0" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--muted)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" visibility="hidden"/>
    </svg><div class="euro-tip" id="euro-tip" hidden></div>`;
  $("euro-rodape").innerHTML = `<span>${dataCurta(pts[0][0])}</span><span>mín. ${fmtTaxa(mn)} · máx. ${fmtTaxa(mx)}</span><span>${dataCurta(pts[pts.length - 1][0])}</span>`;
  const svg = graf.querySelector("svg"), tip = $("euro-tip"), cur = $("euro-cursor");
  const mover = (e) => {
    const r = svg.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * W;
    let best = 0; pts.forEach((p, i) => { if (Math.abs(X(p[0]) - x) < Math.abs(X(pts[best][0]) - x)) best = i; });
    const p = pts[best], px = X(p[0]);
    cur.setAttribute("x1", px); cur.setAttribute("x2", px); cur.setAttribute("visibility", "visible");
    tip.hidden = false; tip.style.left = Math.min(Math.max(px / W * r.width, 50), r.width - 50) + "px";
    tip.textContent = `${dataCurta(p[0])} · ${fmtTaxa(p[1])}`;
  };
  svg.addEventListener("pointermove", mover); svg.addEventListener("pointerdown", mover);
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cur.setAttribute("visibility", "hidden"); });
}

function renderDashboard() {
  renderEuro();
  const lista = doMes(mesAtual);
  const r = soma(lista, "receita"), d = soma(lista, "despesa");
  $("kpi-receitas").textContent = fmt(r);
  $("kpi-despesas").textContent = fmt(d);
  const rOk = soma(lista.filter(t => t.pago), "receita"), dOk = soma(lista.filter(t => t.pago), "despesa");
  $("kpi-receitas-nota").textContent = r ? `${fmt(rOk)} recebido` : "";
  $("kpi-despesas-nota").textContent = d ? `${fmt(dOk)} pago` : "";
  const res = $("kpi-resultado");
  res.textContent = fmt(r - d); res.className = r - d >= 0 ? "pos" : "neg";
  const saldoEl = $("kpi-saldo");
  const hoje = hojeISO();
  if (temSaldoReal()) {
    if (fimDoMes(mesAtual) < hoje) { saldoEl.textContent = "—"; saldoEl.className = ""; $("kpi-saldo-nota").textContent = "mês passado"; }
    else { const s = saldoPrevisto(fimDoMes(mesAtual)); saldoEl.textContent = fmt(s); saldoEl.className = s >= 0 ? "pos" : "neg"; $("kpi-saldo-nota").textContent = "saldo real + pendentes até ao fim do mês"; }
  } else {
    const ini = state.config.saldoInicial;
    if (ini && ini.data && fimDoMes(mesAtual) < ini.data) { saldoEl.textContent = "—"; saldoEl.className = ""; $("kpi-saldo-nota").textContent = `antes do saldo inicial (${dataCurta(ini.data)})`; }
    else { const s = saldoAte(fimDoMes(mesAtual)); saldoEl.textContent = fmt(s); saldoEl.className = s >= 0 ? "pos" : "neg"; $("kpi-saldo-nota").textContent = "defina o saldo real no topo"; }
  }

  // A confirmar: atrasados + próximos 7 dias
  const lim = somarDias(hoje, 7);
  const conf = pendentesAte(lim);
  $("dash-confirmar").innerHTML = conf.length ? conf.map(t => itemMov(t, hoje)).join("") : `<li class="empty" style="display:block">Nada pendente para os próximos 7 dias. 🎉</li>`;

  $("aviso-backup").hidden = true;

  graficoBarras($("chart-barras"));
  graficoDonut($("chart-donut"));

  // Movimentos do mês
  const filtro = $("mov-filtro").value;
  const mov = lista.filter(t => filtro === "todos" || (filtro === "pagos" ? t.pago : !t.pago))
    .sort((a, b) => dataVenc(a).localeCompare(dataVenc(b)) || b.valor - a.valor);
  $("dash-vencimentos").innerHTML = mov.length ? mov.map(t => itemMov(t, hoje)).join("")
    : `<li class="empty" style="display:block">${filtro === "pendentes" ? "Tudo confirmado neste mês. ✅" : "Sem movimentos."}</li>`;

  // Metas
  $("dash-metas").innerHTML = state.metas.length
    ? state.metas.map(m => linhaProgresso(m.nome, progressoMeta(m).atual, m.alvo, "", (v) => fmtMoeda(v, m.moeda))).join("")
    : `<p class="empty">Nenhuma meta criada.</p>`;
}

function itemMov(t, hoje) {
  const dv = dataVenc(t), atras = !t.pago && dv < hoje, rec = t.tipo === "receita";
  return `<li class="${t.pago ? "pago" : ""} ${atras ? "atrasado" : ""}">
    <span class="due-day">${Number(dv.slice(8, 10))}<small>${MESES_CURTOS[Number(dv.slice(5, 7)) - 1]}</small></span>
    <span>${esc(t.descricao)}<span class="cat">${esc(t.categoria)}${atras ? " · atrasado" : ""}${t.pago ? ` · ${rec ? "recebido" : "pago"} ${dataCurta(t.pagoEm).slice(0, 5)}` : ""}</span></span>
    <span class="v ${rec ? "pos" : "neg"}"><button class="valor-btn" data-ajustar="${esc(t.id)}" title="Ajustar valor">${rec ? "+" : "−"}${fmt(t.valor)}</button></span>
    <button class="chk ${t.pago ? "on" : ""}" data-confirmar="${esc(t.id)}" title="${t.pago ? "Desfazer confirmação" : rec ? "Confirmar recebimento" : "Confirmar pagamento"}">✓</button></li>`;
}

/* ---------- Barra fixa do saldo ---------- */
function renderSaldoBar() {
  const hoje = hojeISO(), el = $("saldo-real-valor"), pv = $("sb-previsto");
  $("sb-prev-label").textContent = `Previsto fim de ${MESES[Number(hoje.slice(5, 7)) - 1]}`;
  if (temSaldoReal()) {
    const sr = state.config.saldoReal, d0 = new Date(sr.data);
    el.textContent = fmt(sr.valor); el.className = "sb-valor " + (sr.valor >= 0 ? "pos" : "neg");
    const p = saldoPrevisto(fimDoMes(mesDe(hoje)));
    pv.textContent = fmt(p); pv.className = "sb-valor sb-sec " + (p >= 0 ? "pos" : "neg");
    $("saldo-real-nota").textContent = `Atualizado ${d0.toLocaleDateString("pt-PT")} ${d0.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })} · cada ✓ atualiza o saldo`;
  } else {
    el.textContent = "—"; el.className = "sb-valor"; pv.textContent = "—"; pv.className = "sb-valor sb-sec";
    $("saldo-real-nota").textContent = "Diga quanto tem hoje na conta.";
  }
}

/* ---------- Conselheiro: insights do dia ---------- */
const DICAS = [
  "Faça a lista do mercado <strong>antes</strong> de sair de casa e não entre com fome — corta compras por impulso.",
  "Antes de qualquer compra acima de €30 que não estava prevista, <strong>espere 48 horas</strong>.",
  "Marcas brancas no Lidl/Aldi/Continente costumam ser <strong>20–40% mais baratas</strong> para a mesma qualidade.",
  "Cozinhe em quantidade ao domingo: <strong>marmitas</strong> para a semana poupam tempo e dinheiro.",
  "Ligue a máquina de lavar e o forno no horário mais barato da tarifa, se for bi-horária.",
  "Pergunte à MEO por uma <strong>proposta de retenção</strong> — muitas vezes baixam o preço só por pedir.",
  "Verifique se tem direito à <strong>tarifa social de energia</strong>: pode baixar bastante a conta da luz.",
  "Wizink e Oney guardados na gaveta: <strong>nenhuma compra nova</strong> até estarem a zero.",
  "Fim de semana sem gastar: parque, praia fluvial, cinema em casa com pipocas feitas em casa.",
  "Cada €10 que sobrar vai para a reserva — até chegar a <strong>€300</strong>, depois para o limite Itaú.",
  "Junte as saídas de carro: um percurso planeado gasta muito menos combustível do que três voltas.",
  "Peça faturas com NIF em tudo: farmácia, escola, mercado — conta para o <strong>IRS</strong>.",
  "Pague primeiro as dívidas no dia 1, depois o resto: <strong>pagar-se a si e ao plano primeiro</strong>.",
  "Uma meta de vendas de velas por mês, mesmo pequena, cria a folga que o plano não tem.",
  "Revise as subscrições (streaming, apps, ginásio): cancele o que não usou no último mês.",
];

function calcularInsights() {
  const hoje = hojeISO(), amanha = somarDias(hoje, 1), mesH = mesDe(hoje);
  const ins = []; // { p: prioridade (maior = mais importante), tom: alto|medio|bom|info, ic, txt, acao }
  const add = (p, tom, ic, txt, acao = "") => ins.push({ p, tom, ic, txt, acao });
  const btnConf = (t) => `<button class="btn btn-sm" data-confirmar="${esc(t.id)}">${t.tipo === "receita" ? "Recebido ✓" : "Pago ✓"}</button>`;

  // 1) Saldo real
  if (!temSaldoReal()) add(100, "medio", "🏦", "Comece por dizer quanto tem hoje na conta. A partir daí eu vou acompanhando cada pagamento.", `<button class="btn btn-sm btn-primary" data-acao-cons="saldo">Atualizar saldo</button>`);
  else {
    const dias = Math.floor((Date.now() - Date.parse(state.config.saldoReal.data)) / 864e5);
    if (dias >= 7) add(55, "info", "🔄", `O saldo real foi atualizado há ${dias} dias. Confira com o banco para eu não me enganar.`, `<button class="btn btn-sm" data-acao-cons="saldo">Atualizar</button>`);
  }

  // 2) Atrasados
  const atras = pendentesAte(somarDias(hoje, -1));
  const atrDesp = atras.filter(t => t.tipo === "despesa"), atrRec = atras.filter(t => t.tipo === "receita");
  if (atrDesp.length) {
    const tot = atrDesp.reduce((a, t) => a + t.valor, 0);
    add(95, "alto", "⏰", atrDesp.length === 1 ? `<strong>${esc(atrDesp[0].descricao)}</strong> (${fmt(atrDesp[0].valor)}) venceu a ${dataCurta(dataVenc(atrDesp[0])).slice(0, 5)} e ainda não está confirmado. Já pagou?`
      : `Tem <strong>${atrDesp.length} pagamentos atrasados</strong> (${fmt(tot)}). Confirme os que já pagou para o saldo bater certo.`, atrDesp.length === 1 ? btnConf(atrDesp[0]) : `<button class="btn btn-sm" data-goto-pend>Ver</button>`);
  }
  if (atrRec.length) add(80, "medio", "💶", `${atrRec.length === 1 ? `<strong>${esc(atrRec[0].descricao)}</strong> (${fmt(atrRec[0].valor)}) devia ter entrado` : `${atrRec.length} recebimentos deviam ter entrado`}. Já caiu na conta?`, atrRec.length === 1 ? btnConf(atrRec[0]) : "");

  // 3) Hoje e amanhã
  const hojeL = state.transacoes.filter(t => !t.pago && dataVenc(t) === hoje);
  hojeL.slice(0, 2).forEach(t => add(90, t.tipo === "receita" ? "bom" : "medio", t.tipo === "receita" ? "💰" : "📅", `Hoje: ${t.tipo === "receita" ? "recebe" : "paga"} <strong>${esc(t.descricao)}</strong> — ${fmt(t.valor)}.`, btnConf(t)));
  const amL = state.transacoes.filter(t => !t.pago && dataVenc(t) === amanha);
  if (amL.length) add(70, "info", "🔔", `Amanhã: ${amL.slice(0, 3).map(t => `${esc(t.descricao)} ${t.tipo === "receita" ? "+" : "−"}${fmt(t.valor)}`).join(", ")}${amL.length > 3 ? "…" : ""}.`);

  // 4) Saldo previsto do mês e próximos meses
  if (temSaldoReal()) {
    const fim = saldoPrevisto(fimDoMes(mesH));
    if (fim < 0) {
      const varCat = ["Contas Casa", "Transporte"].map(c => [c, soma(doMes(mesH).filter(t => t.categoria === c && !t.pago), "despesa")]).sort((a, b) => b[1] - a[1])[0];
      add(92, "alto", "🚨", `Pelo plano, este mês fecha em <strong class="neg">${fmt(fim)}</strong>. Faltam ${fmt(-fim)} — ${varCat && varCat[1] ? `o mais fácil de cortar é ${esc(varCat[0])} (${fmt(varCat[1])} ainda por gastar)` : "adie uma despesa não essencial"}.`);
    } else if (fim < 100) add(60, "medio", "⚖️", `Este mês fecha com <strong>${fmt(fim)}</strong> de folga. Apertado: qualquer gasto extra tem de sair de outro lado.`);
    else add(40, "bom", "✅", `Este mês deve fechar com <strong class="pos">${fmt(fim)}</strong>. Se sobrar, ponha na reserva.`);
    for (let i = 1; i <= 6; i++) {
      const ym = somarMeses(mesH, i), v = saldoPrevisto(fimDoMes(ym));
      if (v < 0) { add(75, "medio", "📉", `Atenção a <strong>${nomeMes(ym)}</strong>: o saldo previsto fica em ${fmt(v)}. Ainda dá tempo de ajustar.`); break; }
    }
  }

  // 6) Dívidas e metas
  state.metas.filter(m => m.alvo > 0).forEach(m => {
    const p = progressoMeta(m), pct = p.atual / m.alvo, F = (v) => fmtMoeda(v, m.moeda);
    if (pct >= 1) add(50, "bom", "🏆", `<strong>${esc(m.nome)}</strong>: QUITADO! Parabéns — essa parcela agora pode ir para a próxima dívida.`);
    else if (p.quitacao) {
      const meses = (Number(p.quitacao.slice(0, 4)) - Number(hoje.slice(0, 4))) * 12 + Number(p.quitacao.slice(5, 7)) - Number(hoje.slice(5, 7));
      if (meses <= 2) add(58, "bom", "🎯", `<strong>${esc(m.nome)}</strong> fica quitado ${meses <= 0 ? "este mês" : `em ${meses} ${meses === 1 ? "mês" : "meses"}`}! Força, falta pouco (${F(m.alvo - p.atual)}).`);
    }
  });
  const prox = state.metas.filter(m => m.alvo > 0 && progressoMeta(m).quitacao).map(m => [m, progressoMeta(m).quitacao]).sort((a, b) => a[1].localeCompare(b[1]))[0];
  if (prox) add(35, "info", "🧭", `Próxima dívida a acabar: <strong>${esc(prox[0].nome)}</strong> em ${nomeMes(mesDe(prox[1]))}.`);

  // 7) Próximo salário
  const sal = state.transacoes.filter(t => t.tipo === "receita" && !t.pago && dataVenc(t) >= hoje && /sal[áa]rio/i.test(t.descricao)).sort((a, b) => dataVenc(a).localeCompare(dataVenc(b)))[0];
  if (sal && dataVenc(sal) !== hoje) {
    const d = Math.round((Date.parse(dataVenc(sal)) - Date.parse(hoje)) / 864e5);
    if (d <= 10) add(30, "info", "📆", `Faltam <strong>${d} ${d === 1 ? "dia" : "dias"}</strong> para o ${esc(sal.descricao)} (${sal.valorBRL ? fmtBRL(sal.valorBRL) + " ≈ " : ""}${fmt(sal.valor)}).`);
  }

  // 8) Câmbio
  const cAnt = Number(state.config.cambioAnterior?.valor), cAt = cambio();
  if (cAnt && Math.abs(cAt - cAnt) / cAnt >= 0.01) {
    const salBRL = state.transacoes.filter(t => t.valorBRL && t.tipo === "receita" && mesDe(t.data) === mesH).reduce((a, t) => a + t.valorBRL, 0);
    const dif = salBRL ? salBRL / cAnt - salBRL / cAt : 0;
    add(45, cAt > cAnt ? "medio" : "bom", "💱", `O euro está a ${fmtTaxa(cAt)} (antes ${fmtTaxa(cAnt)}). ${salBRL ? `O que recebe em reais rende <strong>${fmt(Math.abs(dif))} ${dif > 0 ? "a menos" : "a mais"}</strong> este mês.` : ""}`);
  }

  // 9) Cópia de segurança
  const ub = state.config.ultimoBackup, dB = ub ? Math.floor((Date.parse(hoje) - Date.parse(ub)) / 864e5) : null;
  if (dB === null || dB >= 14) add(dB === null ? 68 : 52, "medio", "💾", `${dB === null ? "Ainda não fez nenhuma cópia de segurança" : `Última cópia de segurança há ${dB} dias`}. Sem o Excel, este app é o seu único registo.`, `<button class="btn btn-sm" data-backup>Exportar</button>`);

  ins.sort((a, b) => b.p - a.p);
  // nota de saúde
  const altos = ins.filter(i => i.tom === "alto").length, medios = ins.filter(i => i.tom === "medio").length;
  const score = altos ? ["critico", "Precisa de atenção"] : medios >= 2 ? ["atencao", "Apertado mas no plano"] : ["bom", "No caminho certo"];
  return { ins, score };
}

let consMostrarTodos = false;
const CONS_KEY = "fin_conselheiro_fechado";
function renderConselheiro() {
  const h = new Date().getHours();
  const nome = (JSON.parse(LS.get(USER_KEY) || "{}").nome) || "Neto";
  $("cons-saudacao").textContent = `${h < 12 ? "Bom dia" : h < 19 ? "Boa tarde" : "Boa noite"}, ${nome}!`;
  $("cons-sub").textContent = new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  const { ins, score } = calcularInsights();
  const sc = $("cons-score"); sc.className = "cons-score " + score[0]; sc.textContent = score[1];
  const lista = consMostrarTodos ? ins : ins.slice(0, 1);
  $("cons-lista").innerHTML = lista.map(i => `<li class="${i.tom}"><span class="ic">${i.ic}</span><span>${i.txt}</span>${i.acao ? `<span class="acao">${i.acao}</span>` : ""}</li>`).join("")
    || `<li class="bom"><span class="ic">🌱</span><span>Tudo em dia. Bom trabalho!</span></li>`;
  $("cons-mais").textContent = consMostrarTodos ? "Ver menos" : ins.length > 1 ? `Ver mais ${ins.length - 1} + dica do dia` : "Dica do dia";
  const doy = Math.floor((Date.parse(hojeISO()) - Date.parse(hojeISO().slice(0, 4) + "-01-01")) / 864e5);
  $("cons-dica").innerHTML = `💡 <strong>Dica do dia:</strong> ${DICAS[doy % DICAS.length]}`;
  $("cons-dica").hidden = !consMostrarTodos;
  const alertas = ins.filter(i => i.tom === "alto" || i.tom === "medio");
  const badge = $("cons-badge");
  badge.hidden = !alertas.length; badge.textContent = alertas.length;
  badge.className = "cons-badge" + (ins.some(i => i.tom === "alto") ? "" : " medio");
  $("cons-fab").classList.toggle("fechado", LS.get(CONS_KEY) === hojeISO());
}
function alternarConselheiro(abrir) {
  const fechado = $("cons-fab").classList.contains("fechado");
  const abre = abrir ?? fechado;
  if (abre) LS.del(CONS_KEY); else { LS.set(CONS_KEY, hojeISO()); consMostrarTodos = false; }
  renderConselheiro();
}

// Resumo do mês em texto, para conversar com o conselheiro no Claude
function resumoParaClaude() {
  const hoje = hojeISO(), mesH = mesDe(hoje), l = doMes(mesH);
  const linhas = [`Conselheiro financeiro da família: rever o meu mês (${nomeMes(mesH)}). Dados do app Finanças Família em ${dataCurta(hoje)}:`];
  linhas.push(`- Saldo real: ${temSaldoReal() ? fmt(state.config.saldoReal.valor) : "não definido"}; saldo previsto no fim do mês: ${fmt(saldoPrevisto(fimDoMes(mesH)))}`);
  linhas.push(`- Receitas do mês: ${fmt(soma(l, "receita"))} (recebido ${fmt(soma(l.filter(t => t.pago), "receita"))}); despesas: ${fmt(soma(l, "despesa"))} (pago ${fmt(soma(l.filter(t => t.pago), "despesa"))})`);
  const pend = pendentesAte(fimDoMes(mesH));
  if (pend.length) linhas.push(`- Pendentes até ao fim do mês: ${pend.map(t => `${dataCurta(dataVenc(t)).slice(0, 5)} ${t.descricao} ${t.tipo === "receita" ? "+" : "-"}${fmt(t.valor)}`).join("; ")}`);
  const prox = [1, 2, 3].map(i => somarMeses(mesH, i)).map(ym => `${nomeMes(ym)} ${fmt(saldoPrevisto(fimDoMes(ym)))}`).join("; ");
  linhas.push(`- Saldo previsto nos próximos meses: ${prox}`);
  state.metas.forEach(m => { const p = progressoMeta(m); linhas.push(`- ${m.nome}: pago ${fmtMoeda(p.atual, m.moeda)} de ${fmtMoeda(m.alvo, m.moeda)}${p.quitacao ? `, quitação prevista ${nomeMes(mesDe(p.quitacao))}` : ""}`); });
  linhas.push(`- Câmbio: 1 € = ${fmtTaxa(cambio())}`);
  linhas.push("O que devo fazer esta semana para manter o plano e fechar 2027 no verde?");
  return linhas.join("\n");
}
async function conversarComConselheiro() {
  const txt = resumoParaClaude();
  try { await navigator.clipboard.writeText(txt); } catch (e) { /* sem permissão: segue só com o link */ }
  abrirLinkClaude(txt);
}
function abrirLinkClaude(txt) {
  const url = "https://claude.ai/new?q=" + encodeURIComponent(txt);
  abrirModal({ titulo: "Conversar com o conselheiro", sub: "O resumo já foi copiado.", ok: "Fechar", onOk: () => true,
    campos: `<p style="margin:0">Toque no link para abrir uma conversa nova com o resumo. Se abrir vazia, cole (Ctrl+V) e envie.</p><p><a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener">Abrir o Claude</a></p>` });
}

/* ---------- Render: Lançamentos ---------- */
function renderLancamentos() {
  const cats = categorias();
  $("lista-categorias").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
  const selCat = $("filtro-categoria"), atual = selCat.value;
  selCat.innerHTML = `<option value="">Todas as categorias</option>` + cats.map(c => `<option${c === atual ? " selected" : ""}>${esc(c)}</option>`).join("");

  const periodo = $("filtro-periodo").value, tipo = $("filtro-tipo").value, cat = selCat.value;
  const busca = $("filtro-busca").value.trim().toLowerCase();
  const status = $("filtro-status").value;
  const lista = state.transacoes.filter(t =>
    (periodo === "todos" || mesDe(t.data) === mesAtual) &&
    (!tipo || t.tipo === tipo) && (!cat || t.categoria === cat) &&
    (!status || (status === "pago" ? t.pago : !t.pago)) &&
    (!busca || `${t.descricao} ${t.categoria} ${t.nota}`.toLowerCase().includes(busca))
  ).sort((a, b) => dataVenc(a).localeCompare(dataVenc(b)) || (a.tipo === b.tipo ? 0 : a.tipo === "receita" ? -1 : 1) || a.descricao.localeCompare(b.descricao, "pt"));

  $("lista-transacoes").innerHTML = lista.length ? lista.map(t => `
    <tr class="${t.pago ? "pago" : ""}">
      <td><button class="chk ${t.pago ? "on" : ""}" data-confirmar="${esc(t.id)}" title="${t.pago ? "Desfazer confirmação" : "Confirmar"}">✓</button></td>
      <td>${dataCurta(dataVenc(t))}${t.vencimento ? `<span class="sub">vencimento</span>` : ""}${t.pago ? `<span class="sub pos">${t.tipo === "receita" ? "recebido" : "pago"} ${dataCurta(t.pagoEm)}</span>` : ""}</td>
      <td>${esc(t.descricao)}${t.serieId ? ' <span title="Recorrente">🔄</span>' : ""}${t.valorBRL ? `<span class="sub">${fmtBRL(t.valorBRL)}${t.nota && !t.nota.startsWith("R$") ? " · " + esc(t.nota) : ""}</span>` : t.nota ? `<span class="sub">${esc(t.nota)}</span>` : ""}</td>
      <td><span class="tag">${esc(t.categoria)}</span></td>
      <td class="num ${t.tipo === "receita" ? "pos" : "neg"}"><button class="valor-btn" data-ajustar="${esc(t.id)}" title="Ajustar valor">${t.tipo === "receita" ? "+" : "−"}${fmt(t.valor)}</button></td>
      <td class="actions">
        <button class="icon-btn" data-acao="editar" data-id="${esc(t.id)}" title="Editar">✏️</button>
        <button class="icon-btn" data-acao="remover" data-id="${esc(t.id)}" title="Remover">🗑️</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty">Nenhum lançamento encontrado.</td></tr>`;

  const total = lista.reduce((a, t) => a + sinal(t), 0);
  $("lista-resumo").textContent = `${lista.length} lançamento(s) · ${lista.filter(t => t.pago).length} confirmado(s)`;
  const tot = $("lista-total");
  tot.textContent = fmt(total); tot.className = `num ${total >= 0 ? "pos" : "neg"}`;
}

function limparForm() {
  $("form-transacao").reset();
  $("f-data").value = mesDe(hojeISO()) === mesAtual ? hojeISO() : `${mesAtual}-01`;
  editandoId = null;
  $("btn-salvar").textContent = "Adicionar";
  $("form-titulo").textContent = "Novo lançamento";
  $("btn-cancelar").hidden = true;
  $("f-recorrente").disabled = false;
  $("f-serie-wrap").hidden = true;
  $("f-moeda").value = "EUR"; atualizarConv(); atualizarPagoWrap();
}
function atualizarPagoWrap() {
  const d = $("f-data").value, mostra = !editandoId && !!d && d <= hojeISO();
  $("f-pago-wrap").hidden = !mostra;
  if (mostra && !atualizarPagoWrap._mexeu) $("f-pago").checked = true;
}
function atualizarConv() {
  const v = Number($("f-valor").value);
  $("f-conv").textContent = $("f-moeda").value === "BRL" && v > 0 ? `≈ ${fmt(paraEUR(v))} (1 € = ${fmtTaxa(cambio())})` : "";
}

function editarTransacao(id) {
  const t = state.transacoes.find(x => x.id === id);
  if (!t) return;
  document.querySelector(`input[name="tipo"][value="${t.tipo}"]`).checked = true;
  $("f-data").value = t.data; $("f-pago-wrap").hidden = true;
  $("f-descricao").value = t.descricao;
  $("f-categoria").value = t.categoria;
  $("f-moeda").value = t.valorBRL ? "BRL" : "EUR";
  $("f-valor").value = t.valorBRL || t.valor;
  atualizarConv();
  $("f-vencimento").value = t.vencimento || "";
  $("f-recorrente").checked = false;
  $("f-recorrente").disabled = true;
  const proximos = t.serieId ? state.transacoes.filter(x => x.serieId === t.serieId && x.data > t.data && !x.pago && x.data.slice(8) === t.data.slice(8)).length : 0;
  $("f-serie-wrap").hidden = !proximos; $("f-serie").checked = true;
  if (proximos) $("f-serie-wrap").lastChild.textContent = ` Aplicar também aos próximos ${proximos} desta série (valor, descrição, categoria e vencimento)`;
  editandoId = id;
  $("btn-salvar").textContent = "Guardar alterações";
  $("form-titulo").textContent = "Editar lançamento";
  $("btn-cancelar").hidden = false;
  $("form-transacao").scrollIntoView({ behavior: "smooth", block: "start" });
}

function guardarTransacao(e) {
  e.preventDefault();
  const base = normalizarTransacao({
    id: editandoId || uid(),
    data: $("f-data").value,
    descricao: $("f-descricao").value,
    categoria: $("f-categoria").value,
    tipo: document.querySelector('input[name="tipo"]:checked').value,
    valor: $("f-moeda").value === "BRL" ? paraEUR(Number($("f-valor").value)) : $("f-valor").value,
    valorBRL: $("f-moeda").value === "BRL" ? $("f-valor").value : null,
    vencimento: $("f-vencimento").value || null,
  });
  if (!base.data || !base.descricao || !(base.valor > 0)) { toast("Preencha data, descrição e um valor maior que zero."); return; }
  const jaPago = !editandoId && $("f-pago").checked && base.data <= hojeISO();
  const marcarPago = (t) => { t.pago = true; t.pagoEm = t.data; if (temSaldoReal()) state.config.saldoReal.valor = r2(state.config.saldoReal.valor + sinal(t)); };

  if (editandoId) {
    const i = state.transacoes.findIndex(t => t.id === editandoId);
    const orig = state.transacoes[i];
    if (i !== -1) state.transacoes[i] = { ...orig, ...base, serieId: orig.serieId, nota: base.valorBRL ? orig.nota : (orig.nota || "").replace(/^R\$.*$/, ""), origem: orig.origem, pago: orig.pago, pagoEm: orig.pagoEm, valorPrevisto: orig.valorPrevisto };
    let n = 0;
    if (orig.serieId && !$("f-serie-wrap").hidden && $("f-serie").checked) {
      state.transacoes.forEach(x => {
        if (x.serieId === orig.serieId && x.data > orig.data && !x.pago && x.data.slice(8) === orig.data.slice(8)) {
          Object.assign(x, { descricao: base.descricao, categoria: base.categoria, tipo: base.tipo, valor: base.valor, valorBRL: base.valorBRL, vencimento: base.vencimento }); n++;
        }
      });
    }
    toast(n ? `Lançamento e mais ${n} da série atualizados.` : "Lançamento atualizado.");
  } else if ($("f-recorrente").checked) {
    const serieId = uid();
    for (let i = 0; i < 12; i++) { const t = { ...base, id: uid(), serieId, data: somarMesesData(base.data, i) }; if (i === 0 && jaPago) marcarPago(t); state.transacoes.push(t); }
    toast("Criados 12 lançamentos mensais." + (jaPago ? " O primeiro já conta como pago." : ""));
  } else {
    if (jaPago) marcarPago(base);
    state.transacoes.push(base);
    toast(jaPago ? (base.tipo === "receita" ? "Recebimento registado — saldo real atualizado." : "Pagamento registado — saldo real atualizado.") : "Lançamento adicionado.");
  }
  mesAtual = mesDe(base.data);
  salvar(); limparForm(); render();
}

async function removerTransacao(id) {
  const t = state.transacoes.find(x => x.id === id);
  if (!t) return;
  if (t.serieId) {
    const futuros = state.transacoes.filter(x => x.serieId === t.serieId && x.data >= t.data);
    if (futuros.length > 1 && await perguntar(`Este lançamento repete-se. Remover também os ${futuros.length - 1} seguintes?`, "Este e os seguintes", "Só este")) {
      const ids = new Set(futuros.map(x => x.id));
      state.transacoes = state.transacoes.filter(x => !ids.has(x.id));
      salvar(); render(); toast(`${ids.size} lançamentos removidos.`); return;
    }
  }
  if (!await perguntar(`Remover "${t.descricao}" (${fmt(t.valor)})?`, "Remover")) return;
  state.transacoes = state.transacoes.filter(x => x.id !== id);
  salvar(); render(); toast("Lançamento removido.");
}

/* ---------- Render: Metas ---------- */
/* Financiamento (ex.: consignado descontado no salário): tabela de amortização com antecipações. */
function simularFinanciamento(m, comAntecipacoes = true) {
  const i = (m.taxa || 0) / 100, rows = [];
  let bal = m.alvo, juros = 0, d = m.primeiraParcela || `${mesDe(hojeISO())}-01`;
  const ext = {};
  if (comAntecipacoes) {
    (m.antecipacoes || []).forEach(a => { const k = mesDe(a.data); ext[k] = (ext[k] || 0) + a.valor; });
    // amortizações extra lançadas no orçamento (descrição começa pelo vínculo)
    const v = (m.vinculo || "").trim().toLowerCase();
    if (v) state.transacoes.filter(t => t.tipo === "despesa" && t.descricao.toLowerCase().startsWith(v)).forEach(t => {
      const k = mesDe(t.data); ext[k] = (ext[k] || 0) + (m.moeda === "BRL" ? (t.valorBRL || r2(t.valor * cambio())) : t.valor);
    });
  }
  for (let n = 0; n < 600 && bal > 0.01 && m.parcela > 0 && (n < 240 || bal < m.alvo * 3); n++) {
    const j = r2(bal * i); juros += j; bal += j;
    const p = Math.min(m.parcela, bal); bal -= p;
    const e = Math.min(ext[mesDe(d)] || 0, bal); bal -= e;
    rows.push({ data: d, parcela: r2(p), extra: r2(e), juros: j, saldo: r2(Math.max(0, bal)) });
    d = somarMesesData(d, 1);
  }
  return { rows, juros: r2(juros), quitacao: rows.length ? rows[rows.length - 1].data : null, termina: bal <= 0.01 };
}
function progressoFinanciamento(m) {
  const hoje = hojeISO(), sim = simularFinanciamento(m), base = simularFinanciamento(m, false);
  const passados = sim.rows.filter(r => r.data <= hoje);
  const saldoHoje = passados.length ? passados[passados.length - 1].saldo : m.alvo;
  const atual = r2(m.alvo - saldoHoje);
  return { atual, plano: [], quitacao: sim.termina ? sim.quitacao : null, programado: r2(saldoHoje), ligados: 0, falta: 0, sim, base, saldoHoje };
}

/* Meta ligada a lançamentos: o progresso vem das despesas cuja descrição começa pelo "vínculo". */
function emMoedaMeta(t, m) { return m.moeda === "BRL" ? (t.valorBRL || r2(t.valor * cambio())) : t.valor; }
function progressoMeta(m) {
  if (m.tipo === "financiamento") return progressoFinanciamento(m);
  const hoje = hojeISO();
  const v = (m.vinculo || "").trim().toLowerCase();
  const lig = v ? state.transacoes.filter(t => t.tipo === "despesa" && t.descricao.toLowerCase().startsWith(v)).sort((a, b) => a.data.localeCompare(b.data)) : [];
  const pagoLig = lig.filter(t => t.pago).reduce((a, t) => a + emMoedaMeta(t, m), 0);
  const atual = (m.atual || 0) + pagoLig;
  let acum = atual, quitacao = null;
  const plano = lig.filter(t => !t.pago).map(t => {
    const val = emMoedaMeta(t, m); acum += val;
    const resto = Math.max(0, m.alvo - acum);
    if (!quitacao && acum >= m.alvo - Math.max(1, m.alvo * 0.0005)) quitacao = t.data; // tolerância para arredondamentos de câmbio
    return { t, val, resto };
  });
  const programado = acum - atual;
  return { atual, plano, quitacao, programado, ligados: lig.length, falta: Math.max(0, m.alvo - acum) };
}

function renderMetas() {
  const hoje = hojeISO();
  renderProgressoPlanos(); renderRumo(); renderInvestir();
  $("metas-lista").innerHTML = state.metas.map(m => {
    if (m.tipo === "financiamento") return cardFinanciamento(m);
    const F = (v) => fmtMoeda(v, m.moeda);
    const p = progressoMeta(m);
    const pct = m.alvo ? Math.min(100, (p.atual / m.alvo) * 100) : 0;
    const pctProg = m.alvo ? Math.min(100 - pct, (p.programado / m.alvo) * 100) : 0;
    let linhas = "";
    if (!m.alvo) linhas += `<div class="row"><span class="warn-txt">Defina o valor total (✏️) para acompanhar esta meta.</span></div>`;
    if (m.vinculo) {
      linhas += `<div class="row"><span>Ligada aos lançamentos "${esc(m.vinculo)}"</span><span>${p.ligados} pagamento(s)</span></div>`;
      if (m.alvo) linhas += p.quitacao
        ? `<div class="row"><span>Quitação prevista</span><strong class="pos">${nomeMes(mesDe(p.quitacao))}</strong></div>`
        : `<div class="row"><span>Sem pagamentos suficientes programados</span><span class="neg">faltam ${F(p.falta)}</span></div>`;
    } else if (m.prazo && p.atual < m.alvo) {
      const meses = Math.max(1, (Number(m.prazo.slice(0, 4)) - Number(hoje.slice(0, 4))) * 12 + Number(m.prazo.slice(5, 7)) - Number(hoje.slice(5, 7)));
      linhas += `<div class="row"><span>${m.prazo < hoje ? `<span class="neg">Prazo ultrapassado</span>` : `≈ ${F((m.alvo - p.atual) / meses)} por mês até ${dataCurta(m.prazo)}`}</span></div>`;
    }
    if (m.moeda === "BRL" && m.alvo) linhas += `<div class="row"><span>Em falta ≈ ${fmt(paraEUR(Math.max(0, m.alvo - p.atual)))} ao câmbio de hoje</span></div>`;
    const tabela = p.plano.length ? `<details class="plano"><summary>Ver plano de pagamento (${p.plano.length})</summary>
      <table><thead><tr><th>Mês</th><th class="num">Pagamento</th><th class="num">Fica a dever</th></tr></thead><tbody>
      ${p.plano.map(x => `<tr${x.t.data === p.quitacao ? ' class="quit"' : ""}><td>${MESES_CURTOS[Number(x.t.data.slice(5, 7)) - 1]} ${x.t.data.slice(0, 4)}</td>
        <td class="num">${F(x.val)}${m.moeda === "BRL" && !x.t.valorBRL ? `<span class="sub">${fmt(x.t.valor)}</span>` : ""}</td><td class="num">${F(x.resto)}</td></tr>`).join("")}
      </tbody></table></details>` : "";
    return `<div class="card meta-card">
      <div class="card-head"><h3>${esc(m.nome)}</h3>
        <span><button class="icon-btn" data-editar-meta="${esc(m.id)}" title="Editar">✏️</button><button class="icon-btn" data-remover-meta="${esc(m.id)}" title="Remover">🗑️</button></span></div>
      <div class="big">${F(p.atual)} <span class="muted" style="font-size:15px;font-weight:400">pagos de ${F(m.alvo)}</span></div>
      <div class="bar stack"><i style="width:${pct}%"></i><i class="prog" style="width:${pctProg}%"></i></div>
      <div class="row"><span>${Math.round(pct)}% pago${p.programado ? ` · ${Math.round(pctProg)}% programado` : ""}</span><span>Faltam ${F(Math.max(0, m.alvo - p.atual))}</span></div>
      ${linhas}
      ${m.nota ? `<p class="muted small">${esc(m.nota)}</p>` : ""}
      ${tabela}
      <form class="add" data-aporte="${esc(m.id)}"><input type="number" step="0.01" placeholder="Pagamento extra ${m.moeda === "BRL" ? "R$" : "€"}" required><button class="btn btn-sm" type="submit">+ Registar</button></form>
    </div>`;
  }).join("") || `<div class="card"><p class="empty">Crie a sua primeira meta abaixo — ex.: fundo de emergência ou quitar um crédito.</p></div>`;
}

/* ---------- Rumo a 2032 ---------- */
const HORIZONTE = "2045-12";   // fim do gráfico
const META_LIVRE = "2032-12";  // objetivo: sem dívidas
function emEUR(v, moeda) { return moeda === "BRL" ? paraEUR(v) : v; }
function dividasRumo() {
  const hoje = hojeISO(), out = [];
  // séries/lançamentos de crédito ainda pendentes (exceto financiamentos tratados por metas)
  const grupos = {};
  const fins = state.metas.filter(m => m.tipo === "financiamento");
  const nomesFin = fins.map(m => m.nome.replace(/^(Antecipar|Quitar) /i, "").toLowerCase());
  const vincFin = fins.map(m => (m.vinculo || "").toLowerCase()).filter(Boolean);
  state.transacoes.filter(t => t.categoria === "Crédito" && t.tipo === "despesa" && !t.pago && t.data >= `${mesDe(hoje)}-01`
    && !nomesFin.includes(t.descricao.toLowerCase()) && !vincFin.some(v => t.descricao.toLowerCase().startsWith(v))).forEach(t => {
    const k = t.descricao.replace(/ —.*$/, "");
    (grupos[k] = grupos[k] || []).push(t);
  });
  Object.entries(grupos).forEach(([nome, l]) => {
    l.sort((a, b) => a.data.localeCompare(b.data));
    const fim = mesDe(l[l.length - 1].data);
    out.push({ nome, fim, parcela: l[l.length - 1].valor, restante: l.reduce((a, t) => a + t.valor, 0), aberto: fim >= HORIZONTE, tarde: fim > META_LIVRE, porMes: (ym) => l.filter(t => mesDe(t.data) > ym).reduce((a, t) => a + t.valor, 0) });
  });
  state.metas.forEach(m => {
    if (m.tipo === "financiamento" && m.parcela > 0) {
      const p = progressoFinanciamento(m), fim = p.quitacao ? mesDe(p.quitacao) : HORIZONTE;
      const rows = p.sim.rows;
      out.push({ nome: m.nome.replace(/^(Antecipar|Quitar) /i, ""), fim, parcela: emEUR(m.parcela, m.moeda), restante: emEUR(p.saldoHoje, m.moeda), aberto: !p.quitacao || fim > HORIZONTE, tarde: fim > META_LIVRE,
        porMes: (ym) => { const r = rows.filter(x => mesDe(x.data) <= ym).pop(); return emEUR(r ? r.saldo : m.alvo, m.moeda); } });
    } else if (m.tipo !== "financiamento" && !m.vinculo && m.prazo && /quitar|pagamento|crédito|divida|dívida/i.test(m.nome) && m.atual < m.alvo) {
      const fim = mesDe(m.prazo), rest = emEUR(m.alvo - m.atual, m.moeda);
      out.push({ nome: m.nome.replace(/^(Plano Pagamento|Quitar) /, ""), fim, parcela: null, restante: rest, aberto: false, fora: true, porMes: (ym) => (ym < fim ? rest : 0) });
    }
  });
  return out.sort((a, b) => a.fim.localeCompare(b.fim));
}
function renderRumo() {
  if (!$("rumo")) return;
  const hoje = hojeISO(), inicio = mesDe(hoje);
  const meses = []; for (let ym = inicio; ym <= HORIZONTE; ym = somarMeses(ym, 1)) meses.push(ym);
  const divs = dividasRumo();
  const reservaMeta = state.metas.find(m => /reserva/i.test(m.nome));
  const resLig = reservaMeta && reservaMeta.vinculo ? state.transacoes.filter(t => t.descricao.toLowerCase().startsWith(reservaMeta.vinculo.toLowerCase())) : [];
  const serie = meses.map(ym => {
    const fim = fimDoMes(ym);
    const divida = divs.reduce((a, d) => a + d.porMes(ym), 0);
    const reserva = (reservaMeta ? emEUR(reservaMeta.atual, reservaMeta.moeda) : 0) + resLig.filter(t => t.data <= fim).reduce((a, t) => a + t.valor, 0);
    return { ym, divida, reserva, saldo: saldoPrevisto(fim) };
  });
  // gráfico
  const W = 900, H = 240, pl = 46, pr = 10, pt = 12, pb = 26;
  const max = Math.max(1, ...serie.flatMap(x => [x.divida, x.reserva, x.saldo]));
  const min = Math.min(0, ...serie.map(x => x.saldo));
  const X = (i) => pl + (i / Math.max(1, serie.length - 1)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
  const path = (k) => serie.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join("");
  let g = "";
  for (let k = 0; k <= 4; k++) { const v = min + (k * (max - min)) / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)" stroke-dasharray="2 4"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end">${Math.round(v / 1000)}k</text>`; }
  if (min < 0) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--muted)"/>`;
  serie.forEach((x, i) => { if (x.ym.endsWith("-01")) { const y = Number(x.ym.slice(0, 4)); g += `<line x1="${X(i)}" x2="${X(i)}" y1="${pt}" y2="${H - pb}" stroke="var(--border)"/>${y % 2 === 0 ? `<text x="${X(i) + 3}" y="${H - 8}">${y}</text>` : ""}`; } });
  const iMeta = meses.indexOf(META_LIVRE);
  if (iMeta >= 0) g += `<line x1="${X(iMeta)}" x2="${X(iMeta)}" y1="${pt}" y2="${H - pb}" stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1.5"/><text x="${X(iMeta) - 4}" y="${pt + 10}" text-anchor="end" style="fill:var(--warn);font-weight:600">meta 2032</text>`;
  divs.filter(d => !d.aberto && d.fim >= inicio).forEach(d => { const i = meses.indexOf(d.fim); if (i >= 0) g += `<circle cx="${X(i)}" cy="${Y(serie[i].divida)}" r="3.5" fill="var(--neg)"><title>${esc(d.nome)} termina em ${nomeMes(d.fim)}</title></circle>`; });
  g += `<path d="${path("divida")}" fill="none" stroke="var(--neg)" stroke-width="2.2"/><path d="${path("reserva")}" fill="none" stroke="var(--pos)" stroke-width="2.2"/><path d="${path("saldo")}" fill="none" stroke="var(--c2)" stroke-width="1.6" stroke-dasharray="4 3"/>`;
  const ult = serie[serie.length - 1];
  g += `<text x="${W - pr}" y="${Y(ult.reserva) - 6}" text-anchor="end" style="fill:var(--pos);font-weight:600">${fmt(ult.reserva)}</text>`;
  $("rumo-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projeção até 2032">${g}</svg>`;
  // lista
  $("rumo-dividas").innerHTML = divs.map(d => `<li class="${d.aberto || d.tarde ? "aberto" : d.fim < inicio ? "feito" : ""}">
      <strong>${esc(d.nome)}</strong><span class="fim">${d.aberto ? "sem data de fim" : nomeMes(d.fim)}</span>
      <span class="muted">${d.parcela ? `${fmt(d.parcela)}/mês · ` : ""}falta ≈ ${fmt(d.restante)}${d.fora ? " · fora do orçamento" : ""}</span><span></span></li>`).join("");
  const abertos = divs.filter(d => d.aberto), livre = divs.length ? divs[divs.length - 1].fim : inicio;
  const st = $("rumo-status");
  if (abertos.length) { st.className = "cons-score atencao"; st.textContent = `${abertos.length} sem data de fim`; }
  else if (livre <= META_LIVRE) { st.className = "cons-score bom"; st.textContent = `Sem dívidas em ${nomeMes(livre)}`; }
  else { st.className = "cons-score atencao"; st.textContent = `Sem dívidas em ${nomeMes(livre)} (meta: 2032)`; }
}

/* ---------- Cumprimento dos planos ---------- */
function renderProgressoPlanos() {
  if (!$("pp-lista")) return;
  const itens = state.metas.filter(m => m.alvo > 0).map(m => {
    const p = progressoMeta(m), F = (v) => fmtMoeda(v, m.moeda);
    const pct = Math.max(0, Math.min(100, (p.atual / m.alvo) * 100));
    const sub = pct >= 99.95 ? "Concluído 🎉" : `${F(p.atual)} de ${F(m.alvo)}${p.quitacao ? ` · termina em ${nomeMes(mesDe(p.quitacao))}` : ""}`;
    return { nome: m.nome, pct, sub };
  }).sort((a, b) => b.pct - a.pct);
  $("pp-lista").innerHTML = itens.map(i => `<div class="pp-row ${i.pct >= 99.95 ? "feito" : ""}">
      <div class="pp-top"><span>${esc(i.nome)}</span><span class="pp-pct">${Math.round(i.pct)}%</span></div>
      <div class="bar ${i.pct >= 99.95 ? "" : i.pct < 25 ? "warn" : ""}"><i style="width:${i.pct}%"></i></div>
      <span class="pp-sub">${i.sub}</span></div>`).join("") || `<p class="empty">Sem metas.</p>`;
  const feitos = itens.filter(i => i.pct >= 99.95).length;
  $("pp-resumo").textContent = `${feitos} de ${itens.length} concluídos`;
}

/* ---------- Painel diário (página para o resumo das 8h) ---------- */
async function painelDiario() {
  const hoje = hojeISO(), mesH = mesDe(hoje), fim7 = somarDias(hoje, 7);
  const e = (x) => esc(x);
  // câmbio: hoje + 30 dias
  let fx = { bid: cambio(), pct: null, var: null, hist: [] };
  try {
    const [last, hist] = await Promise.all([
      fetch(CAMBIO_API, { cache: "no-store" }).then(r => r.json()),
      fetch("https://economia.awesomeapi.com.br/json/daily/EUR-BRL/30", { cache: "no-store" }).then(r => r.json()),
    ]);
    fx.bid = Number(last.EURBRL.bid); fx.pct = Number(last.EURBRL.pctChange); fx.var = Number(last.EURBRL.varBid);
    fx.hist = hist.map(h => ({ t: Number(h.timestamp) * 1000, v: Number(h.bid) })).filter(h => h.v > 0).sort((a, b) => a.t - b.t);
    if (Math.abs(fx.bid - cambio()) > 0.0001) { state.config.cambioAnterior = { ...state.config.cambio }; state.config.cambio = { valor: Math.round(fx.bid * 10000) / 10000, data: last.EURBRL.create_date, fonte: "AwesomeAPI" }; aplicarCambio(); salvar(); }
  } catch (err) { console.warn("câmbio", err); }
  const salBRL = state.transacoes.filter(t => t.valorBRL && t.tipo === "receita" && /sal[áa]rio/i.test(t.descricao) && mesDe(t.data) === somarMeses(mesH, 1)).reduce((a, t) => a + t.valorBRL, 0);
  const sr = temSaldoReal() ? state.config.saldoReal.valor : null, prevFim = saldoPrevisto(fimDoMes(mesH));
  const prox = state.transacoes.filter(t => !t.pago && dataVenc(t) <= fim7 && t.data >= `${mesH}-01`).sort((a, b) => dataVenc(a).localeCompare(dataVenc(b)) || (a.tipo === "receita" ? -1 : 1));
  const atras = prox.filter(t => dataVenc(t) < hoje);
  const { ins } = calcularInsights();
  const alertas = ins.filter(i => i.tom === "alto" || i.tom === "medio").slice(0, 5);
  const metas = state.metas.filter(m => m.alvo > 0).map(m => { const p = progressoMeta(m); return { nome: m.nome, pct: Math.max(0, Math.min(100, (p.atual / m.alvo) * 100)), fim: p.quitacao }; }).sort((a, b) => b.pct - a.pct);
  const doy = Math.floor((Date.parse(hoje) - Date.parse(hoje.slice(0, 4) + "-01-01")) / 864e5);
  const dia = new Date().toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  const fmtR = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  // sparkline do câmbio
  let spark = "";
  if (fx.hist.length > 1) {
    const W = 560, H = 120, vs = fx.hist.map(h => h.v), mn = Math.min(...vs), mx = Math.max(...vs), rg = mx - mn || 1;
    const X = i => 8 + (i / (vs.length - 1)) * (W - 16), Y = v => 10 + (1 - (v - mn) / rg) * (H - 30);
    const d = vs.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    spark = `<svg viewBox="0 0 ${W} ${H}" class="spark" role="img" aria-label="Euro em reais, últimos 30 dias"><path d="${d} L${X(vs.length - 1)},${H - 20} L${X(0)},${H - 20}Z" fill="rgba(0,224,122,.12)"/><path d="${d}" fill="none" stroke="#00e07a" stroke-width="2.5"/><circle cx="${X(vs.length - 1)}" cy="${Y(vs[vs.length - 1])}" r="4" fill="#00e07a"/><text x="8" y="${H - 4}">mín ${fmtR(mn)}</text><text x="${W - 8}" y="${H - 4}" text-anchor="end">máx ${fmtR(mx)}</text></svg>`;
  }
  const corPct = fx.pct == null ? "" : fx.pct > 0 ? "neg" : "pos"; // euro mais caro = pior para quem recebe em reais? (melhor: cada real vale menos) → para o salário em R$, euro a subir é mau
  const linhaMov = (t) => { const dv = dataVenc(t), rec = t.tipo === "receita"; return `<tr class="${dv < hoje ? "atr" : ""}"><td>${dv.slice(8)}/${dv.slice(5, 7)}${dv < hoje ? " ⚠" : ""}</td><td>${e(t.descricao)}</td><td class="num ${rec ? "pos" : "neg"}">${rec ? "+" : "−"}${e(fmt(t.valor))}</td></tr>`; };
  const html = `<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Painel do dia</title>
<style>
/* VOICE: calma, direta, de quem tem um plano. IDEA: o boletim da manhã de um banco familiar. PICTURE: o saldo e o câmbio grandes no topo. COLOUR: noite verde-escura do app, verde e vermelho só para dinheiro. TYPE: sistema, números tabulares. LAYOUT: cartões em grelha que empilham no telemóvel. */
:root{color-scheme:light dark;--bg:light-dark(#f4f7f5,#0b0f0d);--card:light-dark(#fff,#131a17);--ink:light-dark(#0e1512,#e8efeb);--mut:light-dark(#5b6b63,#8a9b93);--line:light-dark(#dfe7e2,#25312c);--pos:light-dark(#0a8f52,#2fd38a);--neg:light-dark(#c62f2f,#ff6b6b);--warn:light-dark(#a36a00,#f5b041)}
:root[data-theme=light]{color-scheme:light}:root[data-theme=dark]{color-scheme:dark}
*{box-sizing:border-box;min-width:0}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;overflow-x:clip}
.wrap{max-width:1000px;margin:0 auto;padding:clamp(18px,4vw,40px) max(4vw,14px)}
h1{font-size:clamp(26px,4.4vw,40px);line-height:1.08;margin:0 0 6px;text-wrap:balance}.sub{color:var(--mut);margin:0 0 22px;text-transform:capitalize}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.card h2{font-size:15px;margin:0 0 10px;color:var(--mut);font-weight:600}.big{font-size:clamp(28px,5vw,40px);font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.pos{color:var(--pos)}.neg{color:var(--neg)}.mut{color:var(--mut)}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:15px}td{padding:7px 4px;border-bottom:1px solid var(--line)}tr:last-child td{border-bottom:0}tr.atr td{color:var(--neg)}
.spark{width:100%;height:auto;display:block}.spark text{fill:var(--mut);font-size:12px}
ul{margin:0;padding-left:0;list-style:none;display:grid;gap:8px}li{font-size:15px}
.bar{height:8px;background:var(--line);border-radius:9px;overflow:hidden}.bar i{display:block;height:100%;background:var(--pos)}.mrow{display:grid;gap:4px;padding:6px 0}.mtop{display:flex;justify-content:space-between;gap:8px;font-size:14px}
.dica{border-left:3px solid var(--pos);padding:6px 12px;color:var(--mut);margin-top:14px}a{color:var(--pos)}
.foot{color:var(--mut);font-size:13px;margin-top:18px}
</style></head><body><div class="wrap">
<h1>${prevFim >= 0 ? `Mês no azul: ${e(fmt(prevFim))} previstos no fim de ${MESES[Number(mesH.slice(5)) - 1]}` : `Atenção: ${e(fmt(prevFim))} previstos no fim de ${MESES[Number(mesH.slice(5)) - 1]}`}</h1>
<p class="sub">${e(dia)} · ${prox.length} movimento(s) nos próximos 7 dias${atras.length ? ` · ${atras.length} atrasado(s)` : ""}</p>
<div class="grid">
 <div class="card"><h2>Saldo real na conta</h2><div class="big ${sr != null && sr < 0 ? "neg" : ""}">${sr != null ? e(fmt(sr)) : "—"}</div><div class="mut">Previsto no fim do mês: <strong class="${prevFim < 0 ? "neg" : "pos"}">${e(fmt(prevFim))}</strong></div></div>
 <div class="card"><h2>Euro hoje</h2><div class="big">${e(fmtR(fx.bid))}</div><div class="mut">${fx.pct != null ? `<strong class="${corPct}">${fx.pct > 0 ? "▲" : fx.pct < 0 ? "▼" : "="} ${Math.abs(fx.pct).toFixed(2).replace(".", ",")}%</strong> desde ontem` : "sem variação disponível"}${salBRL ? ` · salário de ${e(fmtBRL(salBRL))} ≈ <strong>${e(fmt(salBRL / fx.bid))}</strong>` : ""}</div>${spark}</div>
</div>
<div class="grid" style="margin-top:14px">
 <div class="card"><h2>Próximos 7 dias</h2>${prox.length ? `<table>${prox.map(linhaMov).join("")}</table>` : `<p class="mut">Nada previsto. 🎉</p>`}</div>
 <div class="card"><h2>Alertas do conselheiro</h2>${alertas.length ? `<ul>${alertas.map(i => `<li>${i.ic} ${i.txt}</li>`).join("")}</ul>` : `<p class="mut">Sem alertas. Tudo dentro do plano.</p>`}</div>
</div>
<div class="card" style="margin-top:14px"><h2>Cumprimento dos planos</h2>${metas.map(m => `<div class="mrow"><div class="mtop"><span>${e(m.nome)}</span><span>${Math.round(m.pct)}%${m.fim && m.pct < 99.95 ? ` · ${e(nomeMes(mesDe(m.fim)))}` : ""}</span></div><div class="bar"><i style="width:${m.pct}%"></i></div></div>`).join("")}</div>
<div class="dica">💡 <strong>Dica do dia:</strong> ${DICAS[doy % DICAS.length]}</div>
<p class="foot">Gerado às ${new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })} a partir do app Finanças Família · câmbio AwesomeAPI · <a href="https://zazzouneto.github.io/financas-familia/">abrir o app</a> para confirmar pagamentos.</p>
</div></body></html>`;
  const txt = (s) => String(s).replace(/<[^>]+>/g, "");
  const resumo = [
    `Saldo real ${sr != null ? fmt(sr) : "—"} · fim de ${MESES[Number(mesH.slice(5)) - 1]} ${fmt(prevFim)}`,
    `Euro ${fmtR(fx.bid)}${fx.pct != null ? ` (${fx.pct > 0 ? "+" : ""}${fx.pct.toFixed(2).replace(".", ",")}% desde ontem)` : ""}`,
    prox.length ? `Próximos 7 dias: ${prox.slice(0, 6).map(t => `${dataVenc(t).slice(8)}/${dataVenc(t).slice(5, 7)} ${t.descricao} ${t.tipo === "receita" ? "+" : "−"}${fmt(t.valor)}`).join("; ")}` : "Próximos 7 dias: nada previsto",
    ...alertas.slice(0, 3).map(i => "⚠ " + txt(i.txt)),
  ].join("\n");
  return { html, resumo };
}

/* ---------- Conselheiro de investimentos ---------- */
const INV_DESC = "Investimento mensal";
function renderInvestir() {
  if (!$("investir")) return;
  const hoje = hojeISO(), mesH = mesDe(hoje);
  const inv = state.transacoes.filter(t => t.descricao.startsWith(INV_DESC)).sort((a, b) => a.data.localeCompare(b.data));
  const pagos = inv.filter(t => t.pago), total = pagos.reduce((a, t) => a + t.valor, 0);
  const atual = inv.find(t => mesDe(t.data) === mesH) || inv.find(t => t.data >= hoje);
  $("inv-total").textContent = fmt(total);
  $("inv-mes").textContent = atual ? fmt(atual.valor) : "—";
  // meses seguidos com investimento confirmado (até ao mês atual)
  let seq = 0; for (let ym = mesH; ; ym = somarMeses(ym, -1)) { const t = inv.find(x => mesDe(x.data) === ym); if (t && t.pago) seq++; else if (ym !== mesH || (t && !t.pago && dataVenc(t) < hoje)) break; if (seq > 600) break; }
  $("inv-seq").textContent = String(seq);
  // fase conforme as dívidas
  const fins = state.metas.filter(m => m.tipo === "financiamento").map(m => ({ m, q: progressoFinanciamento(m).quitacao }));
  const caras = fins.filter(x => x.m.taxa >= 0.8 && (!x.q || x.q > hoje));
  const hip = fins.find(x => /hipoteca/i.test(x.m.nome));
  let fase, cls, dicas = [];
  const fimCaras = caras.length ? caras.map(x => x.q || HORIZONTE).sort().pop() : null;
  if (caras.length) {
    fase = "Fase 1 · criar o hábito"; cls = "atencao";
    dicas.push(["🌱", `Agora o objetivo é a <strong>constância</strong>, não o retorno: ${atual ? fmt(atual.valor) : "um valor fixo"} todos os meses, sem falhar.`]);
    dicas.push(["⚖️", `Ainda há dívidas a ${caras.map(x => `${String(x.m.taxa).replace(".", ",")}% a.m.`).join(" e ")} — pagar dívida é um "retorno" garantido maior do que qualquer investimento seguro. Por isso o valor fica pequeno até ${fimCaras ? nomeMes(mesDe(fimCaras)) : "as quitar"}.`]);
    dicas.push(["🛡️", "Com dinheiro que pode precisar a curto prazo, prefira algo <strong>sem risco de perda</strong> (conta remunerada, Certificados de Aforro). Ações/ETF só para dinheiro que não vai tocar durante 5+ anos."]);
  } else if (hip && (!hip.q || hip.q > hoje)) {
    fase = "Fase 2 · acelerar"; cls = "bom";
    dicas.push(["🚀", "As dívidas caras acabaram. Pode subir o investimento mensal — por exemplo, dividir a sobra entre amortizar a hipoteca e investir."]);
    dicas.push(["🌍", "Para 5+ anos, um ETF de ações globais diversificado e de baixo custo é o caminho mais comum; reveja e reequilibre uma vez por ano."]);
  } else {
    fase = "Fase 3 · construir património"; cls = "bom";
    dicas.push(["🏁", "Sem dívidas: a sobra mensal pode ir quase toda para investimento de longo prazo, mantendo a reserva de emergência."]);
  }
  if (atual && !atual.pago) dicas.unshift(["📅", `Investimento deste mês (${fmt(atual.valor)}) ainda por confirmar.`, `<button class="btn btn-sm" data-confirmar="${esc(atual.id)}">Feito ✓</button>`]);
  dicas.push(["🧾", "Em Portugal, ganhos e juros pagam em regra 28% de IRS; numa corretora estrangeira terá de declarar no Anexo J."]);
  const f = $("inv-fase"); f.className = "cons-score " + cls; f.textContent = fase;
  $("inv-dicas").innerHTML = dicas.map(([ic, txt, acao]) => `<li class="info"><span class="ic">${ic}</span><span>${txt}</span>${acao ? `<span class="acao">${acao}</span>` : ""}</li>`).join("");
  // simulação até 2045
  const meses = []; for (let ym = inv.length ? mesDe(inv[0].data) : mesH; ym <= HORIZONTE; ym = somarMeses(ym, 1)) meses.push(ym);
  const cen = [0, 0.025, 0.07].map(a => { let v = 0; const r = Math.pow(1 + a, 1 / 12) - 1; return meses.map(ym => { v = v * (1 + r) + inv.filter(t => mesDe(t.data) === ym).reduce((s, t) => s + t.valor, 0); return v; }); });
  const W = 900, H = 200, pl = 46, pr = 70, pt = 10, pb = 24, max = Math.max(1, ...cen[2]);
  const X = i => pl + (i / Math.max(1, meses.length - 1)) * (W - pl - pr), Y = v => pt + (1 - v / max) * (H - pt - pb);
  let g = "";
  for (let k = 0; k <= 4; k++) { const v = (k * max) / 4; g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)" stroke-dasharray="2 4"/><text x="${pl - 6}" y="${Y(v) + 3}" text-anchor="end">${v >= 1000 ? Math.round(v / 1000) + "k" : Math.round(v)}</text>`; }
  meses.forEach((ym, i) => { if (ym.endsWith("-01") && Number(ym.slice(0, 4)) % 2 === 0) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${ym.slice(0, 4)}</text>`; });
  const cores = ["var(--muted)", "var(--c2)", "var(--pos)"];
  cen.forEach((c, k) => { g += `<path d="${c.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("")}" fill="none" stroke="${cores[k]}" stroke-width="2"/><text x="${W - pr + 6}" y="${Y(c[c.length - 1]) + 4}" style="fill:${cores[k]};font-weight:600">${fmt(c[c.length - 1]).replace(/,\d\d/, "")}</text>`; });
  $("inv-chart").innerHTML = meses.length > 1 ? `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Simulação de investimentos">${g}</svg>` : `<p class="empty">Ainda sem investimentos planeados.</p>`;
}
async function conversarInvestimentos() {
  const inv = state.transacoes.filter(t => t.descricao.startsWith(INV_DESC));
  const pagos = inv.filter(t => t.pago).reduce((a, t) => a + t.valor, 0);
  const fins = state.metas.filter(m => m.tipo === "financiamento").map(m => `${m.nome} ${String(m.taxa).replace(".", ",")}% a.m. (quitação ${progressoFinanciamento(m).quitacao || "?"})`).join("; ");
  const txt = `Investidor iniciante em Portugal: quero orientação para investir. Invisto ${inv[0] ? fmt(inv[0].valor) : "€10"}/mês desde ${inv[0] ? nomeMes(mesDe(inv[0].data)) : "novembro 2026"}; já investido e confirmado: ${fmt(pagos)}. Tenho reserva de emergência em construção e estas dívidas: ${fins}. Onde devo pôr estes valores agora e como evoluir o plano quando as dívidas acabarem?`;
  try { await navigator.clipboard.writeText(txt); } catch (e) {}
  abrirLinkClaude(txt);
}
function abrirLinkClaude(txt) {
  const url = "https://claude.ai/new?q=" + encodeURIComponent(txt);
  abrirModal({ titulo: "Conversar com o conselheiro", sub: "O resumo já foi copiado.", ok: "Fechar", onOk: () => true,
    campos: `<p style="margin:0">Toque no link para abrir uma conversa nova com o resumo. Se abrir vazia, cole (Ctrl+V) e envie.</p><p><a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener">Abrir o Claude</a></p>` });
}

function cardFinanciamento(m) {
  const F = (v) => fmtMoeda(v, m.moeda), p = progressoFinanciamento(m), hoje = hojeISO();
  const pct = m.alvo ? Math.min(100, (p.atual / m.alvo) * 100) : 0;
  const curto = (d) => `${MESES_CURTOS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  const econ = r2(p.base.juros - p.sim.juros), mesesAntes = p.base.rows.length - p.sim.rows.length;
  const ant = [...(m.antecipacoes || [])].sort((a, b) => a.data.localeCompare(b.data));
  const antTot = ant.reduce((a, x) => a + x.valor, 0);
  const extraMes = {}; p.sim.rows.forEach(r => (extraMes[r.data] = r));
  return `<div class="card meta-card">
    <div class="card-head"><h3>${esc(m.nome)}</h3>
      <span><button class="icon-btn" data-editar-meta="${esc(m.id)}" title="Editar">✏️</button><button class="icon-btn" data-remover-meta="${esc(m.id)}" title="Remover">🗑️</button></span></div>
    <div class="big">${F(p.saldoHoje)} <span class="muted" style="font-size:15px;font-weight:400">em dívida hoje</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="row"><span>${Math.round(pct)}% amortizado de ${F(m.alvo)}</span><span>Parcela ${F(m.parcela)}/mês · ${String(m.taxa).replace(".", ",")}% a.m.</span></div>
    ${p.quitacao ? `<div class="row"><span>Quitação prevista</span><strong class="pos">${nomeMes(mesDe(p.quitacao))}</strong></div>`
      : m.parcela > 0 ? `<div class="row"><span class="neg">A parcela quase não cobre os juros (${F(r2(m.alvo * m.taxa / 100))}/mês): sem amortizações extra não termina.</span></div>`
      : `<div class="row"><span class="warn-txt">Defina parcela, taxa e 1ª parcela (✏️) para ver o plano.</span></div>`}
    ${ant.length && p.base.quitacao ? `<div class="row"><span>Sem antecipações: ${nomeMes(mesDe(p.base.quitacao))}</span><span class="pos">${mesesAntes} meses antes · poupa ${F(econ)} de juros</span></div>` : ""}
    <div class="row"><span>Juros até ao fim</span><span>${F(p.sim.juros)}</span></div>
    ${m.nota ? `<p class="muted small">${esc(m.nota)}</p>` : ""}
    <details class="plano"><summary>Antecipações planeadas (${ant.length}) · ${F(antTot)}</summary>
      <ul class="ant-lista">${ant.map(a => `<li><span>${dataCurta(a.data)}</span><span>${esc(a.nota || "Antecipação")}</span><strong>${F(a.valor)}</strong>${a.pago ? `<span class="pos small">feito</span>` : `<button class="icon-btn" data-rem-ant="${esc(m.id)}|${esc(a.id)}" title="Remover">✕</button>`}</li>`).join("") || `<li class="muted">Nenhuma antecipação planeada.</li>`}</ul>
      <form class="add ant-form" data-add-ant="${esc(m.id)}"><input type="month" required value="${mesDe(hoje)}"><input type="number" step="0.01" min="0" placeholder="Valor ${m.moeda === "BRL" ? "R$" : "€"}" required><input type="text" placeholder="Origem (ex.: 13º)"><button class="btn btn-sm" type="submit">Planear</button></form>
    </details>
    ${p.sim.rows.length ? `<details class="plano"><summary>Ver tabela de amortização (${p.sim.rows.length} parcelas)</summary>
      <table><thead><tr><th>Mês</th><th class="num">Parcela</th><th class="num">Antecipação</th><th class="num">Juros</th><th class="num">Saldo</th></tr></thead><tbody>
      ${p.sim.rows.map(r => `<tr class="${r.data <= hoje ? "pago" : ""}${r.saldo === 0 ? " quit" : ""}"><td>${curto(r.data)}</td><td class="num">${F(r.parcela)}</td><td class="num">${r.extra ? F(r.extra) : "—"}</td><td class="num">${F(r.juros)}</td><td class="num">${F(r.saldo)}</td></tr>`).join("")}
      </tbody></table></details>` : ""}
    <form class="add" data-aporte="${esc(m.id)}"><input type="number" step="0.01" placeholder="Antecipação feita hoje ${m.moeda === "BRL" ? "R$" : "€"}" required><button class="btn btn-sm" type="submit">+ Registar</button></form>
  </div>`;
}

function limparFormMeta() {
  $("form-meta").reset(); $("m-atual").value = 0;
  editandoMetaId = null; $("m-salvar").textContent = "Criar meta"; $("meta-form-titulo").textContent = "Nova meta"; $("m-cancelar").hidden = true;
}

/* ---------- Render: Dados ---------- */
function renderDados() {
  const ub = state.config.ultimoBackup;
  $("backup-info").textContent = ub ? `Última cópia: ${dataCurta(ub)}` : "Ainda sem cópias de segurança.";
  const c = state.config.cambio || {};
  $("cambio-info").innerHTML = `<strong style="font-size:20px">1 € = ${fmtTaxa(cambio())}</strong> <span class="muted small">${c.data ? `${esc(c.fonte || "manual")} · ${esc(c.data)}` : "valor da planilha (ainda não atualizado)"}</span>`;
  $("u-nome").value = (JSON.parse(LS.get(USER_KEY) || "{}").username) || "";
}

/* ---------- Agenda (.ics) ---------- */
function exportarICS() {
  const hoje = hojeISO(), fim = somarDias(hoje, 366);
  const itens = state.transacoes.filter(t => !t.pago && dataVenc(t) >= hoje && dataVenc(t) <= fim);
  const dt = (d) => d.replace(/-/g, "");
  const escI = (x) => String(x).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const linhas = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Financas Familia//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Finanças Família"];
  itens.forEach(t => {
    const d = dataVenc(t), rec = t.tipo === "receita";
    const titulo = `${rec ? "💰 Receber" : "💸 Pagar"}: ${t.descricao} ${t.valorBRL ? fmtBRL(t.valorBRL) : fmt(t.valor)}`;
    linhas.push("BEGIN:VEVENT", `UID:${t.id}@financas-familia`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${dt(d)}`, `DTEND;VALUE=DATE:${dt(somarDias(d, 1))}`,
      `SUMMARY:${escI(titulo)}`, `DESCRIPTION:${escI(`${t.categoria} · ${fmt(t.valor)}${t.nota ? " · " + t.nota : ""}\nConfirme no app: https://zazzouneto.github.io/financas-familia/`)}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escI(titulo)}`, "TRIGGER:-PT15H", "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escI(titulo)}`, "TRIGGER:PT9H", "END:VALARM",
      "END:VEVENT");
  });
  linhas.push("END:VCALENDAR");
  baixar(`financas-familia-agenda-${hoje}.ics`, linhas.join("\r\n"), "text/calendar;charset=utf-8");
  toast(`${itens.length} eventos exportados para a agenda.`);
}

/* ---------- Import / export ---------- */
async function baixar(nome, conteudo, tipo) {
  if (NO_CLAUDE) {
    try { const dl = await window.claude.use("downloads"); if (dl) { await dl.save({ filename: nome, data: new Blob([conteudo], { type: tipo }) }); return; } } catch (e) { console.warn("download", e); toast("Download cancelado ou indisponível."); return; }
  }
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportarCSV() {
  const linhas = [["Data", "Tipo", "Descrição", "Categoria", "Valor €", "Valor R$", "Vencimento", "Estado", "Confirmado em", "Nota"]];
  [...state.transacoes].sort((a, b) => a.data.localeCompare(b.data)).forEach(t =>
    linhas.push([t.data, t.tipo, t.descricao, t.categoria, String(t.valor).replace(".", ","), t.valorBRL ? String(t.valorBRL).replace(".", ",") : "", t.vencimento || "", t.pago ? "confirmado" : "pendente", t.pagoEm, t.nota]));
  const csv = linhas.map(l => l.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
  baixar(`impactfinance-${hojeISO()}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
}
async function importar() {
  const f = $("import-file").files[0];
  const msg = $("import-msg");
  if (!f) { msg.textContent = "Escolha um ficheiro .json primeiro."; return; }
  try {
    const dados = JSON.parse(await f.text());
    const tx = (Array.isArray(dados) ? dados : dados.transacoes || []).filter(t => t && t.data).map(normalizarTransacao);
    const substituir = $("import-substituir").checked;
    if (substituir && !await perguntar("Isto apaga todos os dados atuais e substitui pelos do ficheiro. Continuar?", "Substituir")) return;
    if (substituir) state = estadoVazio();
    const ids = new Map(state.transacoes.map((t, i) => [t.id, i]));
    let novos = 0, atualizados = 0;
    tx.forEach(t => { if (ids.has(t.id)) { state.transacoes[ids.get(t.id)] = t; atualizados++; } else { state.transacoes.push(t); novos++; } });
    (dados.orcamentos || []).forEach(o => {
      const i = state.orcamentos.findIndex(x => x.categoria === o.categoria);
      const item = { categoria: String(o.categoria), limite: Number(o.limite) || 0 };
      i === -1 ? state.orcamentos.push(item) : (state.orcamentos[i] = item);
    });
    (dados.metas || []).forEach(m => {
      const item = normalizarMeta(m);
      const i = state.metas.findIndex(x => x.id === item.id);
      i === -1 ? state.metas.push(item) : (state.metas[i] = item);
    });
    if (dados.config && dados.config.saldoInicial) state.config.saldoInicial = dados.config.saldoInicial;
    if (dados.config && dados.config.saldoReal) state.config.saldoReal = dados.config.saldoReal;
    if (dados.config && dados.config.cambio && substituir) state.config.cambio = dados.config.cambio;
    aplicarCambio();
    salvar();
    const meses = [...new Set(tx.map(t => mesDe(t.data)))].sort();
    if (meses.length) {
      const h = mesDe(hojeISO());
      mesAtual = h >= meses[0] && h <= meses[meses.length - 1] ? h : meses[meses.length - 1];
    }
    msg.textContent = `Importado: ${novos} novos, ${atualizados} atualizados, ${(dados.metas || []).length} meta(s), ${(dados.orcamentos || []).length} limite(s).`;
    render(); toast("Importação concluída.");
  } catch (e) {
    console.error(e); msg.textContent = "Não foi possível ler o ficheiro: " + e.message;
  }
}

/* ---------- Navegação ---------- */
function mostrarView(v) {
  viewAtual = v;
  document.querySelectorAll(".view").forEach(s => (s.hidden = s.id !== `view-${v}`));
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  $("monthbar").hidden = v === "metas" || v === "dados";
  render();
  window.scrollTo({ top: 0 });
}
function render() {
  $("mes-label").textContent = nomeMes(mesAtual);
  $("fx-pill").textContent = `1 € = ${fmtTaxa(cambio())}`;
  renderSaldoBar(); renderConselheiro();
  if (viewAtual === "dashboard") renderDashboard();
  if (viewAtual === "lancamentos") renderLancamentos();
  if (viewAtual === "metas") renderMetas();
  if (viewAtual === "dados") renderDados();
}

/* ---------- Login ---------- */
if (!LS.get(USER_KEY)) LS.set(USER_KEY, JSON.stringify({ username: "admin", password: "1234" }));
function mostrarApp() { $("login-section").hidden = true; $("app-section").hidden = false; $("cons-fab").hidden = false; limparForm(); irParaInicio(); }
function irParaInicio() { viewAtual = "dashboard"; mesAtual = mesDe(hojeISO()); mostrarView("dashboard"); window.scrollTo({ top: 0 }); }
function mostrarLogin() { $("login-section").hidden = false; $("app-section").hidden = true; $("cons-fab").hidden = true; }

$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const u = JSON.parse(LS.get(USER_KEY) || "{}");
  if ($("login-username").value.trim() === u.username && $("login-password").value === u.password) {
    LS.set(SESSION_KEY, "true"); $("login-msg").textContent = ""; mostrarApp();
  } else {
    $("login-msg").textContent = "Utilizador ou senha inválidos."; $("login-msg").style.color = "var(--neg)";
  }
});
$("btn-logout").addEventListener("click", () => { LS.set(SESSION_KEY, "false"); mostrarLogin(); });

/* ---------- Eventos ---------- */
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) mostrarView(b.dataset.view); });
document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => mostrarView(b.dataset.goto)));
$("mes-anterior").addEventListener("click", () => { mesAtual = somarMeses(mesAtual, -1); render(); });
$("mes-seguinte").addEventListener("click", () => { mesAtual = somarMeses(mesAtual, 1); render(); });
$("mes-hoje").addEventListener("click", () => { mesAtual = mesDe(hojeISO()); render(); });

$("form-transacao").addEventListener("submit", guardarTransacao);
$("f-data").addEventListener("input", atualizarPagoWrap);
$("btn-cancelar").addEventListener("click", limparForm);
$("lista-transacoes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-acao]"); if (!b) return;
  b.dataset.acao === "editar" ? editarTransacao(b.dataset.id) : removerTransacao(b.dataset.id);
});
["filtro-periodo", "filtro-tipo", "filtro-categoria"].forEach(id => $(id).addEventListener("change", renderLancamentos));
$("filtro-busca").addEventListener("input", renderLancamentos);

$("form-meta").addEventListener("submit", (e) => {
  e.preventDefault();
  const fin = { tipo: $("m-parcela").value ? "financiamento" : "meta", parcela: Number($("m-parcela").value) || 0, taxa: Number($("m-taxa").value) || 0, primeiraParcela: $("m-primeira").value ? $("m-primeira").value + "-01" : "" };
  const item = { ...fin, moeda: $("m-moeda").value, nome: $("m-nome").value.trim(), alvo: Number($("m-alvo").value) || 0, atual: Number($("m-atual").value) || 0, prazo: $("m-prazo").value, nota: $("m-nota").value.trim(), vinculo: $("m-vinculo").value.trim() };
  if (editandoMetaId) Object.assign(state.metas.find(m => m.id === editandoMetaId), item);
  else state.metas.push(normalizarMeta({ id: uid(), ...item }));
  salvar(); limparFormMeta(); renderMetas(); toast("Meta guardada.");
});
$("m-cancelar").addEventListener("click", limparFormMeta);
$("metas-lista").addEventListener("click", (e) => {
  const ed = e.target.closest("[data-editar-meta]"), rm = e.target.closest("[data-remover-meta]");
  if (ed) {
    const m = state.metas.find(x => x.id === ed.dataset.editarMeta);
    $("m-moeda").value = m.moeda || "EUR"; $("m-nome").value = m.nome;
    $("m-parcela").value = m.parcela || ""; $("m-taxa").value = m.taxa || ""; $("m-primeira").value = (m.primeiraParcela || "").slice(0, 7); $("m-alvo").value = m.alvo; $("m-atual").value = m.atual; $("m-prazo").value = m.prazo || ""; $("m-nota").value = m.nota || ""; $("m-vinculo").value = m.vinculo || "";
    editandoMetaId = m.id; $("m-salvar").textContent = "Guardar meta"; $("meta-form-titulo").textContent = "Editar meta"; $("m-cancelar").hidden = false;
    $("form-meta").scrollIntoView({ behavior: "smooth" });
  }
  const ra = e.target.closest("[data-rem-ant]");
  if (ra) { const [mid, aid] = ra.dataset.remAnt.split("|"); const m = state.metas.find(x => x.id === mid); m.antecipacoes = m.antecipacoes.filter(a => a.id !== aid); salvar(); renderMetas(); return; }
  if (rm) perguntar("Remover esta meta?", "Remover").then(ok => { if (ok) { state.metas = state.metas.filter(x => x.id !== rm.dataset.removerMeta); salvar(); renderMetas(); } });
});
$("metas-lista").addEventListener("submit", (e) => {
  const fa = e.target.closest("form[data-add-ant]");
  if (fa) {
    e.preventDefault();
    const m = state.metas.find(x => x.id === fa.dataset.addAnt), [mes, val, nota] = fa.querySelectorAll("input");
    const v = Number(val.value); if (!m || !(v > 0) || !mes.value) return;
    m.antecipacoes.push({ id: uid(), data: mes.value + "-01", valor: v, nota: nota.value.trim() || "Antecipação", pago: false });
    salvar(); renderMetas(); toast("Antecipação planeada."); return;
  }
  const f = e.target.closest("form[data-aporte]"); if (!f) return;
  e.preventDefault();
  const m = state.metas.find(x => x.id === f.dataset.aporte), v = Number(f.querySelector("input").value);
  if (m && v && m.tipo === "financiamento") {
    m.antecipacoes.push({ id: uid(), data: hojeISO(), valor: v, nota: "Antecipação feita", pago: true });
    salvar(); renderMetas(); toast(`Antecipação de ${fmtMoeda(v, m.moeda)} registada em "${m.nome}".`); return;
  }
  if (m && v) { m.atual = Math.max(0, (m.atual || 0) + v); salvar(); renderMetas(); toast(`${fmtMoeda(v, m.moeda)} adicionado a "${m.nome}".`); }
});

$("btn-importar").addEventListener("click", importar);
$("f-valor").addEventListener("input", atualizarConv);
$("f-moeda").addEventListener("change", atualizarConv);
$("btn-cambio").addEventListener("click", () => atualizarCambio(true));
$("fx-pill").addEventListener("click", () => mostrarView("dados"));
// Tema (guardado neste aparelho)
function aplicarTema(t) { document.documentElement.dataset.tema = t; LS.set("fin_tema", t); document.querySelectorAll("#tema-opcoes button").forEach(b => b.classList.toggle("on", b.dataset.tema === t)); try { render(); } catch (e) {} }
$("tema-opcoes").addEventListener("click", (e) => { const b = e.target.closest("button[data-tema]"); if (b) aplicarTema(b.dataset.tema); });
document.querySelectorAll("#tema-opcoes button").forEach(b => b.classList.toggle("on", b.dataset.tema === (document.documentElement.dataset.tema || "roxo")));
$("euro-periodos").addEventListener("click", (e) => { const b = e.target.closest("button[data-p]"); if (!b) return; euroPeriodo = Number(b.dataset.p); LS.set("fin_euro_periodo", String(euroPeriodo)); renderEuro(); });
$("form-cambio").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = Number($("c-valor").value); if (!(v > 0)) return;
  state.config.cambio = { valor: v, data: hojeISO(), fonte: "manual" };
  const n = aplicarCambio(); salvar(); render(); e.target.reset();
  toast(`Cotação manual guardada${n ? ` · ${n} lançamento(s) recalculado(s)` : ""}.`);
});
function exportarJSON() {
  state.config.ultimoBackup = hojeISO(); salvar();
  baixar(`financas-familia-${hojeISO()}.json`, JSON.stringify(state, null, 1), "application/json");
  render(); toast("Cópia de segurança exportada.");
}
$("btn-export-json").addEventListener("click", exportarJSON);
$("btn-export-ics").addEventListener("click", exportarICS);
$("aviso-backup").addEventListener("click", (e) => { if (e.target.closest("[data-backup]")) exportarJSON(); });
$("btn-saldo-real").addEventListener("click", editarSaldoReal);
$("cons-mais").addEventListener("click", () => { consMostrarTodos = !consMostrarTodos; renderConselheiro(); });
$("cons-fechar").addEventListener("click", () => alternarConselheiro(false));
$("cons-toggle").addEventListener("click", () => alternarConselheiro());
$("cons-claude").addEventListener("click", conversarComConselheiro);
$("inv-claude").addEventListener("click", conversarInvestimentos);
$("cons-lista").addEventListener("click", (e) => {
  if (e.target.closest("[data-acao-cons=saldo]")) editarSaldoReal();
  if (e.target.closest("[data-backup]")) exportarJSON();
  if (e.target.closest("[data-goto-pend]")) { $("mov-filtro").value = "pendentes"; mesAtual = mesDe(hojeISO()); mostrarView("dashboard"); document.getElementById("dash-confirmar").scrollIntoView({ behavior: "smooth", block: "center" }); }
});
$("mov-filtro").addEventListener("change", renderDashboard);
$("filtro-status").addEventListener("change", renderLancamentos);
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-confirmar]"); if (b) { e.preventDefault(); confirmarTransacao(b.dataset.confirmar); return; }
  const a = e.target.closest("[data-ajustar]"); if (a) { e.preventDefault(); ajustarValor(a.dataset.ajustar); }
});
$("modal-cancelar").addEventListener("click", fecharModal);
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal") fecharModal(); });
function okModal(e) {
  if (e) e.preventDefault();
  const form = $("modal-form");
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const f = abrirModal._ok;
  try { if (f && f() !== false) fecharModal(); }
  catch (err) { registarErro("modal", err); toast("Erro: " + (err && err.message || err)); }
}
$("modal-form").addEventListener("submit", okModal);
$("modal-ok").addEventListener("click", okModal);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("modal").hidden) fecharModal(); });
$("btn-export-csv").addEventListener("click", exportarCSV);
$("form-senha").addEventListener("submit", (e) => {
  e.preventDefault();
  LS.set(USER_KEY, JSON.stringify({ username: $("u-nome").value.trim(), password: $("u-senha").value }));
  $("u-senha").value = ""; toast("Utilizador e senha alterados.");
});
$("btn-apagar-tudo").addEventListener("click", async () => {
  if (!await perguntar("Apagar TODOS os lançamentos e metas? Exporte uma cópia antes.", "Apagar tudo")) return;
  state = estadoVazio(); salvar(); render(); toast("Dados apagados.");
});

/* ---------- Arranque ---------- */
if (!NO_CLAUDE && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(console.error));
}
(NO_CLAUDE || LS.get(SESSION_KEY) === "true") ? mostrarApp() : mostrarLogin();
// No claude.ai a página corre numa moldura que bloqueia o envio nativo de formulários:
// o clique em "Pago ✓", "Adicionar", etc. não fazia nada. Aqui o próprio app trata o clique e o Enter.
function enviarForm(form) {
  if (!form.checkValidity()) { form.reportValidity(); return; }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
if (NO_CLAUDE) {
  document.addEventListener("click", (e) => {
    const b = e.target.closest('button[type="submit"], button:not([type]), input[type="submit"]');
    const form = b && b.closest("form");
    if (!form) return;
    e.preventDefault(); enviarForm(form);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    const el = e.target; if (!el.matches || !el.matches("input:not([type=checkbox]):not([type=radio])")) return;
    const form = el.closest("form"); if (!form) return;
    e.preventDefault(); enviarForm(form);
  }, true);
}
if (NO_CLAUDE) { $("btn-logout").hidden = true; iniciarNuvem(); }
else {
  // Versão antiga (GitHub Pages): aviso para passar para o link com nuvem.
  const av = document.createElement("div"); av.className = "aviso-novo";
  av.innerHTML = 'O app passou a sincronizar entre telemóvel e computador. <b>1)</b> Dados → Exportar JSON aqui · <b>2)</b> abra o <a href="https://claude.ai/artifact/JpxvCfXPQiBSfuei4tGmew" target="_blank" rel="noopener">novo link</a> → Dados → Importar (substituir).';
  document.body.prepend(av);
}
// Ao voltar ao app depois de um tempo, abre de novo no Resumo do mês atual.
let escondidoDesde = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) escondidoDesde = Date.now();
  else if (escondidoDesde && Date.now() - escondidoDesde > 10 * 60 * 1000 && !$("app-section").hidden) irParaInicio();
});
window.addEventListener("pageshow", (e) => { if (e.persisted && !$("app-section").hidden) irParaInicio(); });
if (!String(state.config.cambio?.data || "").startsWith(hojeISO()) && state.config.cambio?.fonte !== "manual") atualizarCambio(false);
