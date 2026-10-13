# Histórico de Interação com IA

> Preencha este arquivo ao longo do desenvolvimento do projeto.
> Registre TODOS os prompts utilizados — mesmo os que não funcionaram.
> Este documento é parte obrigatória da avaliação.

\---

## Informações gerais

| Campo                  | Valor                                      |
| ---------------------- | ------------------------------------------ |
| **Grupo**              | \[Grupo 7 - SSD/CNEOS Fireball]            |
| **Integrantes**        | \[Lucas Hein], \[João Miranda], \[Marcelo] |
| **API NASA escolhida** | \[SSD/CNEOS Fireball]                      |
| **IA utilizada**       | \[Claude]                                  |
| **Data de início**     | 30-09-2026                                 |
| **Data de conclusão**  | DD-MM-AAAA                                 |

\---

## Interação 1 — \[Refinamento do setup.sql]

**Data:** 13-10-2026  
**Objetivo:** O objetivo do prompt era revisar e refinar o `sql/setup.sql` criado anteriormente, validando a estrutura contra os dados reais da API e garantindo que todos os requisitos da atividade (UNIQUE, RLS, GRANTs e tabela `execucoes`) fossem atendidos.

**Prompt enviado à IA:**

```
Contexto: estou fazendo um trabalho em grupo (Grupo 07). O projeto é um pipeline de
dados que coleta dados da API SSD/CNEOS Fireball da NASA/JPL
(https://ssd-api.jpl.nasa.gov/fireball.api, não exige chave), roda automaticamente
pelo GitHub Actions, grava num banco PostgreSQL no Supabase e mostra os dados num
painel HTML no GitHub Pages. O projeto no Supabase se chama SSD-CNEOS-Fireball-DB e
já está criado (região São Paulo). Este repositório é o SSD-CNEOS-Fireball.

Tarefa: revisar e refinar o arquivo sql/setup.sql que já existe. Não crie nem altere
nenhum outro arquivo.

1. Valide contra os dados reais. Baixe a base completa da API
   (curl "https://ssd-api.jpl.nasa.gov/fireball.api") e verifique:
   - quais campos podem vir nulos, e se as colunas NOT NULL estão corretas;
   - se a chave natural escolhida para o UNIQUE é realmente única em toda a base
     (conte possíveis duplicatas). Se não for, proponha outra e justifique;
   - se os tipos e a precisão das colunas comportam os valores reais;
   - se as faixas das CHECK constraints (latitude, longitude, valores positivos)
     não rejeitam nenhum registro real.

2. Confira se os requisitos obrigatórios estão todos atendidos:
   - tabela principal com os dados da API + tabela execucoes (log do pipeline) com,
     no mínimo, registros processados, lotes, erros e status restrito a
     'concluido', 'erro_parcial' ou 'erro_critico';
   - constraint UNIQUE na chave natural, para permitir upsert sem duplicatas
     (o pipeline vai usar on_conflict nessa coluna);
   - RLS ativo em TODAS as tabelas, com política de leitura pública (SELECT) para
     anon e authenticated, e nenhuma política de escrita para eles;
   - GRANTs explícitos: SELECT para anon e authenticated; ALL para service_role,
     incluindo as sequences.

3. Pense no uso futuro:
   - o painel vai filtrar e ordenar por data, energia de impacto e região
     (latitude/longitude), e vai mostrar a última execução da tabela execucoes.
     Crie apenas os índices que realmente ajudam nessas consultas;
   - o script deve continuar idempotente (posso rodar várias vezes sem erro);
   - nenhuma chave, senha ou URL do projeto pode aparecer no arquivo.

4. Mantenha os comentários em português explicando cada bloco.

Ao final, responda com:
- uma lista curta do que você mudou e por quê;
- o que você verificou e estava correto (sem mudança);
- o resultado da checagem de duplicatas da chave natural;
- se alguma mudança exige apagar e recriar as tabelas no Supabase (ou se basta
  rodar o arquivo de novo no SQL Editor).
```

**Resumo da resposta:**
A IA baixou a base completa da API (1074 registros, de 1988 a 2026) e ajustou o script com base nos dados reais:

- Tabela renomeada para `bolidos`, com colunas em português e unidades no nome.
- NOT NULL apenas em data e energias. Localização, altitude e velocidade ficaram opcionais, pois vêm nulas em muitos registros.
- Tipos `numeric` dimensionados pelos maiores valores reais, além de CHECKs de faixa e sinal.
- Chave natural `data_hora_utc` confirmada sem duplicatas e mantida no UNIQUE.
- Trigger para atualizar `atualizado_em` no upsert e índices voltados aos filtros do painel.
- Segurança reforçada com `REVOKE ALL` antes dos GRANTs, e comentários em todas as colunas.


**O que funcionou:**
- A validação contra os dados reais foi a parte mais útil: a IA trocou suposições por números da base (quantidade de nulos, maiores valores, ausência de duplicatas na chave).
- A estrutura final atende todos os requisitos da atividade: tabela principal + `execucoes`, UNIQUE na chave natural, RLS nas duas tabelas com leitura pública e GRANTs explícitos.
- O script continua idempotente e não contém chaves, senhas nem URLs.


**O que precisou ajuste:**
Rodou de primeira, não precisou de ajuste.
\---

##

## Interação 2 — \[Título]

**Data:** DD-MM-AAAA  
**Objetivo:** ...

**Prompt enviado à IA:**

```
...
```

**Resumo da resposta:**
...

**O que funcionou:**
...

**O que precisou ajuste:**
...

\---

<!-- Repita o bloco acima para cada interação com a IA -->

\---

## Resumo final

**Total de interações:** X

**Principais contribuições da IA:**

- ...
- ...

**Principais limitações encontradas:**

- ...
- ...

**Avaliação geral do uso da IA:**
Em até 10 linhas, descreva como a IA ajudou (ou atrapalhou) o desenvolvimento do projeto.
