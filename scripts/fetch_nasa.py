#!/usr/bin/env python3
"""
Pipeline SSD-CNEOS-Fireball (Grupo 07).

Coleta os bólidos (fireballs) da API SSD/CNEOS do NASA/JPL, normaliza os campos
para a tabela public.bolidos do Supabase e grava via API REST (PostgREST) com
upsert em lotes. Cada execução é registrada na tabela public.execucoes.

Uso:
    python scripts/fetch_nasa.py            # coleta e grava no Supabase
    python scripts/fetch_nasa.py --dry-run  # coleta e normaliza, sem acessar o Supabase

Credenciais (somente por variáveis de ambiente):
    SUPABASE_URL          URL do projeto Supabase
    SUPABASE_SERVICE_KEY  chave service_role (nunca aparece nos logs nem em execucoes)
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

# -----------------------------------------------------------------------------
# Configurações
# -----------------------------------------------------------------------------
URL_API = "https://ssd-api.jpl.nasa.gov/fireball.api"
PARAMETROS_API = {"vel-comp": "true"}  # sem isso, vx/vy/vz não vêm na resposta

TAMANHO_LOTE = 500
TIMEOUT = (10, 30)  # segundos: (para conectar, para ler a resposta)
MAX_TENTATIVAS = 3
ESPERA_BASE_SEGUNDOS = 2  # espera dobra a cada tentativa: 2s, 4s, ...
TAMANHO_MAX_MENSAGEM = 2000

TABELA_BOLIDOS = "bolidos"
TABELA_EXECUCOES = "execucoes"
CHAVE_NATURAL = "data_hora_utc"

# Campos que a API precisa devolver para o pipeline funcionar.
CAMPOS_OBRIGATORIOS = {
    "date", "energy", "impact-e", "lat", "lat-dir", "lon", "lon-dir",
    "alt", "vel", "vx", "vy", "vz",
}

# Falhas temporárias que justificam nova tentativa.
STATUS_REPETIVEIS = {429, 500, 502, 503, 504}
ERROS_DE_REDE = (
    requests.ConnectionError,
    requests.Timeout,
    requests.exceptions.ChunkedEncodingError,  # resposta cortada no meio
)

# Faixas aceitas pelas CHECK constraints de public.bolidos (sql/setup.sql).
# Validar antes evita que um único registro fora da faixa derrube um lote inteiro.
FAIXAS_VALIDAS = {
    "energia_irradiada_j_e10": (0, None),
    "energia_impacto_kt": (0, None),
    "latitude_graus": (-90, 90),
    "longitude_graus": (-180, 180),
    "altitude_km": (0, None),
    "velocidade_km_s": (0, None),
}

Registro = Dict[str, Any]

log = logging.getLogger("fetch_nasa")


class ErroCritico(Exception):
    """Falha que impede a coleta (API fora, resposta inválida, nenhum dado válido)."""


class ErroSupabase(Exception):
    """Falha ao gravar no Supabase. A mensagem já vem sem a chave secreta."""


# -----------------------------------------------------------------------------
# Proteção da chave secreta
# -----------------------------------------------------------------------------
class FiltroDeSegredo(logging.Filter):
    """Substitui a chave secreta por '***' em qualquer linha de log (proteção extra)."""

    def __init__(self, segredo: str) -> None:
        super().__init__()
        self.segredo = segredo

    def filter(self, registro: logging.LogRecord) -> bool:
        texto = registro.getMessage()
        if self.segredo in texto:
            registro.msg = texto.replace(self.segredo, "***")
            registro.args = ()
        return True


def proteger_logs(segredo: str) -> None:
    """Instala o filtro de segredo em todos os destinos de log."""
    for destino in logging.getLogger().handlers:
        destino.addFilter(FiltroDeSegredo(segredo))


# -----------------------------------------------------------------------------
# Requisições HTTP
# -----------------------------------------------------------------------------
def agora_utc_iso() -> str:
    """Data/hora atual em UTC no formato ISO 8601."""
    return datetime.now(timezone.utc).isoformat()


def requisitar_com_tentativas(sessao: requests.Session, metodo: str, url: str, *,
                              idempotente: bool = True, **kwargs: Any) -> requests.Response:
    """
    Faz a requisição com timeout e repete em falhas temporárias.

    - idempotente=True (GET e upsert): repete em erro de rede, timeout e HTTP 429/5xx,
      pois reenviar o mesmo pedido não muda o resultado.
    - idempotente=False (insert em execucoes): só repete quando é certo que o pedido
      não chegou ao servidor (timeout de conexão ou HTTP 429), para não duplicar o log.

    Erros 4xx (exceto 429) não são repetidos, pois indicam problema no próprio pedido.
    """
    erros_repetiveis = ERROS_DE_REDE if idempotente else (requests.ConnectTimeout,)
    status_repetiveis = STATUS_REPETIVEIS if idempotente else {429}

    for tentativa in range(1, MAX_TENTATIVAS + 1):
        ultima = tentativa == MAX_TENTATIVAS
        try:
            resposta = sessao.request(metodo, url, timeout=TIMEOUT, **kwargs)
        except erros_repetiveis as erro:
            if ultima:
                raise
            motivo = type(erro).__name__
        else:
            if resposta.status_code not in status_repetiveis or ultima:
                return resposta
            motivo = f"HTTP {resposta.status_code}"

        espera = ESPERA_BASE_SEGUNDOS * 2 ** (tentativa - 1)
        log.warning("Tentativa %d/%d falhou (%s). Nova tentativa em %ds.",
                    tentativa, MAX_TENTATIVAS, motivo, espera)
        time.sleep(espera)

    raise AssertionError("inalcançável")  # o laço sempre retorna ou lança


def resumir_resposta(resposta: requests.Response) -> str:
    """Texto curto de uma resposta HTTP de erro (só status e corpo, nunca cabeçalhos)."""
    return f"HTTP {resposta.status_code}: {resposta.text[:300]}"


# -----------------------------------------------------------------------------
# 1. Coleta
# -----------------------------------------------------------------------------
def buscar_api(sessao: requests.Session) -> Tuple[List[str], List[List[Any]]]:
    """Consulta a Fireball API e devolve (campos, linhas). Lança ErroCritico em falha."""
    try:
        resposta = requisitar_com_tentativas(sessao, "GET", URL_API, params=PARAMETROS_API)
    except requests.RequestException as erro:
        raise ErroCritico(f"API da NASA indisponível ({type(erro).__name__}).") from erro

    if resposta.status_code != 200:
        raise ErroCritico(f"API da NASA respondeu com erro: {resumir_resposta(resposta)}")

    try:
        corpo = resposta.json()
    except ValueError as erro:
        raise ErroCritico("Resposta da API não é um JSON válido.") from erro

    return validar_resposta(corpo)


def validar_resposta(corpo: Any) -> Tuple[List[str], List[List[Any]]]:
    """Confere se o JSON da API tem o formato esperado."""
    if not isinstance(corpo, dict):
        raise ErroCritico("Resposta da API em formato inesperado.")

    campos = corpo.get("fields")
    linhas = corpo.get("data")
    if not isinstance(campos, list) or not isinstance(linhas, list):
        raise ErroCritico("Resposta da API sem 'fields' ou 'data'.")

    faltando = CAMPOS_OBRIGATORIOS - set(campos)
    if faltando:
        raise ErroCritico(f"Resposta da API sem os campos: {sorted(faltando)}")

    if not linhas:
        raise ErroCritico("A API não retornou nenhum registro.")

    return campos, linhas


# -----------------------------------------------------------------------------
# 2. Normalização
# -----------------------------------------------------------------------------
def para_numero(valor: Optional[str]) -> Optional[float]:
    """Converte texto numérico da API em float; nulo ou vazio vira None."""
    if valor is None or str(valor).strip() == "":
        return None
    numero = float(valor)
    if not math.isfinite(numero):  # "nan"/"inf" gerariam um JSON inválido no envio
        raise ValueError(f"número inválido: {valor!r}")
    return numero


def para_data_iso(valor: Optional[str]) -> str:
    """Converte 'YYYY-MM-DD hh:mm:ss' (UTC) em ISO 8601 com fuso explícito ('...Z')."""
    if not valor:
        raise ValueError("data ausente")
    data = datetime.strptime(valor, "%Y-%m-%d %H:%M:%S")
    return data.strftime("%Y-%m-%dT%H:%M:%SZ")


def para_grau_com_sinal(valor: Optional[str], direcao: Optional[str],
                        negativa: str, positiva: str) -> Optional[float]:
    """Converte valor + direção (ex.: '41.8' + 'S') em grau com sinal (-41.8)."""
    numero = para_numero(valor)
    if numero is None:
        return None
    if direcao == negativa:
        return -numero
    if direcao == positiva:
        return numero
    raise ValueError(f"direção inválida: {direcao!r}")


def validar_faixas(registro: Registro) -> None:
    """Rejeita valores que violariam as CHECK constraints da tabela bolidos."""
    for coluna, (minimo, maximo) in FAIXAS_VALIDAS.items():
        valor = registro[coluna]
        if valor is None:
            continue
        if (minimo is not None and valor < minimo) or (maximo is not None and valor > maximo):
            raise ValueError(f"{coluna} fora da faixa: {valor}")

    if (registro["latitude_graus"] is None) != (registro["longitude_graus"] is None):
        raise ValueError("latitude e longitude devem vir juntas")


def normalizar_linha(campos: List[str], linha: List[Any]) -> Registro:
    """Transforma uma linha da API em um registro com as colunas de public.bolidos."""
    d = dict(zip(campos, linha))

    energia = para_numero(d["energy"])
    impacto = para_numero(d["impact-e"])
    if energia is None or impacto is None:
        raise ValueError("energy ou impact-e ausente")

    # id, coletado_em e atualizado_em não são enviados: o banco preenche.
    registro = {
        "data_hora_utc": para_data_iso(d["date"]),
        "energia_irradiada_j_e10": energia,
        "energia_impacto_kt": impacto,
        "latitude_graus": para_grau_com_sinal(d["lat"], d["lat-dir"], "S", "N"),
        "longitude_graus": para_grau_com_sinal(d["lon"], d["lon-dir"], "W", "E"),
        "altitude_km": para_numero(d["alt"]),
        "velocidade_km_s": para_numero(d["vel"]),
        "velocidade_x_km_s": para_numero(d["vx"]),
        "velocidade_y_km_s": para_numero(d["vy"]),
        "velocidade_z_km_s": para_numero(d["vz"]),
    }
    validar_faixas(registro)
    return registro


def normalizar(campos: List[str], linhas: List[List[Any]]) -> Tuple[List[Registro], int]:
    """Normaliza todas as linhas; linhas inválidas são descartadas e contadas."""
    registros: List[Registro] = []
    invalidas = 0
    for linha in linhas:
        try:
            registros.append(normalizar_linha(campos, linha))
        except (ValueError, TypeError) as erro:
            invalidas += 1
            log.warning("Registro descartado (%s): %s", erro, linha)
    return registros, invalidas


# -----------------------------------------------------------------------------
# 3. Deduplicação e lotes
# -----------------------------------------------------------------------------
def deduplicar(registros: List[Registro]) -> Tuple[List[Registro], int]:
    """
    Mantém um único registro por data_hora_utc (a primeira ocorrência).

    Evita o erro PostgreSQL 21000 ("ON CONFLICT DO UPDATE command cannot affect
    row a second time"), que ocorre quando o mesmo upsert traz a chave repetida.
    Como é feita na lista inteira, também não há repetição entre lotes diferentes.
    """
    unicos: Dict[str, Registro] = {}
    for registro in registros:
        unicos.setdefault(registro[CHAVE_NATURAL], registro)
    return list(unicos.values()), len(registros) - len(unicos)


def dividir_em_lotes(registros: List[Registro], tamanho: int) -> List[List[Registro]]:
    """Divide a lista em lotes de até 'tamanho' registros."""
    return [registros[i:i + tamanho] for i in range(0, len(registros), tamanho)]


def preparar_registros(campos: List[str], linhas: List[List[Any]]) -> Tuple[List[Registro], int, int]:
    """Normaliza e deduplica. Devolve (registros únicos, inválidos, duplicatas)."""
    registros, invalidas = normalizar(campos, linhas)
    unicos, duplicatas = deduplicar(registros)
    log.info("Inválidos descartados: %d | duplicatas removidas: %d | prontos para upsert: %d",
             invalidas, duplicatas, len(unicos))
    return unicos, invalidas, duplicatas


# -----------------------------------------------------------------------------
# 4. Supabase (PostgREST)
# -----------------------------------------------------------------------------
class ClienteSupabase:
    """
    Acesso mínimo à API REST do Supabase usando a chave service_role.

    Usa uma sessão HTTP própria: os cabeçalhos com a chave só são enviados ao
    Supabase, nunca à API da NASA.
    """

    def __init__(self, url: str, chave: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.chave = chave
        self.sessao = requests.Session()
        self.sessao.headers.update({
            "apikey": chave,
            "Authorization": f"Bearer {chave}",
            "Content-Type": "application/json",
        })

    def fechar(self) -> None:
        """Encerra a sessão HTTP."""
        self.sessao.close()

    def upsert_lote(self, lote: List[Registro]) -> None:
        """Upsert de um lote em bolidos (on_conflict na chave natural)."""
        self._enviar(
            TABELA_BOLIDOS, lote, idempotente=True,
            params={"on_conflict": CHAVE_NATURAL},
            prefer="resolution=merge-duplicates,return=minimal",
        )

    def registrar_execucao(self, execucao: Dict[str, Any]) -> None:
        """Insere uma linha em execucoes."""
        self._enviar(TABELA_EXECUCOES, execucao, idempotente=False, prefer="return=minimal")

    def _enviar(self, tabela: str, corpo: Any, *, idempotente: bool,
                prefer: str, params: Optional[Dict[str, str]] = None) -> None:
        """POST na tabela; qualquer falha vira ErroSupabase com a mensagem já limpa."""
        try:
            resposta = requisitar_com_tentativas(
                self.sessao, "POST", f"{self.base}/{tabela}",
                idempotente=idempotente, params=params,
                headers={"Prefer": prefer}, data=json.dumps(corpo),
            )
        except requests.RequestException as erro:
            raise ErroSupabase(self.ocultar_chave(f"{type(erro).__name__}: {erro}")) from None

        if resposta.status_code not in (200, 201, 204):
            raise ErroSupabase(self.ocultar_chave(resumir_resposta(resposta)))

    def ocultar_chave(self, texto: str) -> str:
        """Remove a chave secreta de um texto (proteção extra antes de logar/gravar)."""
        return texto.replace(self.chave, "***")


# -----------------------------------------------------------------------------
# 5. Resultado da execução e regras de status
# -----------------------------------------------------------------------------
@dataclass
class ResultadoExecucao:
    """Acumula os números da execução e decide o status final."""

    iniciado_em: str = field(default_factory=agora_utc_iso)
    registros_processados: int = 0
    numero_lotes: int = 0
    lotes_gravados: int = 0
    registros_invalidos: int = 0
    quantidade_erros: int = 0
    falha_critica: bool = False
    mensagens: List[str] = field(default_factory=list)

    def registrar_falha_critica(self, motivo: str) -> None:
        """Marca a execução como erro crítico."""
        self.falha_critica = True
        self.quantidade_erros += 1
        self.mensagens.append(motivo)

    @property
    def status(self) -> str:
        """
        Regras de status:
        - erro_critico: falha que impediu a coleta, ou nenhum lote gravado;
        - erro_parcial: algum lote falhou (mas outro foi gravado) ou houve
          registros inválidos descartados;
        - concluido: todos os lotes gravados e nenhum registro descartado.
        """
        if self.falha_critica or self.lotes_gravados == 0:
            return "erro_critico"
        if self.lotes_gravados < self.numero_lotes or self.registros_invalidos:
            return "erro_parcial"
        return "concluido"

    def mensagem(self) -> str:
        """Resumo legível para a coluna execucoes.mensagem."""
        resumo = (f"{self.registros_processados} registro(s) gravado(s) em "
                  f"{self.lotes_gravados}/{self.numero_lotes} lote(s); "
                  f"{self.quantidade_erros} erro(s)")
        return " | ".join([resumo, *self.mensagens])[:TAMANHO_MAX_MENSAGEM]

    def como_linha(self) -> Dict[str, Any]:
        """Linha no formato da tabela execucoes."""
        return {
            "iniciado_em": self.iniciado_em,
            "finalizado_em": agora_utc_iso(),
            "registros_processados": self.registros_processados,
            "numero_lotes": self.numero_lotes,
            "quantidade_erros": self.quantidade_erros,
            "status": self.status,
            "mensagem": self.mensagem(),
        }


# -----------------------------------------------------------------------------
# 6. Execução
# -----------------------------------------------------------------------------
def ler_credenciais() -> Optional[Tuple[str, str]]:
    """Lê SUPABASE_URL e SUPABASE_SERVICE_KEY do ambiente; None se faltar alguma."""
    url = os.environ.get("SUPABASE_URL", "").strip()
    chave = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not chave:
        return None
    return url, chave


def enviar_lotes(cliente: ClienteSupabase, registros: List[Registro],
                 resultado: ResultadoExecucao) -> None:
    """Envia os registros em lotes; a falha de um lote não interrompe os demais."""
    lotes = dividir_em_lotes(registros, TAMANHO_LOTE)
    resultado.numero_lotes = len(lotes)

    for indice, lote in enumerate(lotes, start=1):
        try:
            cliente.upsert_lote(lote)
        except ErroSupabase as erro:
            resultado.quantidade_erros += 1
            resultado.mensagens.append(f"lote {indice}: {erro}")
            log.error("Lote %d/%d falhou: %s", indice, len(lotes), erro)
            continue
        resultado.lotes_gravados += 1
        resultado.registros_processados += len(lote)
        log.info("Lote %d/%d enviado (%d registros).", indice, len(lotes), len(lote))


def coletar_e_gravar(sessao_nasa: requests.Session, cliente: ClienteSupabase,
                     resultado: ResultadoExecucao) -> None:
    """Etapas principais: coleta, normalização, deduplicação e upsert em lotes."""
    campos, linhas = buscar_api(sessao_nasa)
    log.info("Registros recebidos da API: %d", len(linhas))

    registros, invalidas, _ = preparar_registros(campos, linhas)
    resultado.registros_invalidos = invalidas
    resultado.quantidade_erros += invalidas
    if invalidas:
        resultado.mensagens.append(f"{invalidas} registro(s) inválido(s) descartado(s)")
    if not registros:
        raise ErroCritico("Nenhum registro válido após a normalização.")

    enviar_lotes(cliente, registros, resultado)
    if resultado.lotes_gravados == 0:
        resultado.mensagens.insert(0, "nenhum lote foi gravado")


def registrar_execucao(cliente: ClienteSupabase, resultado: ResultadoExecucao) -> bool:
    """Grava o resultado em execucoes. Devolve False se não conseguir."""
    try:
        cliente.registrar_execucao(resultado.como_linha())
    except ErroSupabase as erro:
        log.error("Não foi possível registrar a execução em %s: %s", TABELA_EXECUCOES, erro)
        return False
    log.info("Execução registrada em %s.", TABELA_EXECUCOES)
    return True


def executar(sessao_nasa: requests.Session) -> int:
    """Pipeline completo. Devolve o código de saída (0 = concluído, 1 = falha)."""
    resultado = ResultadoExecucao()

    credenciais = ler_credenciais()
    if credenciais is None:
        # Sem credenciais não há como gravar nem registrar a execução.
        log.error("ERRO CRÍTICO: variáveis de ambiente SUPABASE_URL e/ou "
                  "SUPABASE_SERVICE_KEY ausentes. Execução não registrada.")
        return 1

    url, chave = credenciais
    proteger_logs(chave)
    cliente = ClienteSupabase(url, chave)

    try:
        coletar_e_gravar(sessao_nasa, cliente, resultado)
    except ErroCritico as erro:
        log.error("ERRO CRÍTICO: %s", erro)
        resultado.registrar_falha_critica(str(erro))
    except Exception as erro:  # erro inesperado: ainda assim registra em execucoes
        log.exception("ERRO CRÍTICO inesperado.")
        resultado.registrar_falha_critica(
            cliente.ocultar_chave(f"erro inesperado: {type(erro).__name__}: {erro}"))

    try:
        registrado = registrar_execucao(cliente, resultado)
    finally:
        cliente.fechar()

    log.info("Resultado final: %s | %s", resultado.status.upper(), resultado.mensagem())
    return 0 if resultado.status == "concluido" and registrado else 1


def executar_dry_run(sessao_nasa: requests.Session) -> int:
    """Busca e normaliza os dados e mostra um resumo, sem acessar o Supabase."""
    log.info("Modo --dry-run: o Supabase NÃO será acessado.")
    try:
        campos, linhas = buscar_api(sessao_nasa)
    except ErroCritico as erro:
        log.error("ERRO CRÍTICO: %s", erro)
        return 1
    log.info("Registros recebidos da API: %d", len(linhas))

    registros, _, _ = preparar_registros(campos, linhas)
    lotes = dividir_em_lotes(registros, TAMANHO_LOTE)
    log.info("Seriam enviados %d lote(s) de até %d registros.", len(lotes), TAMANHO_LOTE)
    log.info("Exemplo de 3 registros normalizados:")
    for registro in registros[:3]:
        print(json.dumps(registro, ensure_ascii=False, indent=2))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Coleta a Fireball API (NASA/JPL) e grava no Supabase.")
    parser.add_argument("--dry-run", action="store_true",
                        help="busca e normaliza os dados sem acessar o Supabase")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s",
                        datefmt="%Y-%m-%d %H:%M:%S")
    log.info("Início da coleta da Fireball API.")

    # Sessão só para a NASA: nunca carrega os cabeçalhos com a chave do Supabase.
    with requests.Session() as sessao_nasa:
        if args.dry_run:
            codigo = executar_dry_run(sessao_nasa)
        else:
            codigo = executar(sessao_nasa)

    sys.exit(codigo)


if __name__ == "__main__":
    main()
