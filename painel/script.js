/* =============================================================================
   CONFIGURAÇÃO — preencha com os dados do projeto Supabase.
   Use SOMENTE a publishable key (anon), que é pública e só tem permissão de
   leitura (RLS). NUNCA coloque aqui a secret key / service_role.
   ============================================================================= */
const SUPABASE_URL = "https://uybgxlqpmjesehipullw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_LQnM5GErAAovuPMZxYUOgA_mhsiqJFk";

const TAMANHO_PAGINA = 1000; // limite de linhas por requisição do Supabase
const MAX_PAGINAS = 100; // trava de segurança contra laço infinito

/* ---------- Segurança: escapa todo texto vindo da API antes de ir para o HTML ---------- */
function escapeHtml(valor) {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------- Formatação (nulos viram "—") ---------- */
const VAZIO = "—";
const fmtNumero = (v, casas = 1) =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? VAZIO
    : Number(v).toLocaleString("pt-BR", {
        minimumFractionDigits: casas,
        maximumFractionDigits: casas,
      });

// Energia de impacto: 3 casas (precisão do banco) para alinhar a coluna da tabela;
// a versão curta, usada nos cards, só mostra 3 casas em valores menores que 1.
const fmtEnergia = (v) => fmtNumero(v, 3);
const fmtEnergiaCurta = (v) =>
  v === null || v === undefined ? VAZIO : fmtNumero(v, Math.abs(v) < 1 ? 3 : 1);

const fmtLatitude = (v) =>
  v === null || v === undefined
    ? VAZIO
    : `${fmtNumero(Math.abs(v), 1)}° ${v < 0 ? "S" : "N"}`;
const fmtLongitude = (v) =>
  v === null || v === undefined
    ? VAZIO
    : `${fmtNumero(Math.abs(v), 1)}° ${v < 0 ? "O" : "L"}`;

const formatoUtc = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const formatoBrasilia = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtDataUtc = (d) => (d ? formatoUtc.format(d) : VAZIO);
const fmtDataSoDia = (d) =>
  d ? d.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : VAZIO;

const NOMES_STATUS = {
  concluido: "Concluído",
  erro_parcial: "Erro parcial",
  erro_critico: "Erro crítico",
};

/* ---------- Acesso ao Supabase (PostgREST) ---------- */
async function consultar(caminho) {
  const resposta = await fetch(
    `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${caminho}`,
    {
      headers: { apikey: SUPABASE_ANON_KEY, Accept: "application/json" },
    },
  );
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  return resposta.json();
}

// Paginação: pede blocos de 1000 linhas (limit/offset) até vir um bloco incompleto.
// A ordenação pela chave única garante que nenhuma linha se repete ou some entre páginas.
async function carregarBolidos(aoProgredir) {
  const colunas = [
    "data_hora_utc",
    "energia_impacto_kt",
    "energia_irradiada_j_e10",
    "latitude_graus",
    "longitude_graus",
    "altitude_km",
    "velocidade_km_s",
  ].join(",");
  const todos = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const offset = pagina * TAMANHO_PAGINA;
    const lote = await consultar(
      `bolidos?select=${colunas}&order=data_hora_utc.desc&limit=${TAMANHO_PAGINA}&offset=${offset}`,
    );
    todos.push(...lote);
    aoProgredir(todos.length);
    if (lote.length < TAMANHO_PAGINA) break;
  }
  return todos;
}

async function carregarUltimaExecucao() {
  const linhas = await consultar(
    "execucoes?select=iniciado_em,finalizado_em,status,registros_processados&order=iniciado_em.desc&limit=1",
  );
  return linhas[0] || null;
}

// Converte números e datas da API; valores ausentes ou inválidos viram null.
function prepararRegistro(r) {
  const num = (v) =>
    v === null || v === undefined || v === "" || !Number.isFinite(Number(v))
      ? null
      : Number(v);
  const data = r.data_hora_utc ? new Date(r.data_hora_utc) : null;
  const dataValida = data && !Number.isNaN(data.getTime()) ? data : null;
  return {
    data: dataValida,
    ano: dataValida ? dataValida.getUTCFullYear() : null,
    energia: num(r.energia_impacto_kt),
    irradiada: num(r.energia_irradiada_j_e10),
    lat: num(r.latitude_graus),
    lon: num(r.longitude_graus),
    altitude: num(r.altitude_km),
    velocidade: num(r.velocidade_km_s),
  };
}

/* ---------- Estado da página ---------- */
let eventos = []; // todos os eventos carregados
let ordem = { coluna: "data", sentido: "desc" };
let mapa, camadaMarcadores, grafico;

const $ = (id) => document.getElementById(id);

/* ---------- Filtros ---------- */
function lerFiltros() {
  let anoIni = Number($("f-ano-ini").value);
  let anoFim = Number($("f-ano-fim").value);
  if (anoIni > anoFim) [anoIni, anoFim] = [anoFim, anoIni];
  const energiaMin = Math.max(
    0,
    Number(String($("f-energia").value).replace(",", ".")) || 0,
  );
  return { anoIni, anoFim, energiaMin, hemisferio: $("f-hemisferio").value };
}

function filtrar() {
  const f = lerFiltros();
  return eventos.filter((e) => {
    if (e.ano === null || e.ano < f.anoIni || e.ano > f.anoFim) return false;
    if (e.energia === null || e.energia < f.energiaMin) return false;
    if (f.hemisferio === "norte") return e.lat !== null && e.lat >= 0;
    if (f.hemisferio === "sul") return e.lat !== null && e.lat < 0;
    return true;
  });
}

function preencherAnos() {
  const anos = eventos.map((e) => e.ano).filter((a) => a !== null);
  const min = Math.min(...anos),
    max = Math.max(...anos);
  let opcoes = "";
  for (let a = min; a <= max; a++)
    opcoes += `<option value="${a}">${a}</option>`;
  $("f-ano-ini").innerHTML = opcoes;
  $("f-ano-fim").innerHTML = opcoes;
  $("f-ano-ini").value = String(min);
  $("f-ano-fim").value = String(max);
}

function limparFiltros() {
  $("f-ano-ini").selectedIndex = 0;
  $("f-ano-fim").selectedIndex = $("f-ano-fim").options.length - 1;
  $("f-energia").value = "0";
  $("f-hemisferio").value = "todos";
  atualizar();
}

/* ---------- Atualização geral (cards, mapa, gráfico e tabela) ---------- */
function atualizar() {
  const filtrados = filtrar();
  $("f-observacao").hidden = $("f-hemisferio").value === "todos";
  atualizarCards(filtrados);
  atualizarMapa(filtrados);
  atualizarGrafico(filtrados);
  atualizarTabela(filtrados);
}

function atualizarCards(lista) {
  $("c-total").textContent = lista.length.toLocaleString("pt-BR");
  $("c-total-det").textContent =
    `de ${eventos.length.toLocaleString("pt-BR")} eventos na base`;

  const maior = lista.reduce(
    (m, e) => (e.energia !== null && (!m || e.energia > m.energia) ? e : m),
    null,
  );
  $("c-maior").textContent = maior
    ? `${fmtEnergiaCurta(maior.energia)} kt`
    : VAZIO;
  $("c-maior-det").textContent = maior
    ? `${fmtDataSoDia(maior.data)} · ${fmtLatitude(maior.lat)}, ${fmtLongitude(maior.lon)}`
    : "";

  const recente = lista.reduce(
    (m, e) => (e.data && (!m || e.data > m.data) ? e : m),
    null,
  );
  $("c-recente").textContent = recente ? fmtDataSoDia(recente.data) : VAZIO;
  $("c-recente-det").textContent = recente
    ? `${fmtEnergiaCurta(recente.energia)} kt de energia de impacto`
    : "";

  const comLocal = lista.filter((e) => e.lat !== null && e.lon !== null).length;
  $("c-local").textContent = comLocal.toLocaleString("pt-BR");
  $("c-local-det").textContent =
    `${(lista.length - comLocal).toLocaleString("pt-BR")} sem localização conhecida`;
}

/* ---------- Mapa (Leaflet) ---------- */
// Cor por faixa de energia de impacto (kt) e raio em escala logarítmica.
const FAIXAS = [
  { min: 10, cor: "#7f1d1d", nome: "≥ 10 kt" },
  { min: 1, cor: "#dc2626", nome: "1 – 10 kt" },
  { min: 0.1, cor: "#f97316", nome: "0,1 – 1 kt" },
  { min: 0, cor: "#fcd34d", nome: "< 0,1 kt" },
];
const corEnergia = (e) =>
  (FAIXAS.find((f) => e >= f.min) || FAIXAS[FAIXAS.length - 1]).cor;
const raioEnergia = (e) => 4 + 3 * Math.log10(e / 0.04 + 1);

function criarMapa() {
  mapa = L.map("mapa", {
    preferCanvas: true,
    worldCopyJump: true,
    minZoom: 1,
  }).setView([15, 0], 1);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 8,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  camadaMarcadores = L.layerGroup().addTo(mapa);

  const legenda = L.control({ position: "bottomleft" });
  legenda.onAdd = () => {
    const div = L.DomUtil.create("div", "legenda");
    div.innerHTML =
      "<strong>Energia de impacto</strong><br>" +
      FAIXAS.map((f) => `<i style="background:${f.cor}"></i>${f.nome}`).join(
        "<br>",
      );
    return div;
  };
  legenda.addTo(mapa);
}

function popupHtml(e) {
  // Todo valor passa por escapeHtml antes de entrar no HTML do popup.
  const linha = (rotulo, valor) =>
    `<dt>${escapeHtml(rotulo)}</dt><dd>${escapeHtml(valor)}</dd>`;
  return (
    `<div class="popup"><strong>${escapeHtml(fmtDataUtc(e.data))} UTC</strong><dl>` +
    linha("Energia de impacto", `${fmtEnergia(e.energia)} kt`) +
    linha("Energia irradiada", `${fmtNumero(e.irradiada, 2)} × 10¹⁰ J`) +
    linha("Latitude", fmtLatitude(e.lat)) +
    linha("Longitude", fmtLongitude(e.lon)) +
    linha(
      "Altitude",
      e.altitude === null ? VAZIO : `${fmtNumero(e.altitude)} km`,
    ) +
    linha(
      "Velocidade",
      e.velocidade === null ? VAZIO : `${fmtNumero(e.velocidade)} km/s`,
    ) +
    "</dl></div>"
  );
}

function atualizarMapa(lista) {
  if (!mapa) return;
  camadaMarcadores.clearLayers();
  // Desenha os menores primeiro para os maiores ficarem por cima.
  lista
    .filter((e) => e.lat !== null && e.lon !== null)
    .sort((a, b) => (a.energia ?? 0) - (b.energia ?? 0))
    .forEach((e) => {
      const energia = e.energia ?? 0;
      L.circleMarker([e.lat, e.lon], {
        radius: raioEnergia(energia),
        color: "#1b1f24",
        weight: 0.6,
        fillColor: corEnergia(energia),
        fillOpacity: 0.8,
      })
        .bindPopup(popupHtml(e))
        .addTo(camadaMarcadores);
    });
}

/* ---------- Gráfico de eventos por ano (Chart.js) ---------- */
function atualizarGrafico(lista) {
  if (typeof Chart === "undefined") return;
  const { anoIni, anoFim } = lerFiltros();
  const contagem = new Map();
  for (let a = anoIni; a <= anoFim; a++) contagem.set(a, 0);
  lista.forEach((e) => contagem.set(e.ano, (contagem.get(e.ano) || 0) + 1));

  const estilo = getComputedStyle(document.documentElement);
  const corBarra = estilo.getPropertyValue("--barra").trim();
  const corTexto = estilo.getPropertyValue("--texto-suave").trim();
  const corGrade = estilo.getPropertyValue("--borda").trim();
  const dados = {
    labels: [...contagem.keys()],
    datasets: [
      {
        label: "Eventos",
        data: [...contagem.values()],
        backgroundColor: corBarra,
        borderRadius: 3,
      },
    ],
  };

  if (grafico) {
    grafico.data = dados;
    grafico.update();
    return;
  }
  grafico = new Chart($("grafico"), {
    type: "bar",
    data: dados,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: corTexto, maxRotation: 90, autoSkip: true },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: corTexto, precision: 0 },
          grid: { color: corGrade },
        },
      },
    },
  });
}

/* ---------- Tabela ordenável ---------- */
function compararEventos(a, b) {
  const chave =
    ordem.coluna === "data"
      ? (e) => (e.data ? e.data.getTime() : null)
      : (e) => e.energia;
  const va = chave(a),
    vb = chave(b);
  if (va === null && vb === null) return 0;
  if (va === null) return 1; // nulos sempre no fim
  if (vb === null) return -1;
  return ordem.sentido === "asc" ? va - vb : vb - va;
}

function atualizarTabela(lista) {
  const linhas = [...lista]
    .sort(compararEventos)
    .map(
      (e) =>
        "<tr>" +
        `<td>${escapeHtml(fmtDataUtc(e.data))}</td>` +
        `<td>${escapeHtml(fmtEnergia(e.energia))}</td>` +
        `<td>${escapeHtml(fmtNumero(e.irradiada, 2))}</td>` +
        `<td>${escapeHtml(fmtLatitude(e.lat))}</td>` +
        `<td>${escapeHtml(fmtLongitude(e.lon))}</td>` +
        `<td>${escapeHtml(fmtNumero(e.altitude))}</td>` +
        `<td>${escapeHtml(fmtNumero(e.velocidade))}</td>` +
        "</tr>",
    );
  $("t-corpo").innerHTML = linhas.length
    ? linhas.join("")
    : '<tr><td colspan="7" class="tabela-vazia">Nenhum evento corresponde aos filtros.</td></tr>';

  // Indicadores visuais e de acessibilidade da ordenação.
  document.querySelectorAll("th[data-coluna]").forEach((th) => {
    const ativa = th.dataset.coluna === ordem.coluna;
    th.setAttribute(
      "aria-sort",
      ativa ? (ordem.sentido === "asc" ? "ascending" : "descending") : "none",
    );
    th.querySelector(".seta").textContent = ativa
      ? ordem.sentido === "asc"
        ? "▲"
        : "▼"
      : "";
  });
}

function alternarOrdem(coluna) {
  ordem =
    ordem.coluna === coluna
      ? { coluna, sentido: ordem.sentido === "asc" ? "desc" : "asc" }
      : { coluna, sentido: "desc" };
  atualizarTabela(filtrar());
}

/* ---------- Última execução do pipeline ---------- */
function mostrarUltimaExecucao(execucao) {
  const alvo = $("ultima-execucao");
  if (!execucao) {
    alvo.textContent = "Última atualização do pipeline: não disponível.";
    return;
  }
  const quando = new Date(execucao.finalizado_em || execucao.iniciado_em);
  const dataTexto = Number.isNaN(quando.getTime())
    ? VAZIO
    : `${formatoBrasilia.format(quando)} (horário de Brasília)`;
  const status = String(execucao.status ?? "");
  const classe = NOMES_STATUS[status] ? status : "";
  const nome = NOMES_STATUS[status] || status || VAZIO;
  const registros = execucao.registros_processados;
  alvo.innerHTML =
    `<span>Última atualização do pipeline: <strong>${escapeHtml(dataTexto)}</strong></span>` +
    `<span class="selo ${escapeHtml(classe)}">${escapeHtml(nome)}</span>` +
    (registros === null || registros === undefined
      ? ""
      : `<span class="suave">${escapeHtml(Number(registros).toLocaleString("pt-BR"))} registros processados</span>`);
}

/* ---------- Mensagens ---------- */
function mostrarErro(texto) {
  $("carregando").hidden = true;
  $("erro").hidden = false;
  $("erro").textContent = texto;
}

/* ---------- Inicialização ---------- */
async function iniciar() {
  if (
    SUPABASE_URL.includes("SEU-PROJETO") ||
    SUPABASE_ANON_KEY.includes("SUA_PUBLISHABLE_KEY")
  ) {
    mostrarErro(
      "Painel não configurado: preencha SUPABASE_URL e SUPABASE_ANON_KEY no início do script.",
    );
    $("ultima-execucao").textContent = "";
    return;
  }

  // As duas consultas rodam em paralelo; a falha da execução não impede o painel.
  const [resBolidos, resExecucao] = await Promise.allSettled([
    carregarBolidos((n) => {
      $("carregando").textContent =
        `Carregando os dados… ${n.toLocaleString("pt-BR")} eventos recebidos.`;
    }),
    carregarUltimaExecucao(),
  ]);

  mostrarUltimaExecucao(
    resExecucao.status === "fulfilled" ? resExecucao.value : null,
  );

  if (resBolidos.status === "rejected") {
    console.error(resBolidos.reason);
    mostrarErro(
      "Não foi possível carregar os dados agora. Verifique sua conexão e tente recarregar a página em alguns instantes.",
    );
    return;
  }

  eventos = resBolidos.value.map(prepararRegistro);
  if (!eventos.length) {
    mostrarErro("Ainda não há eventos gravados na base.");
    return;
  }

  $("carregando").hidden = true;
  $("conteudo").hidden = false;

  preencherAnos();
  if (typeof L !== "undefined") {
    criarMapa();
  } else {
    $("mapa").textContent = "Não foi possível carregar o mapa.";
  }
  if (typeof Chart === "undefined") {
    $("grafico").replaceWith(
      Object.assign(document.createElement("p"), {
        textContent: "Não foi possível carregar o gráfico.",
      }),
    );
  }

  // Eventos de interação.
  ["f-ano-ini", "f-ano-fim", "f-hemisferio"].forEach((id) =>
    $(id).addEventListener("change", atualizar),
  );
  let espera;
  $("f-energia").addEventListener("input", () => {
    clearTimeout(espera);
    espera = setTimeout(atualizar, 250);
  });
  $("f-limpar").addEventListener("click", limparFiltros);
  document
    .querySelectorAll("[data-ordenar]")
    .forEach((b) =>
      b.addEventListener("click", () => alternarOrdem(b.dataset.ordenar)),
    );

  atualizar();
}

// Todos os scripts com "defer" (Leaflet, Chart.js e este) já rodaram no DOMContentLoaded.
document.addEventListener("DOMContentLoaded", () => {
  iniciar().catch((erro) => {
    console.error(erro);
    mostrarErro(
      "Ocorreu um erro inesperado ao montar o painel. Tente recarregar a página.",
    );
  });
});
