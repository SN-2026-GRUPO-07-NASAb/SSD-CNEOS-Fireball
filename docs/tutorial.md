# Tutorial: como replicar o projeto SSD-CNEOS-Fireball do zero

**Grupo 07** · Lucas Hein, João Miranda e Marcelo

Este guia mostra, passo a passo, como montar do zero um pipeline que:

1. coleta todo dia os bólidos (*fireballs*) da API SSD/CNEOS Fireball, da NASA/JPL;
2. grava os dados em um banco PostgreSQL no Supabase;
3. exibe tudo em um painel web publicado no GitHub Pages.

Projeto de referência:

- Painel: https://sn-2026-grupo-07-nasa.github.io/SSD-CNEOS-Fireball/
- Repositório: https://github.com/SN-2026-GRUPO-07-NASA/SSD-CNEOS-Fireball

> **Convenção deste guia:** valores entre maiúsculas, como `SEU-PROJETO`, `SUA_PUBLISHABLE_KEY` e `SUA-ORGANIZACAO`, devem ser trocados pelos seus. Nenhuma chave real aparece neste documento.

---

## Sumário

1. Visão geral da arquitetura
2. Pré-requisitos
3. Organização e repositório no GitHub
4. Projeto no Supabase e execução do `sql/setup.sql`
5. URL, chaves e secrets do GitHub
6. Como funciona o `fetch_nasa.py`
7. Como funciona o workflow
8. Rodando o `--dry-run` localmente
9. GitHub Pages e configuração do painel
10. Como verificar se deu certo
11. Problemas comuns e soluções

---

## 1. Visão geral da arquitetura

```
┌────────────────┐     ┌────────────────┐     ┌──────────────────┐     ┌────────────────┐
│ GitHub Actions │ ──▶ │ fetch_nasa.py  │ ──▶ │ Supabase         │ ──▶ │ Painel         │
│ (cron diário)  │     │ (Python)       │     │ (PostgreSQL)     │     │ (GitHub Pages) │
└────────────────┘     └───────┬────────┘     └──────────────────┘     └────────────────┘
                               │ GET                grava com a          lê com a
                               ▼                    SECRET key           PUBLISHABLE key
                       ┌────────────────┐
                       │ Fireball API   │
                       │ NASA/JPL       │
                       └────────────────┘
```

| Arquivo | Função |
|---|---|
| `.github/workflows/update-data.yml` | Agenda e executa o pipeline todo dia |
| `scripts/fetch_nasa.py` | Coleta, normaliza, deduplica e grava no Supabase |
| `requirements.txt` | Dependência Python (`requests==2.32.5`) |
| `sql/setup.sql` | Cria tabelas, índices, trigger, RLS e permissões |
| `painel/index.html`, `style.css`, `script.js` | Painel web (mapa, gráfico, cards e tabela) |
| `index.html` (raiz) | Redireciona o visitante para `painel/` |

A API da NASA é pública e **não precisa de chave**. As únicas credenciais do projeto são as do Supabase.

---

## 2. Pré-requisitos

| Item | Para quê | Observação |
|---|---|---|
| Conta no **GitHub** | Repositório, Actions e Pages | Plano gratuito basta |
| Conta no **Supabase** | Banco PostgreSQL e API REST | Plano gratuito basta |
| **Git** | Enviar os arquivos ao repositório | `git --version` para conferir |
| **Python 3.9 ou superior** | Rodar o `--dry-run` localmente | O workflow usa 3.12; `python3 --version` para conferir |
| Navegador e editor de texto | Painel e edição dos arquivos | Qualquer um (ex.: VS Code) |

Para conferir as instalações, rode no terminal:

```bash
git --version
python3 --version
```

[PRINT: terminal mostrando as versões do git e do Python]

---

## 3. Organização e repositório no GitHub

### 3.1 Criar a organização (opcional, recomendado para grupos)

1. Acesse https://github.com, clique no **+** no canto superior direito e escolha **New organization**.
2. Escolha o plano **Free**.
3. Dê um nome à organização (no projeto original: `SN-2026-GRUPO-07-NASA`) e informe um e-mail de contato.
4. Na tela seguinte, convide os colegas do grupo pelo usuário do GitHub.

[PRINT: tela "Set up your organization" com o nome preenchido]

> Se for um trabalho individual, pode criar o repositório direto na sua conta pessoal. O resto do guia é igual.

### 3.2 Criar o repositório

1. Dentro da organização, clique em **Repositories → New repository**.
2. Nome: `SSD-CNEOS-Fireball`.
3. Visibilidade: **Public**. No plano gratuito, o GitHub Pages só funciona em repositórios públicos.
4. Marque **Add a README file** e clique em **Create repository**.

[PRINT: formulário "Create a new repository" preenchido]

### 3.3 Clonar e adicionar os arquivos

```bash
git clone https://github.com/SUA-ORGANIZACAO/SSD-CNEOS-Fireball.git
cd SSD-CNEOS-Fireball
```

Copie para dentro dessa pasta os arquivos do projeto, mantendo esta estrutura:

```
SSD-CNEOS-Fireball/
├── .github/workflows/update-data.yml
├── scripts/fetch_nasa.py
├── sql/setup.sql
├── painel/
│   ├── index.html
│   ├── style.css
│   └── script.js
├── index.html
├── requirements.txt
└── README.md
```

Depois envie ao GitHub:

```bash
git add .
git commit -m "Estrutura inicial do pipeline Fireball"
git push origin main
```

> A pasta `.github` começa com ponto e fica oculta em alguns sistemas. Confira se ela foi copiada; sem ela o workflow não existe.

[PRINT: página do repositório no GitHub mostrando as pastas enviadas]

---

## 4. Projeto no Supabase e execução do `sql/setup.sql`

### 4.1 Criar o projeto

1. Acesse https://supabase.com e entre com sua conta (pode usar o login do GitHub).
2. Clique em **New project** e escolha a organização do Supabase.
3. Preencha:
   - **Name:** por exemplo `SSD-CNEOS-Fireball-DB`;
   - **Database Password:** gere uma senha forte e guarde-a em local seguro (ela não é usada pelo pipeline, mas é a senha do banco);
   - **Region:** `South America (São Paulo)`, a mais próxima do Brasil.
4. Clique em **Create new project** e aguarde alguns minutos até o projeto ficar pronto.

[PRINT: formulário de criação do projeto no Supabase, com a senha oculta]

### 4.2 Executar o `setup.sql`

1. No menu lateral, abra **SQL Editor** e clique em **New query**.
2. Cole **todo** o conteúdo de `sql/setup.sql`.
3. Clique em **Run**. A mensagem esperada é *Success. No rows returned*.

[PRINT: SQL Editor com o setup.sql colado e a mensagem de sucesso]

O script é **idempotente**: usa `create table if not exists`, `create index if not exists`, `drop policy if exists` e `create or replace function`. Pode ser executado de novo sem apagar dados.

### 4.3 O que o `setup.sql` cria

**Tabela `bolidos`**: um evento por linha.

| Coluna | Tipo | Origem na API | Regra |
|---|---|---|---|
| `id` | `bigint` identity | gerado pelo banco | chave primária |
| `data_hora_utc` | `timestamptz` | `date` | `not null`, **`unique`** (chave natural) |
| `energia_irradiada_j_e10` | `numeric(12,3)` | `energy` (10¹⁰ J) | `not null`, `>= 0` |
| `energia_impacto_kt` | `numeric(12,3)` | `impact-e` (kt de TNT) | `not null`, `>= 0` |
| `latitude_graus` | `numeric(6,3)` | `lat` + `lat-dir` | entre -90 e 90 |
| `longitude_graus` | `numeric(7,3)` | `lon` + `lon-dir` | entre -180 e 180 |
| `altitude_km` | `numeric(7,2)` | `alt` | `>= 0` |
| `velocidade_km_s` | `numeric(6,2)` | `vel` | `>= 0` |
| `velocidade_x/y/z_km_s` | `numeric(6,2)` | `vx`, `vy`, `vz` | sem restrição |
| `coletado_em` | `timestamptz` | banco (`now()`) | sem restrição |
| `atualizado_em` | `timestamptz` | trigger a cada `update` | sem restrição |

Há também a regra `bolidos_lat_lon_juntas_chk`, que exige latitude e longitude juntas (as duas preenchidas ou as duas nulas).

**Tabela `execucoes`**: uma linha por execução do pipeline, com `iniciado_em`, `finalizado_em`, `registros_processados`, `numero_lotes`, `quantidade_erros`, `status` (`concluido`, `erro_parcial` ou `erro_critico`) e `mensagem`.

**Outros objetos:**

- **Trigger `trg_bolidos_atualizado_em`:** atualiza `atualizado_em` sempre que uma linha muda.
- **Índices:** por energia de impacto, por localização (parcial, só eventos com coordenadas) e por `execucoes.iniciado_em`.
- **RLS ativado** nas duas tabelas, com políticas que permitem **apenas leitura** (`select`) para `anon` e `authenticated`.
- **GRANTs:** `anon` e `authenticated` só podem fazer `select`; `service_role` (usado pelo pipeline) tem acesso completo.

### 4.4 Conferir no Table Editor

Abra **Table Editor** no menu lateral. As tabelas `bolidos` e `execucoes` devem aparecer vazias, sem o aviso de "RLS disabled".

[PRINT: Table Editor listando as tabelas bolidos e execucoes]

---

## 5. URL, chaves e secrets do GitHub

### 5.1 Onde pegar a URL e as chaves

No Supabase, abra **Project Settings** (ícone de engrenagem) ou clique no botão **Connect** no topo do projeto.

| O quê | Onde fica | Formato | Usado por |
|---|---|---|---|
| **Project URL** | **Project Settings → Data API** (ou **Connect**) | `https://SEU-PROJETO.supabase.co` | pipeline e painel |
| **Publishable key** | **Project Settings → API Keys** | começa com `sb_publishable_` | **somente o painel** |
| **Secret key** | **Project Settings → API Keys** (clique em *Reveal*) | começa com `sb_secret_` | **somente o pipeline** |

> Em projetos mais antigos, as chaves aparecem na aba **Legacy API keys** com os nomes `anon` (equivale à publishable) e `service_role` (equivale à secret). Ambas funcionam com este projeto.

[PRINT: tela "API Keys" do Supabase, com as chaves borradas]

**Diferença entre as duas chaves:**

- A **publishable key** é pública. Ela fica no código do painel, que qualquer pessoa pode ver. Isso é seguro porque o RLS e os GRANTs só permitem leitura.
- A **secret key** ignora o RLS e pode apagar ou alterar tudo. Ela **nunca** pode ir para o código, para o painel ou para um commit. Fica só nos secrets do GitHub.

### 5.2 Cadastrar os secrets no GitHub

1. No repositório, vá em **Settings → Secrets and variables → Actions**.
2. Clique em **New repository secret** e crie os dois secrets abaixo, um de cada vez:

| Name | Secret |
|---|---|
| `SUPABASE_URL` | a Project URL (ex.: `https://SEU-PROJETO.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | a **secret key** (`sb_secret_...`) ou a `service_role` legada |

3. Confira se os dois aparecem em **Repository secrets**. O GitHub nunca mostra o valor de volta, só o nome.

[PRINT: lista "Repository secrets" com SUPABASE_URL e SUPABASE_SERVICE_KEY]

> Os nomes precisam ser **exatamente** esses, em maiúsculas. O workflow e o script procuram por eles.

---

## 6. Como funciona o `fetch_nasa.py`

O script faz cinco etapas em sequência e, no fim, registra o resultado na tabela `execucoes`.

### 6.1 Coleta

- Faz um `GET` em `https://ssd-api.jpl.nasa.gov/fireball.api?vel-comp=true`. O parâmetro `vel-comp=true` é necessário para vir `vx`, `vy` e `vz`.
- **Timeout** de 10 s para conectar e 30 s para ler a resposta.
- **Até 3 tentativas** com espera crescente (2 s, depois 4 s) em erros temporários: falha de rede, timeout, HTTP 429 e 5xx. Erros 4xx (exceto 429) não são repetidos, porque indicam problema no próprio pedido.
- **Validação:** a resposta precisa ser um JSON com `fields` e `data`, conter todos os campos esperados e ter ao menos um registro. Se algo falhar, a execução vira `erro_critico`.

A API devolve tudo como texto. Exemplo real de um registro (resposta resumida):

```json
{
  "fields": ["date", "energy", "impact-e", "lat", "lat-dir", "lon", "lon-dir", "alt", "vel", "vx", "vy", "vz"],
  "data": [["2026-09-15 11:26:13", "2.2", "0.079", "37.6", "S", "161.6", "W", "37.0", null, null, null, null]]
}
```

### 6.2 Normalização

Cada linha é convertida para as colunas da tabela `bolidos`:

| Regra | Exemplo |
|---|---|
| Data em ISO 8601 com fuso UTC explícito | `2026-09-15 11:26:13` → `2026-09-15T11:26:13Z` |
| Texto em número; vazio ou `null` vira `None` | `"0.079"` → `0.079`; `null` → `None` |
| `nan` e `inf` são rejeitados (gerariam JSON inválido) | `"nan"` → registro descartado |
| Latitude: `S` vira negativo | `37.6` + `S` → `-37.6` |
| Longitude: `W` vira negativo | `161.6` + `W` → `-161.6` |
| Faixas iguais às `CHECK` do banco | latitude fora de -90..90 é rejeitada |

As colunas `id`, `coletado_em` e `atualizado_em` não são enviadas: o banco preenche.

Uma linha inválida é **descartada e contada**, e não derruba as demais. Validar antes de enviar evita que um único registro fora da faixa faça o banco recusar o lote inteiro.

### 6.3 Deduplicação

O script mantém **um único registro por `data_hora_utc`** (a primeira ocorrência), olhando a lista inteira antes de dividir em lotes.

Por que isso importa? O upsert do PostgreSQL (`ON CONFLICT DO UPDATE`) não aceita a mesma chave duas vezes no mesmo comando. Se isso acontecer, o banco responde com o **erro 21000**. Veja a seção 11.

### 6.4 Lotes e upsert

- Os registros são divididos em **lotes de 500**.
- Cada lote é enviado à API REST do Supabase (PostgREST) com:
  - `POST /rest/v1/bolidos?on_conflict=data_hora_utc`
  - cabeçalho `Prefer: resolution=merge-duplicates,return=minimal`
- Ou seja: evento novo é **inserido**; evento que já existe é **atualizado**.
- Graças ao `UNIQUE (data_hora_utc)`, o pipeline baixa a base inteira todo dia sem gerar duplicatas, e rodar duas vezes dá o mesmo resultado.
- Se um lote falhar, o erro é registrado e **os outros lotes continuam**.

### 6.5 Status e registro em `execucoes`

| Status | Quando acontece |
|---|---|
| `concluido` | Todos os lotes foram gravados e nenhum registro foi descartado |
| `erro_parcial` | Algum lote falhou mas outro foi gravado, **ou** houve registros inválidos descartados |
| `erro_critico` | Falha que impediu a coleta (API fora, resposta inválida, nenhum dado válido) **ou** nenhum lote gravado |

- O script **sempre** tenta gravar uma linha em `execucoes`, mesmo quando dá erro.
- Qualquer status diferente de `concluido` faz o script terminar com **código 1**. Assim, a execução aparece como falha (vermelha) no GitHub Actions.
- Se as variáveis `SUPABASE_URL` ou `SUPABASE_SERVICE_KEY` estiverem ausentes, o script para com código 1 sem conseguir registrar a execução.

### 6.6 Proteção da secret key

- A chave é lida **somente** das variáveis de ambiente.
- A NASA é acessada por uma sessão HTTP separada, que nunca carrega os cabeçalhos do Supabase.
- Um filtro troca a chave por `***` em qualquer linha de log.
- As mensagens de erro passam pelo mesmo mascaramento antes de ir para `execucoes.mensagem`.

---

## 7. Como funciona o workflow

Arquivo: `.github/workflows/update-data.yml`.

| Trecho | O que faz |
|---|---|
| `schedule: cron: "17 6 * * *"` | Roda todo dia às 06:17 UTC (03:17 em Brasília). O minuto 17 evita o pico de agendamentos do GitHub, que acontece na hora cheia |
| `workflow_dispatch` | Permite rodar manualmente pela aba **Actions** |
| `permissions: contents: read` | Menor privilégio: o workflow só lê o repositório |
| `concurrency: group: update-data` com `cancel-in-progress: false` | Nunca roda duas execuções ao mesmo tempo; a nova espera a anterior |
| `timeout-minutes: 15` | Encerra o job se travar |

Passos do job `atualizar` (em `ubuntu-latest`):

1. **Baixar o repositório:** `actions/checkout@v4`.
2. **Instalar Python:** `actions/setup-python@v5` com Python 3.12 e cache do pip.
3. **Instalar dependências:** `pip install -r requirements.txt`.
4. **Coletar dados e gravar no Supabase:** `python scripts/fetch_nasa.py`, com os secrets passados como variáveis de ambiente:

```yaml
env:
  SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

O GitHub mascara automaticamente o valor dos secrets nos logs.

### Rodar manualmente pela primeira vez

1. No repositório, abra a aba **Actions**. Se aparecer um aviso para habilitar os workflows, clique em **I understand my workflows, go ahead and enable them**.
2. Na lista à esquerda, escolha **Atualizar dados da Fireball API**.
3. Clique em **Run workflow**, mantenha a branch `main` e confirme.

[PRINT: aba Actions com o botão "Run workflow" aberto]

---

## 8. Rodando o `--dry-run` localmente

O modo `--dry-run` busca e normaliza os dados da NASA, mas **não acessa o Supabase**. Não precisa de nenhuma chave e serve para testar a coleta no seu computador.

```bash
cd SSD-CNEOS-Fireball
python3 -m venv .venv
source .venv/bin/activate          # no Windows: .venv\Scripts\activate
pip install -r requirements.txt
python scripts/fetch_nasa.py --dry-run
```

Saída esperada (os números mudam com o tempo):

```
2026-11-12 10:00:00 [INFO] Início da coleta da Fireball API.
2026-11-12 10:00:00 [INFO] Modo --dry-run: o Supabase NÃO será acessado.
2026-11-12 10:00:01 [INFO] Registros recebidos da API: 1074
2026-11-12 10:00:01 [INFO] Inválidos descartados: 0 | duplicatas removidas: 0 | prontos para upsert: 1074
2026-11-12 10:00:01 [INFO] Seriam enviados 3 lote(s) de até 500 registros.
2026-11-12 10:00:01 [INFO] Exemplo de 3 registros normalizados:
{
  "data_hora_utc": "...Z",
  "energia_irradiada_j_e10": ...,
  ...
}
```

[PRINT: terminal com a saída do --dry-run]

> **Gravar de verdade a partir do computador** (opcional): exporte as variáveis no terminal (`export SUPABASE_URL=...` e `export SUPABASE_SERVICE_KEY=...`) e rode sem `--dry-run`. Nunca salve esses valores em arquivos do repositório. O recomendado é deixar a gravação só para o GitHub Actions.

---

## 9. GitHub Pages e configuração do painel

### 9.1 Configurar a publishable key no painel

Abra `painel/script.js`. As primeiras linhas são:

```js
const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
const SUPABASE_ANON_KEY = "SUA_PUBLISHABLE_KEY";
```

1. Troque `https://SEU-PROJETO.supabase.co` pela sua **Project URL**.
2. Troque `SUA_PUBLISHABLE_KEY` pela sua **publishable key** (`sb_publishable_...`) ou pela `anon` legada.
3. **Nunca** use a secret key aqui: o arquivo é público e qualquer visitante consegue lê-lo.
4. Faça commit e push:

```bash
git add painel/script.js
git commit -m "Configura o painel com a publishable key"
git push
```

Enquanto esses valores não forem trocados, o painel mostra a mensagem *"Painel não configurado: preencha SUPABASE_URL e SUPABASE_ANON_KEY no início do script."*

### 9.2 Ativar o GitHub Pages

1. No repositório, vá em **Settings → Pages**.
2. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
3. Em **Branch**, escolha `main` e a pasta `/ (root)`. Clique em **Save**.
4. Aguarde de 1 a 3 minutos. O endereço aparece no topo da página, no formato `https://SUA-ORGANIZACAO.github.io/SSD-CNEOS-Fireball/`. Em organizações, o GitHub converte o nome para minúsculas.

[PRINT: tela Settings → Pages com branch main e pasta / (root)]

O `index.html` da raiz redireciona automaticamente para `painel/`.

### 9.3 O que o painel faz

- **Carrega todos os eventos com paginação:** pede blocos de 1000 linhas (`limit=1000&offset=0`, `offset=1000`, ...) ordenados por `data_hora_utc`, até vir um bloco com menos de 1000.
- **Mostra:**
  - cards de resumo;
  - um mapa (Leaflet) com os pontos coloridos pela energia;
  - um gráfico de eventos por ano (Chart.js);
  - uma tabela ordenável;
  - a última execução do pipeline, em horário de Brasília.
- **Filtros:** ano inicial e final, energia de impacto mínima e hemisfério.
- **Segurança:** todo valor vindo do banco passa por `escapeHtml()` antes de entrar no HTML, o que impede ataques de XSS.

[PRINT: painel publicado, com cards, mapa e gráfico]

---

## 10. Como verificar se deu certo

### 10.1 Workflow verde

Na aba **Actions**, a execução deve aparecer com um **✓ verde**. Abra a execução e o passo **Coletar dados e gravar no Supabase**. O log deve terminar com algo como:

```
[INFO] Lote 1/3 enviado (500 registros).
[INFO] Lote 2/3 enviado (500 registros).
[INFO] Lote 3/3 enviado (74 registros).
[INFO] Execução registrada em execucoes.
[INFO] Resultado final: CONCLUIDO | 1074 registro(s) gravado(s) em 3/3 lote(s); 0 erro(s)
```

[PRINT: execução do workflow com ✓ verde e o log do último passo]

### 10.2 Table Editor

No Supabase, abra **Table Editor**:

- `bolidos` deve ter mais de mil linhas;
- `execucoes` deve ter uma linha com `status = concluido`.

[PRINT: Table Editor mostrando a tabela bolidos preenchida]
[PRINT: Table Editor mostrando a linha da tabela execucoes]

Também é possível conferir pelo **SQL Editor**:

```sql
select count(*) from public.bolidos;

select iniciado_em, status, registros_processados, numero_lotes, mensagem
from public.execucoes
order by iniciado_em desc
limit 5;
```

### 10.3 URL da API REST

A API REST do Supabase segue o formato `https://SEU-PROJETO.supabase.co/rest/v1/NOME_DA_TABELA`. Teste com `curl` usando a **publishable key**:

```bash
curl "https://SEU-PROJETO.supabase.co/rest/v1/bolidos?select=data_hora_utc,energia_impacto_kt&order=data_hora_utc.desc&limit=3" \
  -H "apikey: SUA_PUBLISHABLE_KEY"
```

A resposta deve ser um JSON com os 3 eventos mais recentes.

Para contar o total de linhas, peça a contagem no cabeçalho:

```bash
curl -I "https://SEU-PROJETO.supabase.co/rest/v1/bolidos?select=id&limit=1" \
  -H "apikey: SUA_PUBLISHABLE_KEY" -H "Prefer: count=exact"
```

O total aparece no cabeçalho `content-range`, por exemplo `0-0/1074`.

**Teste de segurança:** tente gravar com a publishable key. A gravação **deve ser recusada**:

```bash
curl -X POST "https://SEU-PROJETO.supabase.co/rest/v1/bolidos" \
  -H "apikey: SUA_PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"data_hora_utc":"2000-01-01T00:00:00Z","energia_irradiada_j_e10":1,"energia_impacto_kt":1}'
```

A resposta esperada é um erro de permissão (HTTP 401 ou 403, código `42501`). Se a linha for gravada, revise o RLS e os GRANTs: rode o `setup.sql` de novo.

[PRINT: terminal com a resposta JSON do curl e o erro de permissão no POST]

### 10.4 Painel

Abra o endereço do GitHub Pages. O bloco **"Última atualização do pipeline"** deve mostrar a data em horário de Brasília e o status **Concluído**. O card **Total de eventos** deve bater com o `count(*)` do banco.

---

## 11. Problemas comuns e soluções

### Erro 21000: "ON CONFLICT DO UPDATE command cannot affect row a second time"

- **Causa:** o mesmo lote do upsert trouxe a mesma `data_hora_utc` mais de uma vez. O PostgreSQL não sabe qual versão manter e recusa o lote inteiro.
- **Solução:** deduplicar pela chave natural **antes** de dividir em lotes. O `fetch_nasa.py` já faz isso com a função `deduplicar()`. Se você alterar o script, mantenha essa etapa.

### O painel ou uma consulta só traz 1000 linhas

- **Causa:** o Supabase limita cada resposta da API REST a **1000 linhas** por padrão (configuração *Max rows*, em **Project Settings → Data API**). Pedidos maiores são cortados **sem erro**.
- **Solução:** paginar com `limit` e `offset`, como faz o `carregarBolidos()` do `painel/script.js`. É importante ordenar por uma coluna única (`order=data_hora_utc.desc`) para nenhuma linha se repetir ou sumir entre as páginas. Aumentar o *Max rows* também funciona, mas a paginação continua valendo quando a base crescer.
- **Para conferir o total real:** use o `count(*)` no SQL Editor ou o cabeçalho `Prefer: count=exact` (seção 10.3).

### Workflow falha com "variáveis de ambiente SUPABASE_URL e/ou SUPABASE_SERVICE_KEY ausentes"

- **Causa:** os secrets não foram criados, ou foram criados com outro nome.
- **Solução:** confira em **Settings → Secrets and variables → Actions** se existem exatamente `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`. Eles devem estar em **Repository secrets** (e não em *Variables* ou *Environment secrets*).

### Upsert falha com HTTP 401 ou 403 (código `42501`, "permission denied")

- **Causa:** `SUPABASE_SERVICE_KEY` contém a publishable key em vez da secret key, ou o `setup.sql` não foi executado por inteiro (faltaram os GRANTs).
- **Solução:** cadastre de novo o secret com a **secret key** e rode o `setup.sql` completo no SQL Editor.

### HTTP 404 ou erro `PGRST205` / `PGRST204` ("Could not find the table/column")

- **Causa:** as tabelas não existem no projeto apontado por `SUPABASE_URL`, ou a URL está errada. Também acontece se a tabela foi criada há instantes e o cache da API ainda não atualizou.
- **Solução:**
  - confira se a URL é a do projeto certo e não termina com `/rest/v1`, que o script já acrescenta;
  - rode o `setup.sql`;
  - aguarde alguns segundos e tente de novo.

### Erro `23514` (violação de CHECK)

- **Causa:** algum valor fora das faixas definidas no banco, como uma latitude acima de 90.
- **Solução:** o `fetch_nasa.py` já valida as mesmas faixas e descarta o registro antes do envio (status `erro_parcial`). Se você mudar as `CHECK` do `setup.sql`, atualize também o `FAIXAS_VALIDAS` do script.

### Status `erro_parcial` na tabela `execucoes`

- **Causa:** algum registro da NASA foi descartado na normalização, ou algum lote falhou.
- **Solução:** leia a coluna `mensagem` da execução e o log do workflow. Os registros descartados aparecem como `Registro descartado (motivo): [...]`.

### A API da NASA está fora do ar (`erro_critico`)

- **Causa:** instabilidade temporária do JPL.
- **Solução:** o script já tenta 3 vezes. Se ainda falhar, rode o workflow manualmente mais tarde. Os dados já gravados continuam no banco, e a próxima execução completa a base.

### O agendamento diário não rodou

- **Causas comuns:**
  - o arquivo do workflow não está na branch padrão (`main`);
  - os workflows ainda não foram habilitados na aba **Actions**;
  - o GitHub desativa agendamentos de repositórios públicos sem atividade por 60 dias;
  - o horário do cron pode atrasar alguns minutos em momentos de muita demanda.
- **Solução:** confira a aba **Actions**. Se aparecer o aviso de workflow desativado, clique em **Enable workflow**.

### O projeto do Supabase foi pausado

- **Causa:** no plano gratuito, projetos sem uso por cerca de uma semana são pausados.
- **Solução:** a execução diária do workflow normalmente mantém o projeto ativo. Se ele for pausado, abra o painel do Supabase e clique em **Restore project**.

### O painel mostra "Painel não configurado"

- **Causa:** as constantes do início de `painel/script.js` ainda estão com os valores de exemplo.
- **Solução:** siga a seção 9.1.

### O painel mostra "Não foi possível carregar os dados agora"

- **Causas comuns:**
  - publishable key errada (HTTP 401);
  - URL do projeto errada;
  - projeto do Supabase pausado;
  - políticas de RLS ausentes, o que faz a API devolver uma lista vazia ou um erro.
- **Solução:** abra o console do navegador (F12 → **Console** e **Network**) para ver o código HTTP. Depois teste a mesma consulta com o `curl` da seção 10.3.

### O painel abre, mas sem mapa ou sem gráfico

- **Causa:** o Leaflet ou o Chart.js não carregaram do CDN, seja por rede bloqueada ou por um hash `integrity` diferente do arquivo.
- **Solução:** confira o console do navegador. Se você trocar a versão de alguma biblioteca, atualize também o atributo `integrity` no `painel/index.html`.

### GitHub Pages retorna 404

- **Causas e soluções:**
  - aguarde alguns minutos após ativar o Pages;
  - confira se a fonte é a branch `main` com a pasta `/ (root)`;
  - confira se o `index.html` está na raiz do repositório;
  - lembre que o endereço da organização fica em minúsculas.

### A secret key foi exposta por engano

- **Solução imediata:**
  1. no Supabase, em **Project Settings → API Keys**, revogue a chave e gere uma nova;
  2. atualize o secret `SUPABASE_SERVICE_KEY` no GitHub.
- **Atenção:** apagar o commit não basta, porque a chave continua no histórico do git e pode já ter sido copiada.

---

*Fonte dos dados: CNEOS: Center for Near Earth Object Studies (NASA/JPL), Fireball API (https://ssd-api.jpl.nasa.gov/doc/fireball.html).*
