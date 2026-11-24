/* Impact Finance — controlo financeiro (vanilla JS, dados no localStorage) */
"use strict";

const STORE_KEY = "impactfinance_v2";
const USER_KEY = "finance_user";
const SESSION_KEY = "finance_logged_in";
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const MESES_CURTOS = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const CORES = ["--c1","--c2","--c3","--c4","--c5","--c6","--c7","--c8"].map(v => `var(${v})`);

const $ = (id) => document.getElementById(id);
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
    alvo: Number(m.alvo) || 0, atual: Number(m.atual) || 0, prazo: m.prazo || "", nota: m.nota || "", vinculo: m.vinculo || "" };
}
function carregar() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const base = estadoVazio();
      return { ...base, ...s, config: { ...base.config, ...(s.config || {}) }, transacoes: (s.transacoes || []).map(normalizarTransacao), metas: (s.metas || []).map(normalizarMeta) };
    }
    // migração da versão antiga (chave "transacoes")
    const antigas = JSON.parse(localStorage.getItem("transacoes") || "[]");
    const s = estadoVazio();
    s.transacoes = antigas.filter(t => t && t.data).map(normalizarTransacao);
    return s;
  } catch (e) {
    console.error(e);
    return estadoVazio();
  }
}
let state = carregar();
function salvar() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

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
  const f = $("modal-campos").querySelector("input"); if (f) setTimeout(() => f.focus(), 30);
  abrirModal._ok = onOk;
}
function fecharModal() { $("modal").hidden = true; abrirModal._ok = null; }

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

function renderDashboard() {
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

  // Orçamento
  const orc = state.orcamentos.filter(o => o.limite > 0);
  $("dash-orcamento").innerHTML = orc.length
    ? orc.map(o => linhaProgresso(o.categoria, gastoCategoria(mesAtual, o.categoria), o.limite)).join("")
    : `<p class="empty">Nenhum limite definido.</p>`;

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

  // 5) Orçamento (gastos confirmados vs limite)
  state.orcamentos.filter(o => o.limite > 0).forEach(o => {
    const gasto = doMes(mesH).filter(t => t.tipo === "despesa" && t.categoria === o.categoria && t.pago).reduce((a, t) => a + t.valor, 0);
    const pct = gasto / o.limite;
    if (pct > 1) add(85, "alto", "🛑", `<strong>${esc(o.categoria)}</strong> já passou o limite: ${fmt(gasto)} de ${fmt(o.limite)}.`);
    else if (pct >= 0.85) add(65, "medio", "⚠️", `<strong>${esc(o.categoria)}</strong> está em ${Math.round(pct * 100)}% do limite (${fmt(gasto)} de ${fmt(o.limite)}).`);
  });

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
  const nome = (JSON.parse(localStorage.getItem(USER_KEY) || "{}").nome) || "Neto";
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
  $("cons-fab").classList.toggle("fechado", localStorage.getItem(CONS_KEY) === hojeISO());
}
function alternarConselheiro(abrir) {
  const fechado = $("cons-fab").classList.contains("fechado");
  const abre = abrir ?? fechado;
  if (abre) localStorage.removeItem(CONS_KEY); else { localStorage.setItem(CONS_KEY, hojeISO()); consMostrarTodos = false; }
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
  window.open("https://claude.ai/new?q=" + encodeURIComponent(txt), "_blank", "noopener");
  toast("Resumo copiado. Se o Claude abrir vazio, cole (Ctrl+V) e envie.");
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
  ).sort((a, b) => b.data.localeCompare(a.data) || a.descricao.localeCompare(b.descricao));

  $("lista-transacoes").innerHTML = lista.length ? lista.map(t => `
    <tr class="${t.pago ? "pago" : ""}">
      <td><button class="chk ${t.pago ? "on" : ""}" data-confirmar="${esc(t.id)}" title="${t.pago ? "Desfazer confirmação" : "Confirmar"}">✓</button></td>
      <td>${dataCurta(t.data)}${t.vencimento ? `<span class="sub">vence dia ${t.vencimento}</span>` : ""}${t.pago ? `<span class="sub pos">${t.tipo === "receita" ? "recebido" : "pago"} ${dataCurta(t.pagoEm)}</span>` : ""}</td>
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
  $("f-moeda").value = "EUR"; atualizarConv();
}
function atualizarConv() {
  const v = Number($("f-valor").value);
  $("f-conv").textContent = $("f-moeda").value === "BRL" && v > 0 ? `≈ ${fmt(paraEUR(v))} (1 € = ${fmtTaxa(cambio())})` : "";
}

function editarTransacao(id) {
  const t = state.transacoes.find(x => x.id === id);
  if (!t) return;
  document.querySelector(`input[name="tipo"][value="${t.tipo}"]`).checked = true;
  $("f-data").value = t.data;
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
    for (let i = 0; i < 12; i++) state.transacoes.push({ ...base, id: uid(), serieId, data: somarMesesData(base.data, i) });
    toast("Criados 12 lançamentos mensais.");
  } else {
    state.transacoes.push(base);
    toast("Lançamento adicionado.");
  }
  mesAtual = mesDe(base.data);
  salvar(); limparForm(); render();
}

function removerTransacao(id) {
  const t = state.transacoes.find(x => x.id === id);
  if (!t) return;
  if (t.serieId) {
    const futuros = state.transacoes.filter(x => x.serieId === t.serieId && x.data >= t.data);
    if (futuros.length > 1 && confirm(`Este lançamento repete-se. Remover também os ${futuros.length - 1} seguintes?\n\nOK = remover este e os seguintes · Cancelar = só este`)) {
      const ids = new Set(futuros.map(x => x.id));
      state.transacoes = state.transacoes.filter(x => !ids.has(x.id));
      salvar(); render(); toast(`${ids.size} lançamentos removidos.`); return;
    }
  }
  if (!confirm(`Remover "${t.descricao}" (${fmt(t.valor)})?`)) return;
  state.transacoes = state.transacoes.filter(x => x.id !== id);
  salvar(); render(); toast("Lançamento removido.");
}

/* ---------- Render: Orçamento ---------- */
function renderOrcamento() {
  const cats = new Set(state.orcamentos.map(o => o.categoria));
  // mostra também categorias com despesas no mês sem limite definido
  doMes(mesAtual).filter(t => t.tipo === "despesa").forEach(t => cats.add(t.categoria));
  const linhas = [...cats].sort((a, b) => a.localeCompare(b, "pt")).map(cat => {
    const o = state.orcamentos.find(x => x.categoria === cat);
    const gasto = gastoCategoria(mesAtual, cat), limite = o ? o.limite : 0;
    const pct = limite ? (gasto / limite) * 100 : 0;
    const cls = !limite ? "" : pct > 100 ? "over" : pct >= 85 ? "warn" : "";
    const resto = limite - gasto;
    return `<div class="progress-row">
      <div class="progress-top">
        <span>${esc(cat)}</span>
        <span class="v">${fmt(gasto)} de
          <input class="limit-input" type="number" step="0.01" min="0" data-cat="${esc(cat)}" value="${limite || ""}" placeholder="sem limite">
          ${o ? `<button class="icon-btn" data-remover-orc="${esc(cat)}" title="Remover limite">✕</button>` : ""}
        </span>
      </div>
      <div class="bar ${cls}"><i style="width:${limite ? Math.min(100, pct) : 0}%"></i></div>
      ${limite ? `<span class="small ${resto < 0 ? "neg" : "muted"}">${resto < 0 ? `Excedido em ${fmt(-resto)}` : `Disponível: ${fmt(resto)}`}</span>` : ""}
    </div>`;
  });
  const totLim = state.orcamentos.reduce((a, o) => a + (o.limite || 0), 0);
  const totGasto = soma(doMes(mesAtual), "despesa");
  $("orcamento-lista").innerHTML = (linhas.join("") || `<p class="empty">Ainda sem categorias.</p>`) +
    (totLim ? `<div class="progress-row"><div class="progress-top"><strong>Total</strong><span class="v">${fmt(totGasto)} / ${fmt(totLim)}</span></div></div>` : "");
}

/* ---------- Render: Metas ---------- */
/* Meta ligada a lançamentos: o progresso vem das despesas cuja descrição começa pelo "vínculo". */
function emMoedaMeta(t, m) { return m.moeda === "BRL" ? (t.valorBRL || r2(t.valor * cambio())) : t.valor; }
function progressoMeta(m) {
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
  $("metas-lista").innerHTML = state.metas.map(m => {
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
  $("u-nome").value = (JSON.parse(localStorage.getItem(USER_KEY) || "{}").username) || "";
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
function baixar(nome, conteudo, tipo) {
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
    if (substituir && !confirm("Isto apaga todos os dados atuais e substitui pelos do ficheiro. Continuar?")) return;
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
  if (viewAtual === "orcamento") renderOrcamento();
  if (viewAtual === "metas") renderMetas();
  if (viewAtual === "dados") renderDados();
}

/* ---------- Login ---------- */
if (!localStorage.getItem(USER_KEY)) localStorage.setItem(USER_KEY, JSON.stringify({ username: "admin", password: "1234" }));
function mostrarApp() { $("login-section").hidden = true; $("app-section").hidden = false; $("cons-fab").hidden = false; limparForm(); mostrarView(viewAtual); }
function mostrarLogin() { $("login-section").hidden = false; $("app-section").hidden = true; $("cons-fab").hidden = true; }

$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const u = JSON.parse(localStorage.getItem(USER_KEY) || "{}");
  if ($("login-username").value.trim() === u.username && $("login-password").value === u.password) {
    localStorage.setItem(SESSION_KEY, "true"); $("login-msg").textContent = ""; mostrarApp();
  } else {
    $("login-msg").textContent = "Utilizador ou senha inválidos."; $("login-msg").style.color = "var(--neg)";
  }
});
$("btn-logout").addEventListener("click", () => { localStorage.setItem(SESSION_KEY, "false"); mostrarLogin(); });

/* ---------- Eventos ---------- */
$("tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-view]"); if (b) mostrarView(b.dataset.view); });
document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => mostrarView(b.dataset.goto)));
$("mes-anterior").addEventListener("click", () => { mesAtual = somarMeses(mesAtual, -1); render(); });
$("mes-seguinte").addEventListener("click", () => { mesAtual = somarMeses(mesAtual, 1); render(); });
$("mes-hoje").addEventListener("click", () => { mesAtual = mesDe(hojeISO()); render(); });

$("form-transacao").addEventListener("submit", guardarTransacao);
$("btn-cancelar").addEventListener("click", limparForm);
$("lista-transacoes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-acao]"); if (!b) return;
  b.dataset.acao === "editar" ? editarTransacao(b.dataset.id) : removerTransacao(b.dataset.id);
});
["filtro-periodo", "filtro-tipo", "filtro-categoria"].forEach(id => $(id).addEventListener("change", renderLancamentos));
$("filtro-busca").addEventListener("input", renderLancamentos);

$("form-orcamento").addEventListener("submit", (e) => {
  e.preventDefault();
  const cat = $("o-categoria").value.trim(), lim = Number($("o-limite").value);
  if (!cat) return;
  const i = state.orcamentos.findIndex(o => o.categoria === cat);
  i === -1 ? state.orcamentos.push({ categoria: cat, limite: lim }) : (state.orcamentos[i].limite = lim);
  salvar(); e.target.reset(); render(); toast("Limite guardado.");
});
$("orcamento-lista").addEventListener("change", (e) => {
  const inp = e.target.closest("input[data-cat]"); if (!inp) return;
  const cat = inp.dataset.cat, lim = Number(inp.value) || 0;
  const i = state.orcamentos.findIndex(o => o.categoria === cat);
  if (i === -1 && lim > 0) state.orcamentos.push({ categoria: cat, limite: lim });
  else if (i !== -1) state.orcamentos[i].limite = lim;
  salvar(); renderOrcamento();
});
$("orcamento-lista").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remover-orc]"); if (!b) return;
  state.orcamentos = state.orcamentos.filter(o => o.categoria !== b.dataset.removerOrc);
  salvar(); renderOrcamento();
});

$("form-meta").addEventListener("submit", (e) => {
  e.preventDefault();
  const item = { moeda: $("m-moeda").value, nome: $("m-nome").value.trim(), alvo: Number($("m-alvo").value) || 0, atual: Number($("m-atual").value) || 0, prazo: $("m-prazo").value, nota: $("m-nota").value.trim(), vinculo: $("m-vinculo").value.trim() };
  if (editandoMetaId) Object.assign(state.metas.find(m => m.id === editandoMetaId), item);
  else state.metas.push({ id: uid(), ...item });
  salvar(); limparFormMeta(); renderMetas(); toast("Meta guardada.");
});
$("m-cancelar").addEventListener("click", limparFormMeta);
$("metas-lista").addEventListener("click", (e) => {
  const ed = e.target.closest("[data-editar-meta]"), rm = e.target.closest("[data-remover-meta]");
  if (ed) {
    const m = state.metas.find(x => x.id === ed.dataset.editarMeta);
    $("m-moeda").value = m.moeda || "EUR"; $("m-nome").value = m.nome; $("m-alvo").value = m.alvo; $("m-atual").value = m.atual; $("m-prazo").value = m.prazo || ""; $("m-nota").value = m.nota || ""; $("m-vinculo").value = m.vinculo || "";
    editandoMetaId = m.id; $("m-salvar").textContent = "Guardar meta"; $("meta-form-titulo").textContent = "Editar meta"; $("m-cancelar").hidden = false;
    $("form-meta").scrollIntoView({ behavior: "smooth" });
  }
  if (rm && confirm("Remover esta meta?")) { state.metas = state.metas.filter(x => x.id !== rm.dataset.removerMeta); salvar(); renderMetas(); }
});
$("metas-lista").addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-aporte]"); if (!f) return;
  e.preventDefault();
  const m = state.metas.find(x => x.id === f.dataset.aporte), v = Number(f.querySelector("input").value);
  if (m && v) { m.atual = Math.max(0, (m.atual || 0) + v); salvar(); renderMetas(); toast(`${fmtMoeda(v, m.moeda)} adicionado a "${m.nome}".`); }
});

$("btn-importar").addEventListener("click", importar);
$("f-valor").addEventListener("input", atualizarConv);
$("f-moeda").addEventListener("change", atualizarConv);
$("btn-cambio").addEventListener("click", () => atualizarCambio(true));
$("fx-pill").addEventListener("click", () => mostrarView("dados"));
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
$("modal-form").addEventListener("submit", (e) => { e.preventDefault(); const f = abrirModal._ok; if (f && f() !== false) fecharModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("modal").hidden) fecharModal(); });
$("btn-export-csv").addEventListener("click", exportarCSV);
$("form-senha").addEventListener("submit", (e) => {
  e.preventDefault();
  localStorage.setItem(USER_KEY, JSON.stringify({ username: $("u-nome").value.trim(), password: $("u-senha").value }));
  $("u-senha").value = ""; toast("Utilizador e senha alterados.");
});
$("btn-apagar-tudo").addEventListener("click", () => {
  if (!confirm("Apagar TODOS os lançamentos, orçamentos e metas deste navegador? Exporte uma cópia antes.")) return;
  state = estadoVazio(); salvar(); render(); toast("Dados apagados.");
});

/* ---------- Arranque ---------- */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(console.error));
}
localStorage.getItem(SESSION_KEY) === "true" ? mostrarApp() : mostrarLogin();
if (!String(state.config.cambio?.data || "").startsWith(hojeISO()) && state.config.cambio?.fonte !== "manual") atualizarCambio(false);
