# Histórico de Interação com IA

> Preencha este arquivo ao longo do desenvolvimento do projeto.
> Registre TODOS os prompts utilizados — mesmo os que não funcionaram.
> Este documento é parte obrigatória da avaliação.

---

## Informações gerais

| Campo                  | Valor                                      |
| ---------------------- | ------------------------------------------ |
| **Grupo**              | \[Grupo 7 - SSD/CNEOS Fireball]            |
| **Integrantes**        | \[Lucas Hein], \[João Miranda], \[Marcelo] |
| **API NASA escolhida** | \[SSD/CNEOS Fireball]                      |
| **IA utilizada**       | \[Claude]                                  |
| **Data de início**     | 30-09-2026                                 |
| **Data de conclusão**  | DD-MM-AAAA                                 |

---

## Interação 1 — Criação do setup.sql

**Data:** 12-10-2026  
**Objetivo:** Criar a primeira versão do `sql/setup.sql` com a tabela principal, a tabela `execucoes`, a constraint UNIQUE, o RLS e os GRANTs exigidos pela atividade.

**Prompt enviado à IA:**

```
Contexto: estou fazendo um trabalho em grupo (Grupo 07). O projeto é um
pipeline de dados que coleta dados da API SSD/CNEOS Fireball da NASA/JPL
(https://ssd-api.jpl.nasa.gov/fireball.api, não exige chave), roda automaticamente
pelo GitHub Actions, grava num banco PostgreSQL no Supabase e mostra os dados num
painel HTML no GitHub Pages. O projeto no Supabase se chama SSD-CNEOS-Fireball-DB e
já está criado (região São Paulo). Este repositório é o SSD-CNEOS-Fireball.

Tarefa agora: criar SOMENTE o arquivo sql/setup.sql, que vou executar no SQL Editor do
Supabase. Ainda não crie o script Python, o workflow nem o painel.

Antes de escrever o SQL, consulte a API (ex.: curl "https://ssd-api.jpl.nasa.gov/fireball.api?limit=5")
para confirmar quais campos ela retorna, os tipos e quais podem vir nulos.

Requisitos obrigatórios do professor para o setup.sql:
1. Uma tabela principal com os dados da API (bólidos), com nomes de colunas em português
   e tipos adequados. Latitude e longitude vêm na API como valor + direção (N/S, E/W);
   quero guardar em graus com sinal (Sul e Oeste negativos). A data vem em UTC.
2. Uma tabela chamada execucoes, que é o log de cada execução do pipeline, com no mínimo:
   registros processados, número de lotes, quantidade de erros e status. O status só pode
   ser 'concluido', 'erro_parcial' ou 'erro_critico'. Inclua também datas de início/fim
   e uma mensagem.
3. Uma constraint UNIQUE na tabela principal baseada na chave natural do registro, para
   o pipeline poder fazer upsert sem duplicatas. Escolha a chave natural e justifique.
4. Row Level Security (RLS) ativo em TODAS as tabelas, com política de leitura pública
   (SELECT) para os papéis anon e authenticated. Ninguém além do service_role pode escrever.
5. GRANTs explícitos: SELECT para anon e authenticated; ALL para service_role
   (incluindo as sequences).
6. O script deve poder ser executado mais de uma vez sem erro (create if not exists,
   drop policy if exists etc.).
7. Comente o arquivo em português explicando cada bloco.

A tabela será lida pela API REST automática do Supabase usando a publishable key (anon),
e escrita pelo pipeline usando a secret key (service_role). Não coloque nenhuma chave
ou senha no arquivo.

Ao final, me explique em poucas linhas: a chave natural escolhida, os tipos de coluna e
como a segurança (RLS + GRANTs) funciona, porque preciso documentar isso.
```

**Resumo da resposta:**
Recebemos o `sql/setup.sql` com a tabela dos bólidos, a tabela `execucoes`, UNIQUE na data/hora do evento, RLS com leitura pública e GRANTs explícitos, além de uma explicação sobre a chave natural e a segurança.

**O que funcionou:**
- Pedimos que a IA consultasse a API antes de escrever, o que evitou colunas inventadas.
- Como listamos os requisitos no prompt, UNIQUE, RLS e GRANTs vieram desde a primeira versão.
- A explicação final nos ajudou a entender a segurança do banco.

**O que precisou ajuste:**
- A validação usou só 5 registros. Para ter certeza sobre nulos, tipos e duplicatas, pedimos um refinamento com a base completa (Interação 2).

---

## Interação 2 — Refinamento do setup.sql

**Data:** 13-10-2026  
**Objetivo:** Refinar o `sql/setup.sql` validando a estrutura contra os dados reais da API e conferindo todos os requisitos da atividade.

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
Com a base completa (1074 registros, de 1988 a 2026), a IA ajustou o script: tabela renomeada para `bolidos`, NOT NULL só em data e energias, tipos `numeric` dimensionados pelos valores reais, CHECKs de faixa, chave `data_hora_utc` confirmada sem duplicatas, trigger de `atualizado_em`, índices para o painel e `REVOKE ALL` antes dos GRANTs.

**O que funcionou:**
- A validação com dados reais trocou suposições por números (nulos, maiores valores, ausência de duplicatas).
- O script atende todos os requisitos, continua idempotente e não tem chaves nem URLs.

**O que precisou ajuste:**
- Nenhum: rodamos o script no SQL Editor e funcionou de primeira.
- Anotamos para a etapa seguinte que `vx`, `vy` e `vz` só vêm com `vel-comp=true`.

---

## Interação 3 — Criação do pipeline e do workflow

**Data:** 13-10-2026  
**Objetivo:** Criar o `scripts/fetch_nasa.py` e o `.github/workflows/update-data.yml`, com deduplicação, lotes, registro em `execucoes` e as boas práticas obrigatórias do workflow.

**Prompt enviado à IA:**

```
Contexto: projeto em grupo (Grupo 07). Pipeline de dados que coleta a API SSD/CNEOS
Fireball da NASA/JPL (https://ssd-api.jpl.nasa.gov/fireball.api, não exige chave),
roda pelo GitHub Actions, grava no Supabase (PostgreSQL) e depois será exibido num
painel no GitHub Pages. O banco já foi criado com o arquivo sql/setup.sql deste
repositório: leia esse arquivo antes de começar para usar exatamente os nomes das
tabelas e colunas (tabela principal bolidos e tabela de log execucoes).

Tarefa: criar dois arquivos.

ARQUIVO 1: scripts/fetch_nasa.py
1. Consultar a API com o parâmetro vel-comp=true (senão vx/vy/vz não vêm).
   Usar timeout nas requisições e algumas tentativas em caso de falha de rede.
2. Normalizar os campos para as colunas da tabela bolidos:
   - "date" vem em UTC no formato "YYYY-MM-DD hh:mm:ss": enviar em ISO 8601 com fuso
     explícito (ex.: "...Z");
   - latitude/longitude vêm como valor + direção (lat-dir N/S, lon-dir E/W):
     converter para graus com sinal (Sul e Oeste negativos);
   - valores numéricos vêm como texto e podem vir nulos: converter para número ou None.
   - Não enviar as colunas id, coletado_em e atualizado_em (o banco preenche).
3. Fazer deduplicação pela chave natural (data_hora_utc) ANTES do upsert, para evitar
   o erro PostgreSQL 21000 ("ON CONFLICT DO UPDATE command cannot affect row a second
   time").
4. Enviar ao Supabase em lotes (ex.: 500 registros) via API REST do Supabase
   (PostgREST), com upsert usando on_conflict=data_hora_utc e
   Prefer: resolution=merge-duplicates.
5. Registrar cada execução na tabela execucoes com: iniciado_em, finalizado_em,
   registros_processados, numero_lotes, quantidade_erros, status e mensagem.
   Regras de status:
   - concluido: todos os lotes enviados sem erro;
   - erro_parcial: pelo menos um lote falhou, mas outros foram gravados;
   - erro_critico: falha que impede a coleta (API fora, resposta inválida, nenhum
     lote gravado, variáveis de ambiente ausentes).
   Em erro_parcial ou erro_critico, o script deve terminar com sys.exit(1) para o
   workflow ficar vermelho no Actions. Se possível, registrar em execucoes mesmo em
   erro crítico.
6. Ler as credenciais SOMENTE das variáveis de ambiente SUPABASE_URL e
   SUPABASE_SERVICE_KEY. Nunca imprimir a chave nos logs.
7. Ter uma opção --dry-run que busca e normaliza os dados e mostra um resumo
   (quantidade, duplicatas removidas, exemplo de 3 registros) SEM acessar o Supabase.
   Assim consigo testar localmente sem usar a chave secreta.
8. Logs claros em português (início, quantidade recebida, lotes, resultado final).
9. Usar só bibliotecas simples (ex.: requests) e criar um requirements.txt.

ARQUIVO 2: .github/workflows/update-data.yml
- Agendamento diário com cron (escolha um minuto que não seja 0) e execução manual
  com workflow_dispatch.
- Obrigatório: permissions: contents: read, concurrency (sem execuções simultâneas)
  e timeout-minutes.
- Instalar Python, instalar o requirements.txt e rodar scripts/fetch_nasa.py,
  passando os secrets SUPABASE_URL e SUPABASE_SERVICE_KEY como variáveis de ambiente.

Ao final:
- rode o script com --dry-run para mostrar que a coleta e a normalização funcionam;
- NÃO rode o script sem --dry-run (a chave secreta não está nesta máquina);
- explique em poucas linhas como funcionam a deduplicação, os lotes e as regras de
  status, porque preciso documentar isso.
```

**Resumo da resposta:**
Recebemos o script, o `requirements.txt` e o workflow (diário às 06:17 UTC e manual, com `permissions`, `concurrency` e `timeout-minutes`). O script normaliza, deduplica, envia em lotes de 500 com upsert e registra em `execucoes`. O `--dry-run` retornou 1074 registros em 3 lotes.

**O que funcionou:**
- O `--dry-run` nos deixou testar sem expor a secret key.
- Depois de cadastrarmos os secrets e rodarmos o workflow, ele ficou verde e o Supabase recebeu os 1074 registros com status `concluido`.

**O que precisou ajuste:**
- Esta versão tinha uma falha grave que não percebemos nos testes: a secret key era enviada também para a API da NASA. Só descobrimos na revisão de segurança (Interação 6).

---

## Interação 4 — Criação do painel

**Data:** 13-10-2026  
**Objetivo:** Criar o painel que consome a API REST do Supabase, com visualização, filtros, última atualização e `escapeHtml()`.

**Prompt enviado à IA:**

```
Contexto: projeto em grupo (Grupo 07). Pipeline que coleta a API SSD/CNEOS Fireball
da NASA/JPL, grava no Supabase e será exibido num painel no GitHub Pages. O banco já
existe (veja sql/setup.sql para os nomes exatos das tabelas e colunas: bolidos e
execucoes) e já tem dados reais gravados pelo scripts/fetch_nasa.py.

Tarefa: criar o arquivo index.html na raiz do repositório (será publicado no GitHub
Pages, branch main, pasta root). Não altere outros arquivos.

Requisitos obrigatórios:
1. Consumir a API REST do Supabase (PostgREST) com fetch, usando apenas a URL do
   projeto e a publishable key (anon). Deixe as duas como constantes no topo do
   script, com valores de exemplo para eu preencher. NUNCA usar a secret key.
2. A tabela bolidos tem mais de 1000 registros e o Supabase limita 1000 linhas por
   requisição: faça paginação (Range/offset) para carregar todos.
3. Visualização compreensível dos dados:
   - um mapa-múndi com os bólidos que têm localização (Leaflet via CDN), com o tamanho
     ou cor do marcador proporcional à energia de impacto e um popup com os dados;
   - cards com números-resumo (total de eventos, maior energia de impacto, evento
     mais recente);
   - uma tabela com os eventos, ordenável por data e energia;
   - opcional: um gráfico de eventos por ano (Chart.js via CDN).
4. Pelo menos um filtro interativo: intervalo de anos, energia de impacto mínima e
   hemisfério (Norte/Sul/todos). Os filtros devem atualizar mapa, cards e tabela.
5. Mostrar a data/hora da última atualização do pipeline, lida da tabela execucoes
   (última execução, com o status), convertida para o horário de Brasília.
6. Criar uma função escapeHtml() e aplicá-la a TODO valor vindo da API antes de
   inserir no HTML (inclusive nos popups do mapa).
7. Tratar campos nulos (mostrar "—") e erros de carregamento com mensagem amigável.
8. Arquivo único (HTML + CSS + JS), em português, responsivo (funcionar no celular),
   com título e uma breve explicação do que é um bólido e da fonte dos dados.

Ao final, explique em poucas linhas como funcionam a paginação, os filtros e o
escapeHtml(), porque preciso documentar isso.
```

**Resumo da resposta:**
Recebemos o painel com mapa Leaflet, cards, gráfico por ano, tabela ordenável, filtros (anos, energia mínima e hemisfério), card de última atualização, paginação de 1000 em 1000 e `escapeHtml()` em todos os valores externos.

**O que funcionou:**
- O painel carregou os 1074 registros (888 no mapa), contornando o limite de 1000 linhas.
- Os filtros atualizam tudo ao mesmo tempo, e só a publishable key é usada no navegador.

**O que precisou ajuste:**
- A IA ignorou dois pontos do prompt: dividiu o painel em três arquivos e os colocou numa pasta `painel/`, quando a atividade exige o `index.html` na raiz. Identificamos e ajustamos a publicação.
- Preenchemos manualmente a URL do projeto e a publishable key no `script.js`.

---

## Interação 5 — Estilização do topo do painel

**Data:** 13-10-2026  
**Objetivo:** Melhorar o visual do bloco de apresentação e do card de última atualização, alterando apenas o front-end.

**Prompt enviado à IA:**

```
Quero que você deixe mais estilizado e visualmente melhor está escrita no site, mude apenas o front, não altere nada no back.
...
Bólidos registrados pelo CNEOS
Um bólido (em inglês, fireball) é um meteoro excepcionalmente brilhante: um fragmento de asteroide que entra na atmosfera e se desintegra liberando muita energia, às vezes equivalente a quilotons de TNT. Os dados vêm da Fireball API do CNEOS (NASA/JPL), coletados diariamente por um pipeline no GitHub Actions e armazenados no Supabase.

Esse é o outro bloco que quero que estilize melhor tmb

Última atualização do pipeline: 13/10/2026, 15:46 (horário de Brasília)
Concluído
1.074 registros processados
```

**Resumo da resposta:**
O bloco de apresentação virou um quadro em degradê com rastro de meteoro e o fluxo "De onde vêm os dados" (API → Actions → Supabase → Painel). O card de última atualização ganhou data em destaque e cor por status (verde, amarelo ou vermelho). No `script.js`, só a função `mostrarUltimaExecucao()` mudou, mantendo o `escapeHtml()`.

**O que funcionou:**
- O visual ficou coerente com o tema de meteoros, no desktop e no celular.
- A IA mexeu só no front e preservou as alterações que tínhamos feito no `index.html`.
- O fluxo "De onde vêm os dados" vai nos ajudar a explicar a arquitetura no seminário.

**O que precisou ajuste:**
- Nenhum. Percebemos, porém, que prompts com restrições claras dão resultados mais previsíveis do que um pedido informal, e passamos a escrevê-los assim.

---

## Interação 6 — Revisão do pipeline Python

**Data:** 11-11-2026  
**Objetivo:** Revisar o `fetch_nasa.py` e o `requirements.txt` quanto a erros, deduplicação, status, vazamento da chave e legibilidade, sem alterar banco nem workflow.

**Prompt enviado à IA:**

```
Revise todo o scripts/fetch_nasa.py (e o requirements.txt). Não mude a estrutura do
banco nem o workflow. Verifique e corrija se necessário:
- tratamento de erros e timeouts nas requisições;
- deduplicação pela chave data_hora_utc antes do upsert (evitar erro PostgreSQL 21000);
- regras de status (concluido, erro_parcial, erro_critico) e sys.exit(1) em falhas;
- registro na tabela execucoes mesmo em erro;
- se a chave secreta pode aparecer em algum log ou mensagem de erro;
- legibilidade: nomes, funções pequenas, docstrings e comentários em português.
Rode com --dry-run para confirmar que continua funcionando. No final, liste o que
mudou e por quê, e o que já estava correto.
```

**Resumo da resposta:**
A IA encontrou uma falha grave: a consulta à NASA e o envio ao Supabase usavam a mesma conexão, e a secret key ia para `ssd-api.jpl.nasa.gov` em toda execução. Ela comprovou o vazamento na versão antiga e corrigiu com conexões separadas e a chave mascarada (`***`) nos logs e em `execucoes`. Também melhorou timeouts, validação antes do envio, registro de erros inesperados e legibilidade, e atualizou o `requests` por causa da CVE-2024-47081. Os testes com servidores falsos cobriram 7 cenários, todos com o status esperado.

**O que funcionou:**
- A revisão encontrou um vazamento real que não tínhamos percebido.
- Os testes validaram todos os status sem usar a chave nem o banco real.

**O que precisou ajuste:**
- **Erro da própria IA:** foi ela que gerou a versão com o vazamento (Interação 3). Aprendemos que código de IA precisa de revisão de segurança mesmo quando funciona.
- [Geramos uma nova secret key no Supabase, revogamos a antiga e atualizamos o secret `SUPABASE_SERVICE_KEY` no GitHub em DD-MM-2026.]
- A correção ficou só na nossa máquina até a auditoria da Interação 10.

---

## Interação 7 — Fundo imersivo de céu noturno

**Data:** 11-11-2026  
**Objetivo:** Deixar o painel mais imersivo, com céu noturno, estrelas e meteoros em CSS, sem prejudicar a legibilidade nem a lógica de dados.

**Prompt enviado à IA:**

```
Melhore o layout geral do painel com um visual imersivo de céu noturno e meteoros:
fundo escuro em degradê (azul-noite para preto), estrelas discretas e alguns rastros
de meteoro animados em CSS. Altere apenas HTML/CSS (e JS só se for para a animação).
Regras:
- o conteúdo (mapa, cards, tabela, filtros) deve continuar legível, com bom contraste;
- respeite prefers-reduced-motion (desligar animações para quem prefere);
- animações leves, sem pesar no celular;
- não altere a lógica de carregamento dos dados, a paginação nem o escapeHtml().
Teste no desktop e no celular e me diga o que mudou.
```

**Resumo da resposta:**
A IA alterou só HTML e CSS: céu em degradê com estrelas cintilantes, quatro meteoros animados (dois no celular), paleta sempre escura com painéis translúcidos, mapa escuro e suporte a `prefers-reduced-motion`.

**O que funcionou:**
- O painel ficou imersivo e legível, sem mudanças na lógica de dados.
- As animações usam só `transform` e `opacity`, leves no celular.

**O que precisou ajuste:**
- A IA teve falhas ao gravar o CSS e ao subir o servidor de testes, e corrigiu as duas.
- A tarefa foi interrompida antes de verificar as animações, então conferimos no navegador.
- O tema claro foi removido; mantivemos assim por combinar com o céu noturno.

---

## Interação 8 — README do repositório

**Data:** 12-11-2026  
**Objetivo:** Ter apoio da IA na redação do README.md, garantindo que o texto batesse com o que implementamos.

**Prompt enviado à IA:**

```
Crie o README.md do repositório, em português, com:
- título e descrição da API SSD/CNEOS Fireball (o que é um bólido, o que a API fornece,
  campos principais e unidades);
- arquitetura: fluxo GitHub Actions → fetch_nasa.py → Supabase (PostgreSQL) →
  GitHub Pages, com um diagrama simples em texto ou Mermaid;
- modelagem: tabelas bolidos e execucoes, chave natural data_hora_utc e por que o
  UNIQUE permite upsert sem duplicatas;
- segurança: RLS, GRANTs, publishable key vs secret key, escapeHtml();
- como configurar do zero (Supabase, setup.sql, secrets no GitHub, Pages, rodar o
  workflow manualmente);
- links: painel https://sn-2026-grupo-07-nasa.github.io/SSD-CNEOS-Fireball/ e
  repositório https://github.com/SN-2026-GRUPO-07-NASA/SSD-CNEOS-Fireball;
- seção "Integrantes e responsabilidades" com:
  - Marcelo, Engenheiro de Dados: pipeline de coleta (scripts/fetch_nasa.py);
  - João Miranda, Arquiteto de Banco e Integração: sql/setup.sql, integração com o
    Supabase e workflow update-data.yml;
  - Lucas Hein, Desenvolvedor Front-end: todo o painel (index.html, style.css, script.js);
  - a documentação (README e pasta docs/) foi feita pelos três em conjunto;
- seção "Uso de IA": usamos o Claude Code no terminal; o histórico está em
  docs/ai-interaction.md e a análise em docs/reflexao.md.
Leia os arquivos do repositório para que tudo bata com o que foi implementado.
Não coloque nenhuma chave no README.
```

**Resumo da resposta:**
A partir da estrutura e dos tópicos que definimos, a IA leu os arquivos do projeto e montou o rascunho do README: campos da API, diagrama Mermaid, modelagem, upsert e erro 21000, segurança, configuração, links e integrantes.

**O que funcionou:**
- Basear o texto nos arquivos reais evitou divergências com o código.
- O roteiro do prompt garantiu todos os itens exigidos, sem chaves nem URLs do projeto.

**O que precisou ajuste:**
- A IA alertou que os links para `docs/` quebrariam se os arquivos não existissem; criamos os dois arquivos.
- Revisamos o texto antes da entrega.

---

## Interação 9 — Tutorial de replicação

**Data:** 12-11-2026  
**Objetivo:** Ter apoio da IA na redação do tutorial (`docs/tutorial.pdf`) para alguém de fora replicar o projeto.

**Prompt enviado à IA:**

```
Crie docs/tutorial.md, um guia em português para uma pessoa de fora replicar este
projeto do zero, que depois vou converter em PDF de 5 a 15 páginas. Inclua: pré-requisitos
(contas GitHub e Supabase, Python, git); criação da organização e do repositório;
criação do projeto no Supabase e execução do sql/setup.sql; onde pegar a URL e as
chaves e como cadastrar os secrets SUPABASE_URL e SUPABASE_SERVICE_KEY no GitHub;
explicação do fetch_nasa.py (coleta, normalização, deduplicação, lotes, status);
explicação do workflow; como rodar o --dry-run localmente; como ativar o GitHub Pages
e configurar a publishable key no painel; como verificar se deu certo (workflow verde,
Table Editor, URL da API REST); e uma seção de problemas comuns e soluções (incluindo
o erro 21000 e o limite de 1000 linhas). Indique com [PRINT: descrição] os lugares onde
devo inserir capturas de tela. Baseie-se nos arquivos reais do repositório.
```

**Resumo da resposta:**
Seguindo o roteiro que definimos, a IA preparou um rascunho com 11 seções, 13 problemas comuns com solução e 17 marcações `[PRINT]` para inserirmos as capturas.

**O que funcionou:**
- O roteiro do prompt deu ao tutorial a sequência certa para replicar o projeto.
- As marcações de print deixaram claro onde inserir cada evidência.

**O que precisou ajuste:**
- O rascunho trazia um JSON fictício, trocado por um registro real da API.
- A IA alertou que os menus do Supabase mudam e que os números dos logs precisavam ser conferidos.
- Ficaram conosco as capturas, a conferência, a revisão final e a conversão para PDF.

---

## Interação 10 — Auditoria de segurança e bugs

**Data:** 12-11-2026  
**Objetivo:** Revisar banco, back-end, workflow e front-end em busca de vulnerabilidades e bugs antes da entrega.

**Prompt enviado à IA:**

```
Busque dentro do projeto se há alguma vulnerabilidade, algum erro, bug no banco de dados,
back-end, workflow e front-end, ou alerta que eu possa revisar.
```

**Resumo da resposta:**
A IA revisou os quatro componentes e testou a produção só com a publishable key. O achado mais grave: o GitHub ainda rodava o script antigo, com o vazamento, porque não tínhamos enviado a correção. Ela também apontou a falta de `.gitignore`, a necessidade de trocar a chave e problemas de gravidade média e baixa (trigger atualizando tudo, KeyError, workflow desativado após 60 dias, falta de CSP, entre outros).

**O que funcionou:**
- Descobrimos que a correção do vazamento ainda não estava em produção.
- A IA confirmou que o RLS bloqueia gravação com a publishable key (HTTP 401) e que não há secret key nos arquivos.
- A classificação por gravidade nos ajudou a priorizar.

**O que precisou ajuste:**
- [Fizemos commit e push da versão corrigida, criamos o `.gitignore` e trocamos a secret key em DD-MM-2026.]
- [Aplicamos as correções X, Y e Z / deixamos os itens de média e baixa gravidade como melhorias futuras.]
- [Rodamos o workflow de novo: verde e com a mensagem no formato novo.]

---

## Interação 11 — Visão 3D do globo com chuva de meteoros

**Data:** 12-11-2026  
**Objetivo:** Adicionar uma alternância entre o mapa 2D e um globo 3D, onde os bólidos filtrados caem como chuva de meteoros na localização exata. Só front-end, identificado no site e no código como feito com auxílio de IA.

**Prompts enviados à IA:**

```
Contexto: projeto em grupo (Grupo 07). Painel no GitHub Pages que mostra bólidos
(fireballs) da API SSD/CNEOS Fireball da NASA/JPL, lidos do Supabase. O painel já tem
mapa 2D (Leaflet), cards, tabela, filtros (anos, energia mínima, hemisfério), card de
última atualização e visual de céu noturno. Leia index.html, style.css e script.js
antes de começar.

Tarefa: adicionar uma VISÃO 3D ao campo do mapa. Somente front-end: não altere o
banco, o pipeline, o workflow, a consulta ao Supabase, a paginação nem a lógica dos
filtros existentes.

1. Alternância 2D / 3D
   - No canto do campo do mapa, um controle segmentado "2D | 3D". O 2D (Leaflet atual)
     continua sendo o padrão e deve funcionar exatamente como hoje.
   - Ao escolher 3D, o mapa 2D é escondido e no mesmo espaço aparece um globo
     terrestre 3D que o usuário pode girar e dar zoom com mouse e toque.
   - Carregue as bibliotecas 3D SOMENTE quando o usuário clicar em 3D (lazy load),
     para não deixar o painel mais pesado para quem não usa. Use globe.gl (ou
     Three.js) por CDN permitido (cdnjs, jsdelivr ou unpkg), com versão fixa e SRI
     quando possível. Confira se as texturas da Terra usadas existem e carregam.

2. Bólidos no globo
   - Mostre só os eventos que têm latitude e longitude, respeitando os filtros atuais
     (anos, energia mínima, hemisfério). Ao mudar um filtro, o globo atualiza.
   - Cada bólido aparece como um meteoro 3D caindo do espaço até a localização exata
     (latitude/longitude do banco), com rastro brilhante, e deixa um ponto/brilho no
     local do impacto.
   - Cor e tamanho pela energia de impacto (kt), usando a mesma escala de cores do
     mapa 2D, com legenda.
   - Ao passar o mouse ou tocar num ponto de impacto, mostrar data, energia de
     impacto, energia irradiada, altitude e velocidade (nulos como "—"). Todo valor
     vindo do banco deve passar pelo escapeHtml() existente antes de ir para o HTML.

3. Chuva de meteoros
   - Ao selecionar um intervalo de anos (ex.: só 2026), os meteoros daquele período
     caem em sequência, como uma chuva, ao longo de alguns segundos, e não todos de
     uma vez.
   - Botão "Reproduzir chuva" para repetir a animação.
   - Limite quantos meteoros animam ao mesmo tempo para não travar; com muitos
     eventos, acelere a sequência em vez de animar centenas juntos.

4. Desempenho, acessibilidade e celular
   - Com prefers-reduced-motion, não animar a queda: mostrar os pontos de impacto
     direto no globo.
   - No celular, menos efeitos (rastros mais simples, menos meteoros simultâneos) e
     globo cabendo na largura da tela.
   - Se o navegador não suportar WebGL ou a biblioteca não carregar, mostrar uma
     mensagem amigável e voltar para o 2D automaticamente.
   - Ao voltar para 2D, pausar a animação do globo (não deixar rodando escondido).
   - Visual coerente com o tema de céu noturno do painel.

5. Transparência sobre o uso de IA
   - Junto ao controle 2D/3D, um selo discreto e visível: "Visão 3D desenvolvida com
     auxílio de IA (Claude Code)".
   - No código, marque o início e o fim de todo trecho novo com o comentário
     "Visão 3D gerada com auxílio de IA (Claude Code)".

Ao final:
- teste no desktop e na largura de celular, com os dados reais (publishable key já
  está no script.js), incluindo o fallback sem WebGL;
- confirme que o 2D, os filtros, a tabela e os cards continuam funcionando;
- liste os arquivos alterados, as bibliotecas e versões usadas, e explique em poucas
  linhas como funciona o lazy load, a animação da chuva e a conversão de
  latitude/longitude para posição no globo, porque preciso documentar isso.
- Não faça commit.
```

```
Deixe o planeta terra de dia e crie um rastro mais realista com fogo dos bólidos
```

```
Quando eu seleciono apenas 2026 a animação dos meteoros fica bugada, resolva pra mim
```

**Resumo da resposta:**
A IA criou o `globo3d.js` e alterou pouco o restante (só uma linha no `script.js`). A globe.gl 2.46.2 só é baixada no primeiro clique em "3D" (lazy load, com SRI). Os meteoros caem em sequência na latitude/longitude exatas, com a mesma escala de cores do 2D. Nos prompts seguintes, a Terra passou a aparecer de dia e o rastro virou fogo em camadas, com entrada oblíqua. Por fim, a IA corrigiu o bug do filtro 2026: a biblioteca reiniciava os rastros a cada meteoro novo.

**O que funcionou:**
- O 2D, os filtros, os cards e a tabela continuaram idênticos.
- O fallback sem WebGL e o modo "reduzir movimento" funcionaram.
- Conferimos a localização com o bólido de Chelyabinsk (2013), que cai na Rússia.
- O recurso está identificado no site e no código como feito com auxílio de IA.

**O que precisou ajuste:**
- As texturas da globe.gl davam 404; a IA trocou pelas do three-globe.
- A IA corrigiu bugs que os próprios testes acharam (botão de chuva travado e tooltip duplicado) e afinou o desempenho após a Terra de dia e o fogo.
- Encontramos um bug que os testes da IA não pegaram: com só 2026, os rastros voltavam ao topo. Corrigimos com o terceiro prompt.
- Os testes da IA rodaram só no Chrome headless. [Testamos a fluidez num computador e num celular reais.]

---

## Resumo final

**Total de interações:** 11 (13 prompts)

**Principais contribuições da IA:**

- Geração do código das quatro partes do projeto (banco, pipeline, workflow e painel) a partir dos requisitos definidos pelo grupo.
- Validação das decisões do banco com a base real da API (nulos, tipos, ausência de duplicatas na chave natural).
- Testes de todos os cenários de erro do pipeline com servidores falsos, sem expor a secret key nem usar o banco real.
- Revisões e auditoria que encontraram o vazamento da secret key e outros problemas antes da entrega.
- Apoio na redação do README e do tutorial, e recursos visuais do painel, incluindo a visão 3D.

**Principais limitações encontradas:**

- O erro mais grave do projeto foi gerado pela própria IA: a primeira versão do pipeline enviava a secret key para a NASA, e o código funcionava normalmente.
- A IA nem sempre seguiu todos os requisitos do prompt
- A IA não enxerga o ambiente real: a correção do vazamento ficou só na máquina local até a auditoria.
- Os testes da IA não substituem os testes do grupo: o bug da chuva em 2026 só foi percebido pelo grupo.
- A IA às vezes entrega mais complexidade do que o necessário

**Avaliação geral do uso da IA:**
A IA acelerou muito o desenvolvimento e nos ajudou a entender conceitos como upsert, RLS, deduplicação e paginação. Os melhores resultados vieram de prompts com contexto e restrições claras, e de pedidos de validação com dados reais e testes. Ao mesmo tempo, o projeto mostrou que a IA não substitui revisão: o vazamento da secret key passou despercebido enquanto tudo parecia funcionar e só foi encontrado porque nós pedimos uma revisão de segurança. Bugs visuais e requisitos ignorados também foram identificados. Concluímos que a IA é uma ferramenta poderosa para gerar e revisar código, mas a responsabilidade de definir o que construir, testar e garantir a segurança continua sendo de quem desenvolve. A análise completa está em `docs/reflexao.md`.
