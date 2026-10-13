#!/usr/bin/env python3
"""
Pipeline SSD-CNEOS-Fireball — Grupo 07.

Coleta os bólidos (fireballs) da API SSD/CNEOS do NASA/JPL, normaliza os campos
para a tabela public.bolidos do Supabase e grava via API REST (PostgREST) com
upsert em lotes. Cada execução é registrada na tabela public.execucoes.

Uso:
    python scripts/fetch_nasa.py            # coleta e grava no Supabase
    python scripts/fetch_nasa.py --dry-run  # coleta e normaliza, sem acessar o Supabase

Credenciais (somente por variáveis de ambiente):
    SUPABASE_URL          URL do projeto Supabase
    SUPABASE_SERVICE_KEY  chave service_role (nunca é impressa nos logs)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

# -----------------------------------------------------------------------------
# Configurações
# -----------------------------------------------------------------------------
URL_API = "https://ssd-api.jpl.nasa.gov/fireball.api"
PARAMETROS_API = {"vel-comp": "true"}  # sem isso, vx/vy/vz não vêm na resposta

TAMANHO_LOTE = 500
TIMEOUT_SEGUNDOS = 30
MAX_TENTATIVAS = 3
ESPERA_BASE_SEGUNDOS = 2  # espera cresce a cada tentativa: 2s, 4s, ...

TABELA_BOLIDOS = "bolidos"
TABELA_EXECUCOES = "execucoes"
CHAVE_NATURAL = "data_hora_utc"

# Campos que a API precisa devolver para o pipeline funcionar.
CAMPOS_OBRIGATORIOS = {
    "date", "energy", "impact-e", "lat", "lat-dir", "lon", "lon-dir",
    "alt", "vel", "vx", "vy", "vz",
}

# Códigos HTTP que justificam nova tentativa (instabilidade temporária).
STATUS_REPETIVEIS = {429, 500, 502, 503, 504}

log = logging.getLogger("fetch_nasa")


class ErroCritico(Exception):
    """Falha que impede a coleta (API fora, resposta inválida, configuração ausente)."""


# -----------------------------------------------------------------------------
# Utilitários
# -----------------------------------------------------------------------------
def agora_utc_iso() -> str:
    """Data/hora atual em UTC no formato ISO 8601."""
    return datetime.now(timezone.utc).isoformat()


def requisitar_com_tentativas(sessao: requests.Session, metodo: str, url: str,
                              **kwargs: Any) -> requests.Response:
    """
    Faz a requisição com timeout e repete em falhas de rede ou HTTP 429/5xx.
    Erros 4xx (exceto 429) não são repetidos, pois indicam problema nos dados.
    """
    ultimo_erro: Optional[Exception] = None
    for tentativa in range(1, MAX_TENTATIVAS + 1):
        try:
            resposta = sessao.request(metodo, url, timeout=TIMEOUT_SEGUNDOS, **kwargs)
            if resposta.status_code not in STATUS_REPETIVEIS:
                return resposta
            ultimo_erro = requests.HTTPError(f"HTTP {resposta.status_code}")
        except (requests.ConnectionError, requests.Timeout) as erro:
            ultimo_erro = erro

        if tentativa < MAX_TENTATIVAS:
            espera = ESPERA_BASE_SEGUNDOS * 2 ** (tentativa - 1)
            log.warning("Tentativa %d/%d falhou (%s). Nova tentativa em %ds.",
                        tentativa, MAX_TENTATIVAS, type(ultimo_erro).__name__, espera)
            time.sleep(espera)

    raise ultimo_erro  # type: ignore[misc]


def resumir_resposta(resposta: requests.Response) -> str:
    """Texto curto de uma resposta de erro (sem cabeçalhos, que contêm a chave)."""
    return f"HTTP {resposta.status_code}: {resposta.text[:300]}"


# -----------------------------------------------------------------------------
# 1. Coleta
# -----------------------------------------------------------------------------
def buscar_api(sessao: requests.Session) -> Tuple[List[str], List[List[Any]]]:
    """Consulta a Fireball API e devolve (campos, linhas)."""
    try:
        resposta = requisitar_com_tentativas(sessao, "GET", URL_API, params=PARAMETROS_API)
    except requests.RequestException as erro:
        raise ErroCritico(f"API da NASA indisponível: {erro}") from erro

    if resposta.status_code != 200:
        raise ErroCritico(f"API da NASA respondeu com erro: {resumir_resposta(resposta)}")

    try:
        corpo = resposta.json()
    except ValueError as erro:
        raise ErroCritico("Resposta da API não é um JSON válido.") from erro

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
    return float(valor)


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


def normalizar_linha(campos: List[str], linha: List[Any]) -> Dict[str, Any]:
    """Transforma uma linha da API em um registro com as colunas de public.bolidos."""
    d = dict(zip(campos, linha))

    energia = para_numero(d["energy"])
    impacto = para_numero(d["impact-e"])
    if energia is None or impacto is None:
        raise ValueError("energy ou impact-e ausente")

    # id, coletado_em e atualizado_em não são enviados: o banco preenche.
    return {
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


def normalizar(campos: List[str], linhas: List[List[Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """Normaliza todas as linhas; linhas inválidas são descartadas e contadas."""
    registros: List[Dict[str, Any]] = []
    invalidas = 0
    for linha in linhas:
        try:
            registros.append(normalizar_linha(campos, linha))
        except (ValueError, TypeError) as erro:
            invalidas += 1
            log.warning("Registro descartado (%s): %s", erro, linha)
    return registros, invalidas


# -----------------------------------------------------------------------------
# 3. Deduplicação pela chave natural
# -----------------------------------------------------------------------------
def deduplicar(registros: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """
    Mantém um único registro por data_hora_utc (a primeira ocorrência).
    Evita o erro PostgreSQL 21000: o mesmo upsert não pode afetar a mesma
    linha duas vezes.
    """
    unicos: Dict[str, Dict[str, Any]] = {}
    for registro in registros:
        unicos.setdefault(registro[CHAVE_NATURAL], registro)
    return list(unicos.values()), len(registros) - len(unicos)


def dividir_em_lotes(registros: List[Dict[str, Any]], tamanho: int) -> List[List[Dict[str, Any]]]:
    """Divide a lista em lotes de até 'tamanho' registros."""
    return [registros[i:i + tamanho] for i in range(0, len(registros), tamanho)]


# -----------------------------------------------------------------------------
# 4. Supabase (PostgREST)
# -----------------------------------------------------------------------------
class ClienteSupabase:
    """Acesso mínimo à API REST do Supabase usando a chave service_role."""

    def __init__(self, url: str, chave: str, sessao: requests.Session) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.sessao = sessao
        # Os cabeçalhos ficam só na sessão e nunca são registrados nos logs.
        self.sessao.headers.update({
            "apikey": chave,
            "Authorization": f"Bearer {chave}",
            "Content-Type": "application/json",
        })

    def upsert_lote(self, lote: List[Dict[str, Any]]) -> None:
        """Upsert de um lote em bolidos; lança exceção em caso de falha."""
        resposta = requisitar_com_tentativas(
            self.sessao, "POST", f"{self.base}/{TABELA_BOLIDOS}",
            params={"on_conflict": CHAVE_NATURAL},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            data=json.dumps(lote),
        )
        if resposta.status_code not in (200, 201, 204):
            raise RuntimeError(resumir_resposta(resposta))

    def registrar_execucao(self, execucao: Dict[str, Any]) -> None:
        """Insere uma linha em execucoes; lança exceção em caso de falha."""
        resposta = requisitar_com_tentativas(
            self.sessao, "POST", f"{self.base}/{TABELA_EXECUCOES}",
            headers={"Prefer": "return=minimal"},
            data=json.dumps(execucao),
        )
        if resposta.status_code not in (200, 201, 204):
            raise RuntimeError(resumir_resposta(resposta))


# -----------------------------------------------------------------------------
# Execução
# -----------------------------------------------------------------------------
def executar_dry_run(sessao: requests.Session) -> int:
    """Busca e normaliza os dados e mostra um resumo, sem acessar o Supabase."""
    log.info("Modo --dry-run: o Supabase NÃO será acessado.")
    campos, linhas = buscar_api(sessao)
    log.info("Registros recebidos da API: %d", len(linhas))

    registros, invalidas = normalizar(campos, linhas)
    unicos, duplicatas = deduplicar(registros)
    lotes = dividir_em_lotes(unicos, TAMANHO_LOTE)

    log.info("Registros inválidos descartados: %d", invalidas)
    log.info("Duplicatas removidas (%s): %d", CHAVE_NATURAL, duplicatas)
    log.info("Registros prontos para upsert: %d em %d lote(s) de até %d",
             len(unicos), len(lotes), TAMANHO_LOTE)
    log.info("Exemplo de 3 registros normalizados:")
    for registro in unicos[:3]:
        print(json.dumps(registro, ensure_ascii=False, indent=2))
    return 0


def executar(sessao: requests.Session) -> int:
    """Pipeline completo: coleta, normaliza, grava em lotes e registra a execução."""
    iniciado_em = agora_utc_iso()

    # Sem credenciais não há como gravar nem registrar a execução.
    url = os.environ.get("SUPABASE_URL", "").strip()
    chave = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not url or not chave:
        log.error("ERRO CRÍTICO: variáveis de ambiente SUPABASE_URL e/ou "
                  "SUPABASE_SERVICE_KEY ausentes. Execução não registrada.")
        return 1

    cliente = ClienteSupabase(url, chave, sessao)
    registros_processados = 0
    numero_lotes = 0
    quantidade_erros = 0
    mensagens: List[str] = []

    try:
        campos, linhas = buscar_api(sessao)
        log.info("Registros recebidos da API: %d", len(linhas))

        registros, invalidas = normalizar(campos, linhas)
        unicos, duplicatas = deduplicar(registros)
        quantidade_erros += invalidas
        if invalidas:
            mensagens.append(f"{invalidas} registro(s) inválido(s) descartado(s)")
        log.info("Inválidos descartados: %d | duplicatas removidas: %d | para upsert: %d",
                 invalidas, duplicatas, len(unicos))
        if not unicos:
            raise ErroCritico("Nenhum registro válido após a normalização.")

        lotes = dividir_em_lotes(unicos, TAMANHO_LOTE)
        numero_lotes = len(lotes)
        lotes_ok = 0
        for indice, lote in enumerate(lotes, start=1):
            try:
                cliente.upsert_lote(lote)
                lotes_ok += 1
                registros_processados += len(lote)
                log.info("Lote %d/%d enviado (%d registros).", indice, numero_lotes, len(lote))
            except Exception as erro:  # um lote com falha não interrompe os demais
                quantidade_erros += 1
                mensagens.append(f"lote {indice}: {erro}")
                log.error("Lote %d/%d falhou: %s", indice, numero_lotes, erro)

        if lotes_ok == 0:
            status = "erro_critico"
            mensagens.insert(0, "nenhum lote foi gravado")
        elif lotes_ok < numero_lotes or invalidas:
            status = "erro_parcial"
        else:
            status = "concluido"

    except ErroCritico as erro:
        status = "erro_critico"
        quantidade_erros += 1
        mensagens.append(str(erro))
        log.error("ERRO CRÍTICO: %s", erro)

    resumo = (f"{registros_processados} registro(s) gravado(s) em "
              f"{numero_lotes} lote(s); {quantidade_erros} erro(s)")
    mensagem = resumo + (" | " + " | ".join(mensagens) if mensagens else "")

    execucao = {
        "iniciado_em": iniciado_em,
        "finalizado_em": agora_utc_iso(),
        "registros_processados": registros_processados,
        "numero_lotes": numero_lotes,
        "quantidade_erros": quantidade_erros,
        "status": status,
        "mensagem": mensagem[:2000],
    }

    registro_ok = True
    try:
        cliente.registrar_execucao(execucao)
        log.info("Execução registrada em %s.", TABELA_EXECUCOES)
    except Exception as erro:
        registro_ok = False
        log.error("Não foi possível registrar a execução em %s: %s", TABELA_EXECUCOES, erro)

    log.info("Resultado final: %s — %s", status.upper(), mensagem)
    return 0 if status == "concluido" and registro_ok else 1


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

    with requests.Session() as sessao:
        if args.dry_run:
            try:
                codigo = executar_dry_run(sessao)
            except ErroCritico as erro:
                log.error("ERRO CRÍTICO: %s", erro)
                codigo = 1
        else:
            codigo = executar(sessao)

    sys.exit(codigo)


if __name__ == "__main__":
    main()
