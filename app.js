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
  return { versao: 2, transacoes: [], orcamentos: [], metas: [], config: { saldoInicial: { valor: 0, data: "" } } };
}
function normalizarTransacao(t) {
  return {
    id: String(t.id ?? uid()),
    data: String(t.data),
    descricao: String(t.descricao ?? "").trim(),
    categoria: String(t.categoria ?? "Outros").trim() || "Outros",
    tipo: t.tipo === "receita" ? "receita" : "despesa",
    valor: Math.abs(Number(t.valor) || 0),
    vencimento: t.vencimento ? Number(t.vencimento) : null,
    serieId: t.serieId || null,
    nota: t.nota || "",
    origem: t.origem || "",
  };
}
function carregar() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      const base = estadoVazio();
      return { ...base, ...s, config: { ...base.config, ...(s.config || {}) }, transacoes: (s.transacoes || []).map(normalizarTransacao) };
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
function linhaProgresso(nome, gasto, limite, extra = "") {
  const pct = limite > 0 ? (gasto / limite) * 100 : 0;
  const cls = pct > 100 ? "over" : pct >= 85 ? "warn" : "";
  return `<div class="progress-row">
    <div class="progress-top"><span>${esc(nome)}</span><span class="v">${fmt(gasto)} / ${extra || fmt(limite)}</span></div>
    <div class="bar ${cls}"><i style="width:${Math.min(100, pct)}%"></i></div>
  </div>`;
}

function renderDashboard() {
  const lista = doMes(mesAtual);
  const r = soma(lista, "receita"), d = soma(lista, "despesa");
  $("kpi-receitas").textContent = fmt(r);
  $("kpi-despesas").textContent = fmt(d);
  const res = $("kpi-resultado");
  res.textContent = fmt(r - d); res.className = r - d >= 0 ? "pos" : "neg";
  const ini = state.config.saldoInicial;
  const saldoEl = $("kpi-saldo");
  if (ini && ini.data && fimDoMes(mesAtual) < ini.data) {
    saldoEl.textContent = "—"; saldoEl.className = "";
    $("kpi-saldo-nota").textContent = `antes do saldo inicial (${dataCurta(ini.data)})`;
  } else {
    const s = saldoAte(fimDoMes(mesAtual));
    saldoEl.textContent = fmt(s); saldoEl.className = s >= 0 ? "pos" : "neg";
    $("kpi-saldo-nota").textContent = ini && ini.data ? `desde ${dataCurta(ini.data)} (saldo inicial ${fmt(ini.valor)})` : "defina o saldo inicial em Dados";
  }

  graficoBarras($("chart-barras"));
  graficoDonut($("chart-donut"));

  // Orçamento
  const orc = state.orcamentos.filter(o => o.limite > 0);
  $("dash-orcamento").innerHTML = orc.length
    ? orc.map(o => linhaProgresso(o.categoria, gastoCategoria(mesAtual, o.categoria), o.limite)).join("")
    : `<p class="empty">Nenhum limite definido.</p>`;

  // Pagamentos do mês
  const hoje = hojeISO();
  const desp = lista.filter(t => t.tipo === "despesa")
    .map(t => ({ ...t, dia: t.vencimento || Number(t.data.slice(8, 10)) }))
    .sort((a, b) => a.dia - b.dia || b.valor - a.valor);
  $("dash-vencimentos").innerHTML = desp.length ? desp.map(t => {
    const dataVenc = `${mesAtual}-${String(t.dia).padStart(2, "0")}`;
    return `<li class="${dataVenc < hoje ? "past" : ""}">
      <span class="due-day">${t.dia}<small>${MESES_CURTOS[Number(mesAtual.slice(5)) - 1]}</small></span>
      <span>${esc(t.descricao)}<span class="cat">${esc(t.categoria)}</span></span>
      <span class="v neg">${fmt(t.valor)}</span></li>`;
  }).join("") : `<li class="empty" style="display:block">Sem despesas neste mês.</li>`;

  // Metas
  $("dash-metas").innerHTML = state.metas.length
    ? state.metas.map(m => linhaProgresso(m.nome, m.atual, m.alvo)).join("")
    : `<p class="empty">Nenhuma meta criada.</p>`;
}

/* ---------- Render: Lançamentos ---------- */
function renderLancamentos() {
  const cats = categorias();
  $("lista-categorias").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
  const selCat = $("filtro-categoria"), atual = selCat.value;
  selCat.innerHTML = `<option value="">Todas as categorias</option>` + cats.map(c => `<option${c === atual ? " selected" : ""}>${esc(c)}</option>`).join("");

  const periodo = $("filtro-periodo").value, tipo = $("filtro-tipo").value, cat = selCat.value;
  const busca = $("filtro-busca").value.trim().toLowerCase();
  const lista = state.transacoes.filter(t =>
    (periodo === "todos" || mesDe(t.data) === mesAtual) &&
    (!tipo || t.tipo === tipo) && (!cat || t.categoria === cat) &&
    (!busca || `${t.descricao} ${t.categoria} ${t.nota}`.toLowerCase().includes(busca))
  ).sort((a, b) => b.data.localeCompare(a.data) || a.descricao.localeCompare(b.descricao));

  $("lista-transacoes").innerHTML = lista.length ? lista.map(t => `
    <tr>
      <td>${dataCurta(t.data)}${t.vencimento ? `<span class="sub">vence dia ${t.vencimento}</span>` : ""}</td>
      <td>${esc(t.descricao)}${t.serieId ? ' <span title="Recorrente">🔄</span>' : ""}${t.nota ? `<span class="sub">${esc(t.nota)}</span>` : ""}</td>
      <td><span class="tag">${esc(t.categoria)}</span></td>
      <td class="num ${t.tipo === "receita" ? "pos" : "neg"}">${t.tipo === "receita" ? "+" : "−"}${fmt(t.valor)}</td>
      <td class="actions">
        <button class="icon-btn" data-acao="editar" data-id="${esc(t.id)}" title="Editar">✏️</button>
        <button class="icon-btn" data-acao="remover" data-id="${esc(t.id)}" title="Remover">🗑️</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="5" class="empty">Nenhum lançamento encontrado.</td></tr>`;

  const total = lista.reduce((a, t) => a + sinal(t), 0);
  $("lista-resumo").textContent = `${lista.length} lançamento(s)`;
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
}

function editarTransacao(id) {
  const t = state.transacoes.find(x => x.id === id);
  if (!t) return;
  document.querySelector(`input[name="tipo"][value="${t.tipo}"]`).checked = true;
  $("f-data").value = t.data;
  $("f-descricao").value = t.descricao;
  $("f-categoria").value = t.categoria;
  $("f-valor").value = t.valor;
  $("f-vencimento").value = t.vencimento || "";
  $("f-recorrente").checked = false;
  $("f-recorrente").disabled = true;
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
    valor: $("f-valor").value,
    vencimento: $("f-vencimento").value || null,
  });
  if (!base.data || !base.descricao || !(base.valor > 0)) { toast("Preencha data, descrição e um valor maior que zero."); return; }

  if (editandoId) {
    const i = state.transacoes.findIndex(t => t.id === editandoId);
    if (i !== -1) state.transacoes[i] = { ...state.transacoes[i], ...base, serieId: state.transacoes[i].serieId, nota: state.transacoes[i].nota, origem: state.transacoes[i].origem };
    toast("Lançamento atualizado.");
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
function renderMetas() {
  const hoje = hojeISO();
  $("metas-lista").innerHTML = state.metas.map(m => {
    const pct = m.alvo ? Math.min(100, (m.atual / m.alvo) * 100) : 0;
    let ritmo = "";
    if (m.prazo && m.atual < m.alvo) {
      const meses = Math.max(1, (Number(m.prazo.slice(0, 4)) - Number(hoje.slice(0, 4))) * 12 + Number(m.prazo.slice(5, 7)) - Number(hoje.slice(5, 7)));
      ritmo = m.prazo < hoje ? `<span class="neg">Prazo ultrapassado</span>` : `≈ ${fmt((m.alvo - m.atual) / meses)} por mês até ${dataCurta(m.prazo)}`;
    }
    return `<div class="card meta-card">
      <div class="card-head"><h3>${esc(m.nome)}</h3>
        <span><button class="icon-btn" data-editar-meta="${esc(m.id)}" title="Editar">✏️</button><button class="icon-btn" data-remover-meta="${esc(m.id)}" title="Remover">🗑️</button></span></div>
      <div class="big">${fmt(m.atual)} <span class="muted" style="font-size:15px;font-weight:400">de ${fmt(m.alvo)}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="row"><span>${Math.round(pct)}% concluído</span><span>Faltam ${fmt(Math.max(0, m.alvo - m.atual))}</span></div>
      ${ritmo ? `<div class="row"><span>${ritmo}</span></div>` : ""}
      ${m.nota ? `<p class="muted small">${esc(m.nota)}</p>` : ""}
      <form class="add" data-aporte="${esc(m.id)}"><input type="number" step="0.01" placeholder="Valor a adicionar €" required><button class="btn btn-sm" type="submit">+ Adicionar</button></form>
    </div>`;
  }).join("") || `<div class="card"><p class="empty">Crie a sua primeira meta abaixo — ex.: fundo de emergência ou quitar um crédito.</p></div>`;
}

function limparFormMeta() {
  $("form-meta").reset(); $("m-atual").value = 0;
  editandoMetaId = null; $("m-salvar").textContent = "Criar meta"; $("meta-form-titulo").textContent = "Nova meta"; $("m-cancelar").hidden = true;
}

/* ---------- Render: Dados ---------- */
function renderDados() {
  const ini = state.config.saldoInicial || {};
  if (document.activeElement !== $("s-valor")) $("s-valor").value = ini.data ? ini.valor : "";
  if (document.activeElement !== $("s-data")) $("s-data").value = ini.data || "";
  $("u-nome").value = (JSON.parse(localStorage.getItem(USER_KEY) || "{}").username) || "";
}

/* ---------- Import / export ---------- */
function baixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportarCSV() {
  const linhas = [["Data", "Tipo", "Descrição", "Categoria", "Valor", "Vencimento", "Nota"]];
  [...state.transacoes].sort((a, b) => a.data.localeCompare(b.data)).forEach(t =>
    linhas.push([t.data, t.tipo, t.descricao, t.categoria, String(t.valor).replace(".", ","), t.vencimento || "", t.nota]));
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
      const item = { id: String(m.id || uid()), nome: String(m.nome), alvo: Number(m.alvo) || 0, atual: Number(m.atual) || 0, prazo: m.prazo || "", nota: m.nota || "" };
      const i = state.metas.findIndex(x => x.id === item.id);
      i === -1 ? state.metas.push(item) : (state.metas[i] = item);
    });
    if (dados.config && dados.config.saldoInicial) state.config.saldoInicial = dados.config.saldoInicial;
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
  if (viewAtual === "dashboard") renderDashboard();
  if (viewAtual === "lancamentos") renderLancamentos();
  if (viewAtual === "orcamento") renderOrcamento();
  if (viewAtual === "metas") renderMetas();
  if (viewAtual === "dados") renderDados();
}

/* ---------- Login ---------- */
if (!localStorage.getItem(USER_KEY)) localStorage.setItem(USER_KEY, JSON.stringify({ username: "admin", password: "1234" }));
function mostrarApp() { $("login-section").hidden = true; $("app-section").hidden = false; limparForm(); mostrarView(viewAtual); }
function mostrarLogin() { $("login-section").hidden = false; $("app-section").hidden = true; }

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
  const item = { nome: $("m-nome").value.trim(), alvo: Number($("m-alvo").value) || 0, atual: Number($("m-atual").value) || 0, prazo: $("m-prazo").value, nota: $("m-nota").value.trim() };
  if (editandoMetaId) Object.assign(state.metas.find(m => m.id === editandoMetaId), item);
  else state.metas.push({ id: uid(), ...item });
  salvar(); limparFormMeta(); renderMetas(); toast("Meta guardada.");
});
$("m-cancelar").addEventListener("click", limparFormMeta);
$("metas-lista").addEventListener("click", (e) => {
  const ed = e.target.closest("[data-editar-meta]"), rm = e.target.closest("[data-remover-meta]");
  if (ed) {
    const m = state.metas.find(x => x.id === ed.dataset.editarMeta);
    $("m-nome").value = m.nome; $("m-alvo").value = m.alvo; $("m-atual").value = m.atual; $("m-prazo").value = m.prazo || ""; $("m-nota").value = m.nota || "";
    editandoMetaId = m.id; $("m-salvar").textContent = "Guardar meta"; $("meta-form-titulo").textContent = "Editar meta"; $("m-cancelar").hidden = false;
    $("form-meta").scrollIntoView({ behavior: "smooth" });
  }
  if (rm && confirm("Remover esta meta?")) { state.metas = state.metas.filter(x => x.id !== rm.dataset.removerMeta); salvar(); renderMetas(); }
});
$("metas-lista").addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-aporte]"); if (!f) return;
  e.preventDefault();
  const m = state.metas.find(x => x.id === f.dataset.aporte), v = Number(f.querySelector("input").value);
  if (m && v) { m.atual = Math.max(0, (m.atual || 0) + v); salvar(); renderMetas(); toast(`${fmt(v)} adicionado a "${m.nome}".`); }
});

$("btn-importar").addEventListener("click", importar);
$("btn-export-json").addEventListener("click", () => baixar(`impactfinance-${hojeISO()}.json`, JSON.stringify(state, null, 1), "application/json"));
$("btn-export-csv").addEventListener("click", exportarCSV);
$("form-saldo").addEventListener("submit", (e) => {
  e.preventDefault();
  state.config.saldoInicial = { valor: Number($("s-valor").value) || 0, data: $("s-data").value };
  salvar(); toast("Saldo inicial guardado.");
});
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
