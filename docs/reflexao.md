# Reflexão sobre o uso de IA

**Projeto:** Pipeline de Dados SSD/CNEOS Fireball (NASA/JPL)  
**Grupo 07:** Marcelo, João Miranda, Lucas Hein.

---

## 1. Como usamos a IA

Usamos a IA como uma ferramenta de geração e revisão de código, e não como substituta das nossas decisões . O ciclo de trabalho foi sempre o mesmo:

1. **Nós definíamos o requisito.** Cada prompt trazia o contexto do projeto, as regras da atividade e as exigências técnicas que queríamos ver implementadas.
2. **A IA gerava ou revisava o código.**
3. **Nós validávamos.** Executávamos o SQL no Supabase, rodávamos o `--dry-run`, disparávamos o workflow no GitHub Actions, conferíamos o Table Editor e testávamos o painel no navegador.
4. **Quando algo não estava certo, voltávamos com um novo prompt** descrevendo o erro ou pedindo uma revisão específica.

A configuração das plataformas foi feita por nós: organização e repositório no GitHub, projeto no Supabase, execução do `setup.sql`, cadastro dos secrets, versionamento com git e publicação no GitHub Pages.

Aprendemos que a qualidade da resposta dependia da qualidade do pedido. Prompts vagos geravam código genérico. Prompts com contexto e restrições claras ("não altere o banco", "não rode sem `--dry-run`", "aplique `escapeHtml()` em todo valor externo") geravam código alinhado ao projeto.

| Etapa                        | Uso da IA                      | Papel do grupo                                 |
| ---------------------------- | ------------------------------ | ---------------------------------------------- |
| Banco (`setup.sql`)          | Criação e refinamento          | Requisitos, execução no Supabase, validação    |
| Pipeline (`fetch_nasa.py`)   | Criação e revisão de segurança | Requisitos, testes, decisão de revisar         |
| Workflow (`update-data.yml`) | Criação                        | Secrets, execução manual, verificação          |
| Painel                       | Criação e estilização          | Requisitos visuais, testes no navegador        |
| Documentação                 | Apoio na redação               | Estrutura, divisão de funções, prints, revisão |
| Auditoria final              | Busca de falhas                | Priorização e correções                        |

---

## 2. Onde a IA ajudou

**Validação com dados reais.** No refinamento do banco, pedimos que a IA baixasse a base completa da API antes de mexer no SQL. Com isso, as decisões passaram a ter números por trás: 1074 registros, 186 sem localização, 472 sem altitude, 711 sem velocidade e nenhuma data repetida. Foi assim que definimos onde usar `NOT NULL`, os tipos `numeric` e a chave natural `data_hora_utc`. Sem esse pedido, provavelmente teríamos colunas obrigatórias que quebrariam a inserção.

**Testes que não conseguiríamos fazer facilmente.** Na revisão do pipeline, a IA testou o script contra servidores falsos que simulavam a NASA e o Supabase. Isso cobriu cenários difíceis de reproduzir de verdade: API fora do ar, lote com falha, registro inválido e linhas duplicadas. Todos os status (`concluido`, `erro_parcial`, `erro_critico`) foram verificados sem tocar no banco real.

**Velocidade em tarefas repetitivas.** Comentários no SQL, estilos CSS, tratamento de campos nulos e a estrutura inicial da documentação seriam trabalhosos de escrever do zero. A IA acelerou essas partes e deixou mais tempo para entendermos e validarmos o projeto.

**Explicações.** Ao final de cada tarefa, pedíamos que a IA explicasse as decisões.

---

## 3. Onde a IA errou

### 3.1 Vazamento da secret key

A primeira versão do `fetch_nasa.py` usava a mesma conexão HTTP para consultar a NASA e para gravar no Supabase. Os cabeçalhos com a **secret key do Supabase** eram configurados nessa conexão antes da consulta, então a chave era enviada para `ssd-api.jpl.nasa.gov` em toda execução.

O ponto mais importante é que **o código funcionava**. O workflow ficava verde e os dados chegavam ao banco. Nada indicava o problema. A falha só apareceu quando pedimos uma revisão com foco explícito em segurança, e a IA confirmou o vazamento testando a versão antiga.

A correção separou as conexões e passou a mascarar a chave nos logs e na tabela `execucoes`, que tem leitura pública. Foi necessário gerar uma nova secret key no Supabase e atualizar o secret no GitHub, já que a antiga tinha sido exposta.

### 3.2 Conteúdo inventado e respostas incompletas

- No primeiro rascunho do tutorial, a IA usou um exemplo de JSON fictício, que depois foi trocado por um registro real da API.
- Em uma tarefa de layout, a sessão foi interrompida antes de a IA concluir a verificação das animações e do celular. A resposta parecia completa, mas não estava: precisamos conferir no navegador.

### 3.3 Excesso de complexidade

Em vários momentos a IA entregou mais do que pedimos: trigger, CHECKs extras, classes, filtros de log, comentários em todas as colunas. Na maior parte dos casos foi útil.

---

## 4. O que corrigimos e verificamos

- Pedimos uma revisão de segurança do pipeline, que revelou o vazamento da chave.
- Trocamos a secret key no Supabase, revogamos a antiga e atualizamos o secret `SUPABASE_SERVICE_KEY` no GitHub.
- Fizemos commit e push da versão corrigida e confirmamos no Actions e na tabela `execucoes` que a produção passou a usar o script novo.
- Conferimos manualmente no navegador o layout e as animações após a tarefa interrompida.
- Executamos o `setup.sql` no Supabase, rodamos o workflow e validamos os dados no Table Editor e na API REST.
- Confirmamos que não há nenhuma secret key nos arquivos do repositório e que um POST com a publishable key é bloqueado (HTTP 401).

---

## 5. Limitações que percebemos

**Funcionar não é o mesmo que estar correto.** O vazamento da chave é a prova: a IA gera código que passa nos testes visíveis e ainda assim tem falhas graves. Revisão humana e testes específicos continuam indispensáveis.

**A IA não enxerga o ambiente real.** Ela não sabe o que está publicado no GitHub, o que foi executado no Supabase nem o que mudou na interface das plataformas. Quando ela afirma algo sobre esses ambientes, precisamos verificar.

**A IA responde com a mesma confiança quando acerta e quando erra.** O JSON inventado e a resposta interrompida tinham a mesma aparência de uma resposta completa.

**Dependência do contexto.** Toda nova sessão precisa receber o contexto do projeto de novo. Quando esquecíamos um requisito no prompt, ele não era aplicado.

---

## 6. O que faríamos diferente

1. **Pedir revisão de segurança logo após a primeira versão** de qualquer código que lida com chaves, e não só no final.
2. **Fazer commit e push logo após cada correção validada**, para que local e produção não fiquem diferentes.

---

## 7. Conclusão

A IA acelerou muito o desenvolvimento e nos ajudou a entender diversos conceitos. Ao mesmo tempo, o projeto mostrou que ela não substitui o julgamento de quem está desenvolvendo: o erro mais grave do projeto foi gerado pela própria IA e passou despercebido enquanto o sistema parecia funcionar.

O que fez diferença foi tratar cada resposta como uma proposta a ser verificada, e não como uma solução pronta. A IA escreveu boa parte do código; a responsabilidade de definir o que construir, testar o que foi entregue e garantir que o sistema estivesse seguro continuou sendo nossa.
