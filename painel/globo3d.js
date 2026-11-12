/* =============================================================================
   Início: Visão 3D gerada com auxílio de IA (Claude Code)

   Globo 3D dos bólidos, com os eventos caindo como uma chuva de meteoros.
   - Biblioteca: globe.gl (inclui o Three.js), baixada SOMENTE no primeiro
     clique em "3D" (lazy load), com versão fixa e verificação SRI.
   - Reaproveita do script.js: filtrar(), popupHtml() (que já passa todo valor
     do banco pelo escapeHtml), FAIXAS, corEnergia() e raioEnergia().
   - Não altera a consulta ao Supabase, a paginação nem os filtros: só recebe
     a lista já filtrada por atualizarGlobo3d().
   ============================================================================= */

const GLOBO_LIB = {
  src: "https://cdn.jsdelivr.net/npm/globe.gl@2.46.2/dist/globe.gl.min.js",
  integrity: "sha384-1uolMBZ25k3zJcNwCLEv49+L+m2dZudqAzsoSAJfQTzDCSBxJzrMuZ2dkp/5JKiT",
};
// Texturas da Terra de dia (projeção equirretangular) do pacote three-globe.
const GLOBO_TEXTURA = {
  dia: "https://cdn.jsdelivr.net/npm/three-globe@2.45.6/example/img/earth-blue-marble.jpg", // ~1,4 MB, desktop
  diaLeve: "https://cdn.jsdelivr.net/npm/three-globe@2.45.6/example/img/earth-day.jpg", // ~240 KB, celular
};
const GLOBO_TEMPO_LIMITE_MS = 20000; // desiste de carregar a biblioteca depois disso

// Rastro de fogo: trechos consecutivos que andam juntos atrás da ponta do meteoro,
// esfriando do branco ao vermelho e afinando para trás. de/ate = distância até a
// ponta, em fração do trajeto; largura em pixels (escalada pela energia).
const CAMADAS_FOGO = [
  { de: 0.26, ate: 0.45, cor: "rgba(190, 40, 10, 0.7)", largura: 1.6 }, // brasas
  { de: 0.12, ate: 0.26, cor: "#ff7a1a", largura: 2.6 }, // chama laranja
  { de: 0.04, ate: 0.12, cor: "#ffd27a", largura: 3.6 }, // núcleo amarelo
  { de: 0, ate: 0.04, cor: "#ffffff", largura: 5 }, // cabeça incandescente
];
const CAMADAS_FOGO_CELULAR = [
  { de: 0.2, ate: 0.38, cor: "#b8300c" },
  { de: 0.06, ate: 0.2, cor: "#ff8a1e" },
  { de: 0, ate: 0.06, cor: "#fff4cc" },
];
const RASTRO = Math.max(...CAMADAS_FOGO.map((c) => c.ate)); // o rastro some depois desse trecho

const prefereMenosMovimento = window.matchMedia("(prefers-reduced-motion: reduce)");

let globo = null; // instância do globe.gl (criada no primeiro uso)
let promessaGlobo = null; // evita baixar a biblioteca duas vezes
let modo3d = false;
let cfg3d = null; // ajustes de desempenho (desktop x celular)
let listaGlobo = []; // última lista filtrada recebida do script.js
const dadosGlobo = new WeakMap(); // evento -> objeto do globo (mantém a identidade entre atualizações)

// Estado da chuva de meteoros
const chuva = { timer: null, quadro: null, inicio: 0, intervalo: 0, indice: 0, fila: [], ativos: [], pontos: [], aneis: [] };

/* ---------- Configuração conforme o aparelho ---------- */
function configurar3d() {
  const movel = window.matchMedia("(max-width: 800px), (pointer: coarse)").matches;
  return {
    movel,
    maxSimultaneos: movel ? 8 : 24, // meteoros caindo ao mesmo tempo
    quedaMs: movel ? 1100 : 1400, // duração da queda de cada meteoro
    msPorEvento: 120, // ritmo da chuva com poucos eventos
    duracaoMin: 2500, // a chuva inteira dura entre 2,5 s...
    duracaoMax: movel ? 9000 : 12000, // ...e 9 s (celular) ou 12 s (desktop)
    textura: movel ? GLOBO_TEXTURA.diaLeve : GLOBO_TEXTURA.dia,
    camadasFogo: movel ? CAMADAS_FOGO_CELULAR : CAMADAS_FOGO,
  };
}

function suportaWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")));
  } catch {
    return false;
  }
}

/* ---------- Lazy load da biblioteca ---------- */
function carregarScript({ src, integrity }) {
  if (typeof Globe === "function") return Promise.resolve();
  return new Promise((resolver, rejeitar) => {
    const script = document.createElement("script");
    script.src = src;
    script.integrity = integrity;
    script.crossOrigin = "anonymous";
    script.async = true;
    const limite = setTimeout(() => rejeitar(new Error("tempo esgotado ao baixar o globe.gl")), GLOBO_TEMPO_LIMITE_MS);
    script.onload = () => {
      clearTimeout(limite);
      typeof Globe === "function" ? resolver() : rejeitar(new Error("globe.gl indisponível"));
    };
    script.onerror = () => {
      clearTimeout(limite);
      script.remove();
      rejeitar(new Error("falha ao baixar o globe.gl"));
    };
    document.head.appendChild(script);
  });
}

function garantirGlobo() {
  if (globo) return Promise.resolve();
  if (!promessaGlobo) {
    promessaGlobo = carregarScript(GLOBO_LIB)
      .then(criarGlobo)
      .catch((erro) => {
        promessaGlobo = null; // permite tentar de novo num próximo clique
        throw erro;
      });
  }
  return promessaGlobo;
}

/* ---------- Criação do globo ---------- */
// Cada evento vira um objeto fixo do globo; ele guarda o evento original para o tooltip.
function dadoGlobo(e) {
  let d = dadosGlobo.get(e);
  if (!d) {
    const energia = e.energia ?? 0;
    d = { e, lat: e.lat, lng: e.lon, cor: corEnergia(energia), raio: raioEnergia(energia) };
    dadosGlobo.set(e, d);
  }
  return d;
}

function criarGlobo() {
  cfg3d = configurar3d();
  const elemento = $("globo");
  const reduzir = prefereMenosMovimento.matches;

  // Se o WebGL falhar aqui, o erro sobe até mostrar3d(), que volta para o 2D.
  const g = new Globe(elemento, {
    rendererConfig: { antialias: !cfg3d.movel, alpha: true },
    waitForGlobeReady: false,
    animateIn: !reduzir,
  });

  g.width(elemento.clientWidth)
    .height(elemento.clientHeight)
    .backgroundColor("rgba(0, 0, 0, 0)") // deixa aparecer o fundo de céu do painel
    .globeImageUrl(cfg3d.textura)
    .showAtmosphere(true)
    .atmosphereColor("#7aa2ff")
    .atmosphereAltitude(0.18)
    .pointOfView({ lat: 12, lng: -40, altitude: cfg3d.movel ? 2.7 : 2.2 });

  // Pontos de impacto: cor e tamanho pela energia (mesma escala do mapa 2D).
  g.pointLat("lat")
    .pointLng("lng")
    .pointColor("cor")
    .pointAltitude(0.006)
    .pointRadius((d) => d.raio * 0.07)
    .pointResolution(cfg3d.movel ? 6 : 10)
    .pointsTransitionDuration(reduzir ? 0 : 400)
    .pointLabel((d) => popupHtml(d.e)) // popupHtml aplica escapeHtml em todos os valores
    .onPointHover((d) => (elemento.style.cursor = d ? "pointer" : ""))
    .onPointClick((d) => mostrarInfo(d))
    .onGlobeClick(() => esconderInfo());

  // Meteoros: cada trecho do fogo é uma linha do espaço até o ponto, da qual só um
  // pedaço (dash) aparece e percorre o trajeto. No celular, linhas simples (mais leves).
  // O deslocamento inicial (initialGap) põe cada pedaço a "de" da ponta: 1 + de na
  // linha simples e -ate na linha grossa (as duas contam o dash de modos diferentes).
  // A animação automática da biblioteca fica desligada (pathDashAnimateTime = 0):
  // ela reinicia o rastro de todos os meteoros sempre que a lista muda. O avanço é
  // aplicado por moverFogo(), a partir do relógio de cada meteoro.
  g.pathPoints("pontos")
    .pathPointLat((p) => p[0])
    .pathPointLng((p) => p[1])
    .pathPointAlt((p) => p[2])
    .pathColor("cor")
    .pathStroke(cfg3d.movel ? null : (c) => c.espessura)
    .pathDashLength((c) => c.ate - c.de)
    .pathDashGap(2)
    .pathDashInitialGap(cfg3d.movel ? (c) => 1 + c.de : (c) => -c.ate)
    .pathDashAnimateTime(0)
    .pathTransitionDuration(0)
    .pathResolution(2); // menos vértices por linha: mais leve

  // Clarão do impacto: anel que se expande, esfriando do amarelo-claro ao vermelho, e some.
  g.ringLat("lat")
    .ringLng("lng")
    .ringColor(() => (t) => `rgba(255, ${Math.round(225 - 165 * t)}, ${Math.round(130 - 110 * t)}, ${Math.max(0, 1 - t)})`)
    .ringMaxRadius("raioMax")
    .ringPropagationSpeed("velocidade")
    .ringRepeatPeriod(2000) // maior que a duração do anel: só um anel por impacto
    .ringAltitude(0.004);

  g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg3d.movel ? 1.5 : 2));

  // Giro automático lento, que para quando o usuário mexe no globo.
  const controles = g.controls();
  controles.autoRotate = !reduzir;
  controles.autoRotateSpeed = 0.35;
  controles.addEventListener("start", () => (controles.autoRotate = false));

  // Acompanha o tamanho do campo (rotação do celular, redimensionamento da janela).
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => {
      if (modo3d && elemento.clientWidth) g.width(elemento.clientWidth).height(elemento.clientHeight);
    }).observe(elemento);
  }

  globo = g;

  // Espera a textura carregar (ou no máximo 8 s) antes de começar a chuva.
  return new Promise((resolver) => {
    const limite = setTimeout(resolver, 8000);
    g.onGlobeReady(() => {
      clearTimeout(limite);
      resolver();
    });
  });
}

/* ---------- Chuva de meteoros ---------- */
function comCoordenadas(lista) {
  return lista.filter((e) => e.lat !== null && e.lon !== null);
}

function criarMeteoro(e, agora) {
  const d = dadoGlobo(e);
  // Entrada oblíqua, como a dos bólidos reais (cerca de 40° em relação ao solo):
  // começa ~20° ao lado do ponto e a 0,3 raio terrestre de altitude. Uma queda quase
  // vertical seria vista "de frente" pela câmera e o rastro viraria um ponto.
  // A direção de entrada varia de evento para evento (derivada da data).
  const angulo = (((e.data ? e.data.getTime() / 1000 : 0) + d.lat * 7) % 360) * (Math.PI / 180);
  const latInicio = Math.max(-89, Math.min(89, d.lat + 20 * Math.sin(angulo)));
  const lngInicio = d.lng + 20 * Math.cos(angulo);
  const pontos = [
    [latInicio, lngInicio, 0.3],
    [d.lat, d.lng, 0],
  ];
  const escala = 0.6 + d.raio * 0.05; // bólidos mais energéticos têm fogo mais largo
  return {
    d,
    inicio: agora,
    impactou: false,
    camadas: cfg3d.camadasFogo.map((c) => ({
      pontos,
      cor: c.cor,
      de: c.de,
      ate: c.ate,
      espessura: (c.largura || 0) * escala,
      inicio: agora, // relógio do meteoro, usado por moverFogo()
    })),
  };
}

// Posiciona o trecho de fogo conforme o tempo de queda do seu meteoro. Roda logo antes
// de a linha ser desenhada, então vale mesmo que a biblioteca tenha acabado de
// reconstruir a linha (o que acontece a cada meteoro novo).
function moverFogo() {
  const c = this.__camadaFogo;
  const percorrido = (performance.now() - c.inicio) / cfg3d.quedaMs; // 1 = ponta no chão
  if (this.type === "Line2") this.material.dashOffset = c.ate - percorrido; // linha grossa
  else if (this.material.uniforms && this.material.uniforms.dashTranslate) {
    this.material.uniforms.dashTranslate.value = percorrido; // linha simples
  }
}

// A biblioteca cria as linhas de forma assíncrona; a cada quadro, liga moverFogo()
// às linhas novas. Só roda enquanto há meteoros caindo.
function ligarFogo() {
  for (const m of chuva.ativos) {
    for (const c of m.camadas) {
      const linha = c.__threeObjPath && c.__threeObjPath.children[0];
      if (linha && linha.__camadaFogo !== c) {
        linha.__camadaFogo = c;
        linha.onBeforeRender = moverFogo;
      }
    }
  }
  chuva.quadro = chuva.ativos.length ? requestAnimationFrame(ligarFogo) : null;
}

function registrarImpacto(d, agora, comBrilho) {
  chuva.pontos.push(d);
  if (comBrilho) {
    const raioMax = 1.5 + d.raio * 0.25;
    chuva.aneis.push({ lat: d.lat, lng: d.lng, raioMax, velocidade: raioMax / 0.8, fim: agora + 800 });
  }
}

function passoChuva() {
  const agora = performance.now();
  let mudouPontos = false;
  let mudouRastros = false;
  let mudouAneis = false;

  // 1. Solta os eventos cuja vez chegou. Acima do limite de meteoros simultâneos,
  //    o evento vai direto para o chão: a sequência acelera em vez de travar.
  const devidos = Math.min(chuva.fila.length, Math.floor((agora - chuva.inicio) / chuva.intervalo) + 1);
  while (chuva.indice < devidos) {
    const e = chuva.fila[chuva.indice++];
    if (chuva.ativos.length < cfg3d.maxSimultaneos) {
      chuva.ativos.push(criarMeteoro(e, agora));
      mudouRastros = true;
    } else {
      registrarImpacto(dadoGlobo(e), agora, false);
      mudouPontos = true;
    }
  }

  // 2. Meteoros que chegaram ao chão deixam o ponto e o brilho; o rastro some logo depois.
  for (const m of chuva.ativos) {
    if (!m.impactou && agora - m.inicio >= cfg3d.quedaMs) {
      m.impactou = true;
      registrarImpacto(m.d, agora, true);
      mudouPontos = mudouAneis = true;
    }
  }
  const antes = chuva.ativos.length;
  chuva.ativos = chuva.ativos.filter((m) => agora - m.inicio < cfg3d.quedaMs * (1 + RASTRO));
  if (chuva.ativos.length !== antes) mudouRastros = true;

  const aneisAntes = chuva.aneis.length;
  chuva.aneis = chuva.aneis.filter((a) => a.fim > agora);
  if (chuva.aneis.length !== aneisAntes) mudouAneis = true;

  // Uma atualização por camada a cada passo (mais leve que uma por meteoro).
  if (mudouPontos) globo.pointsData(chuva.pontos.slice());
  if (mudouRastros) {
    globo.pathsData(chuva.ativos.flatMap((m) => m.camadas));
    if (chuva.ativos.length && !chuva.quadro) chuva.quadro = requestAnimationFrame(ligarFogo);
  }
  if (mudouAneis) globo.ringsData(chuva.aneis.slice());

  if (chuva.indice >= chuva.fila.length && !chuva.ativos.length && !chuva.aneis.length) {
    clearInterval(chuva.timer);
    chuva.timer = null;
    $("globo-chuva").disabled = false;
  }
}

function pararChuva() {
  clearInterval(chuva.timer);
  chuva.timer = null;
  cancelAnimationFrame(chuva.quadro);
  chuva.quadro = null;
  chuva.ativos = [];
  chuva.aneis = [];
  $("globo-chuva").disabled = false;
  if (globo) globo.pathsData([]).ringsData([]);
}

function iniciarChuva() {
  if (!globo) return;
  pararChuva();
  esconderInfo();
  chuva.fila = comCoordenadas(listaGlobo).sort(
    (a, b) => (a.data ? a.data.getTime() : 0) - (b.data ? b.data.getTime() : 0),
  );
  chuva.pontos = [];
  chuva.indice = 0;

  const total = chuva.fila.length;
  $("globo-contagem").textContent = total
    ? `${total.toLocaleString("pt-BR")} ${total === 1 ? "bólido" : "bólidos"} com localização`
    : "Nenhum bólido com localização nos filtros atuais";

  // Menos movimento: sem queda, os pontos aparecem direto.
  if (prefereMenosMovimento.matches || !total) {
    globo.pointsData(chuva.fila.map(dadoGlobo));
    return;
  }

  globo.pointsData([]);
  const duracao = Math.min(cfg3d.duracaoMax, Math.max(cfg3d.duracaoMin, total * cfg3d.msPorEvento));
  chuva.intervalo = duracao / total;
  chuva.inicio = performance.now();
  $("globo-chuva").disabled = true;
  chuva.timer = setInterval(passoChuva, 80);
  passoChuva();
}

/* ---------- Detalhes do ponto (toque ou clique) ---------- */
function mostrarInfo(d) {
  const caixa = $("globo-info");
  // popupHtml já escapa todos os valores vindos do banco.
  caixa.innerHTML =
    '<button type="button" class="globo-info-fechar" aria-label="Fechar detalhes">×</button>' + popupHtml(d.e);
  caixa.hidden = false;
  $("globo-area").classList.add("com-info");
}

function esconderInfo() {
  $("globo-info").hidden = true;
  $("globo-area").classList.remove("com-info");
}

/* ---------- Alternância 2D / 3D ---------- */
function marcarBotoes() {
  $("v-2d").setAttribute("aria-pressed", String(!modo3d));
  $("v-3d").setAttribute("aria-pressed", String(modo3d));
}

function mostrar2d() {
  modo3d = false;
  marcarBotoes();
  pararChuva();
  if (globo) globo.pauseAnimation(); // nada fica rodando escondido
  $("globo-area").hidden = true;
  $("mapa").hidden = false;
  if (typeof mapa !== "undefined" && mapa) mapa.invalidateSize();
}

function falhar3d(mensagem) {
  mostrar2d();
  const aviso = $("aviso-3d");
  aviso.textContent = mensagem;
  aviso.hidden = false;
}

async function mostrar3d() {
  if (modo3d) return;
  $("aviso-3d").hidden = true;
  if (!suportaWebGL()) {
    falhar3d("Seu navegador não suporta gráficos 3D (WebGL). Voltamos para o mapa 2D.");
    return;
  }

  modo3d = true;
  marcarBotoes();
  $("mapa").hidden = true;
  $("globo-area").hidden = false;
  $("globo-carregando").hidden = !!globo;

  try {
    await garantirGlobo();
  } catch (erro) {
    console.error(erro);
    falhar3d("Não foi possível carregar a visão 3D agora. Voltamos para o mapa 2D.");
    return;
  }
  $("globo-carregando").hidden = true;
  if (!modo3d) return; // o usuário voltou para o 2D enquanto carregava

  const elemento = $("globo");
  globo.width(elemento.clientWidth).height(elemento.clientHeight);
  globo.resumeAnimation();
  iniciarChuva();
}

/* ---------- Ligação com o script.js ---------- */
// Chamada pelo atualizar() do script.js sempre que os filtros mudam.
function atualizarGlobo3d(lista) {
  listaGlobo = lista;
  if (modo3d && globo) iniciarChuva();
}

function montarLegenda3d() {
  const legenda = $("globo-legenda");
  const titulo = document.createElement("strong");
  titulo.textContent = "Energia de impacto";
  legenda.append(titulo);
  FAIXAS.forEach((f) => {
    const linha = document.createElement("div");
    const cor = document.createElement("i");
    cor.style.background = f.cor;
    linha.append(cor, f.nome);
    legenda.append(linha);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  montarLegenda3d();
  $("v-2d").addEventListener("click", mostrar2d);
  $("v-3d").addEventListener("click", mostrar3d);
  $("globo-chuva").addEventListener("click", iniciarChuva);
  $("globo-info").addEventListener("click", (ev) => {
    if (ev.target.closest(".globo-info-fechar")) esconderInfo();
  });
  if (prefereMenosMovimento.matches) {
    $("globo-chuva").hidden = true; // sem animação, não há chuva para repetir
  }
});

/* Fim: Visão 3D gerada com auxílio de IA (Claude Code) */
