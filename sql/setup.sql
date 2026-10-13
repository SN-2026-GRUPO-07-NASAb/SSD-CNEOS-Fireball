-- =============================================================================
-- SSD-CNEOS-Fireball — Grupo 07
-- Script de criação do banco (Supabase / PostgreSQL).
--
-- Idempotente: pode ser executado várias vezes no SQL Editor sem erro.
-- Observação: "create table if not exists" NÃO altera uma tabela que já existe;
-- mudanças futuras na estrutura das colunas exigem "alter table" explícito.
--
-- Nenhuma chave, senha ou URL do projeto deve ser colocada neste arquivo.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Tabela principal: bólidos (fireballs) da API SSD/CNEOS do JPL
--
-- Validação contra a base completa da API (1074 registros, 1988-04-15 a
-- 2026-10-04):
--   * date, energy e impact-e nunca vêm nulos            -> NOT NULL;
--   * lat/lat-dir/lon/lon-dir vêm nulos sempre juntos     -> 186 registros;
--   * alt nulo em 472 registros; vel nulo em 711;
--   * vx/vy/vz só vêm com o parâmetro "vel-comp=true" e são nulos sempre que
--     vel é nulo; podem ser negativos (são componentes de um vetor);
--   * maiores valores: energy 37500 (2 casas), impact-e 441 (3 casas),
--     lat 88.5, lon 180.0, alt 90.5, vel 71.1, |vx/vy/vz| <= 68.8 (2 casas).
-- Os tipos numeric abaixo comportam todos esses valores com folga.
-- -----------------------------------------------------------------------------
create table if not exists public.bolidos (
    -- Chave substituta gerada pelo banco (o pipeline não envia este campo).
    id                       bigint generated always as identity primary key,

    -- Chave natural: momento do pico de brilho (campo "date", em UTC).
    -- O pipeline deve enviar o valor com fuso explícito (ex.: "...Z").
    data_hora_utc            timestamptz   not null,

    -- Energias: sempre presentes na API e nunca negativas.
    energia_irradiada_j_e10  numeric(12,3) not null check (energia_irradiada_j_e10 >= 0),
    energia_impacto_kt       numeric(12,3) not null check (energia_impacto_kt >= 0),

    -- Localização em graus decimais (Sul e Oeste negativos); opcional.
    latitude_graus           numeric(6,3)  check (latitude_graus  between  -90 and  90),
    longitude_graus          numeric(7,3)  check (longitude_graus between -180 and 180),

    -- Altitude e velocidade: opcionais; componentes vx/vy/vz podem ser negativos.
    altitude_km              numeric(7,2)  check (altitude_km >= 0),
    velocidade_km_s          numeric(6,2)  check (velocidade_km_s >= 0),
    velocidade_x_km_s        numeric(6,2),
    velocidade_y_km_s        numeric(6,2),
    velocidade_z_km_s        numeric(6,2),

    -- Metadados de controle do pipeline.
    coletado_em              timestamptz   not null default now(),
    atualizado_em            timestamptz   not null default now(),

    -- UNIQUE na chave natural: permite upsert com on_conflict=data_hora_utc.
    -- Verificado: nenhuma data/hora repetida nos 1074 registros da API.
    constraint bolidos_data_hora_utc_key unique (data_hora_utc),

    -- Latitude e longitude vêm sempre juntas (ambas nulas ou ambas preenchidas).
    constraint bolidos_lat_lon_juntas_chk
        check ((latitude_graus is null) = (longitude_graus is null))
);

-- Documentação da tabela e das colunas (visível no painel do Supabase).
comment on table  public.bolidos is
    'Bólidos (fireballs) registrados pelo CNEOS/JPL, coletados da Fireball API.';
comment on column public.bolidos.id is
    'Identificador interno gerado pelo banco.';
comment on column public.bolidos.data_hora_utc is
    'Data/hora do pico de brilho em UTC (campo "date" da API). Chave natural.';
comment on column public.bolidos.energia_irradiada_j_e10 is
    'Energia total irradiada, em unidades de 10^10 joules (campo "energy").';
comment on column public.bolidos.energia_impacto_kt is
    'Energia de impacto estimada, em quilotons de TNT (campo "impact-e").';
comment on column public.bolidos.latitude_graus is
    'Latitude em graus decimais; Sul negativo (campos "lat" + "lat-dir").';
comment on column public.bolidos.longitude_graus is
    'Longitude em graus decimais; Oeste negativo (campos "lon" + "lon-dir").';
comment on column public.bolidos.altitude_km is
    'Altitude do pico de brilho, em km (campo "alt").';
comment on column public.bolidos.velocidade_km_s is
    'Velocidade antes do impacto, em km/s (campo "vel").';
comment on column public.bolidos.velocidade_x_km_s is
    'Componente X da velocidade pré-impacto (geocêntrica), em km/s (campo "vx"; exige vel-comp=true).';
comment on column public.bolidos.velocidade_y_km_s is
    'Componente Y da velocidade pré-impacto (geocêntrica), em km/s (campo "vy"; exige vel-comp=true).';
comment on column public.bolidos.velocidade_z_km_s is
    'Componente Z da velocidade pré-impacto (geocêntrica), em km/s (campo "vz"; exige vel-comp=true).';
comment on column public.bolidos.coletado_em is
    'Momento em que o registro foi inserido pelo pipeline.';
comment on column public.bolidos.atualizado_em is
    'Momento da última atualização do registro (mantido por trigger).';


-- -----------------------------------------------------------------------------
-- 2. Trigger que mantém "atualizado_em" a cada UPDATE (inclusive no upsert)
--    search_path vazio evita sequestro de objetos por outro schema.
-- -----------------------------------------------------------------------------
create or replace function public.definir_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.atualizado_em := now();
    return new;
end;
$$;

drop trigger if exists trg_bolidos_atualizado_em on public.bolidos;
create trigger trg_bolidos_atualizado_em
    before update on public.bolidos
    for each row
    execute function public.definir_atualizado_em();


-- -----------------------------------------------------------------------------
-- 3. Tabela de log das execuções do pipeline (GitHub Actions)
-- -----------------------------------------------------------------------------
create table if not exists public.execucoes (
    id                     bigint generated always as identity primary key,
    iniciado_em            timestamptz not null default now(),
    finalizado_em          timestamptz,
    registros_processados  integer     not null default 0 check (registros_processados >= 0),
    numero_lotes           integer     not null default 0 check (numero_lotes >= 0),
    quantidade_erros       integer     not null default 0 check (quantidade_erros >= 0),
    status                 text        not null,
    mensagem               text,

    -- Apenas os três estados previstos para o pipeline.
    constraint execucoes_status_chk
        check (status in ('concluido', 'erro_parcial', 'erro_critico')),

    -- O fim da execução não pode ser anterior ao início.
    constraint execucoes_periodo_chk
        check (finalizado_em is null or finalizado_em >= iniciado_em)
);

-- Documentação da tabela e das colunas.
comment on table public.execucoes is
    'Log de execuções do pipeline de coleta da Fireball API.';
comment on column public.execucoes.iniciado_em is
    'Início da execução do pipeline.';
comment on column public.execucoes.finalizado_em is
    'Fim da execução do pipeline (nulo se interrompida antes do registro final).';
comment on column public.execucoes.registros_processados is
    'Quantidade de registros enviados ao banco (inseridos ou atualizados).';
comment on column public.execucoes.numero_lotes is
    'Quantidade de lotes enviados no upsert.';
comment on column public.execucoes.quantidade_erros is
    'Quantidade de erros ocorridos durante a execução.';
comment on column public.execucoes.status is
    'Resultado: concluido, erro_parcial ou erro_critico.';
comment on column public.execucoes.mensagem is
    'Detalhes livres (resumo ou mensagem de erro).';


-- -----------------------------------------------------------------------------
-- 4. Índices para as consultas do painel
--   * Data: NÃO precisa de índice extra; o UNIQUE em data_hora_utc já cria um
--     índice B-tree usado para filtrar e ordenar por data (asc ou desc).
--   * Energia de impacto: filtro por faixa e ordenação ("maiores eventos").
--   * Região: filtro por faixa de latitude/longitude (retângulo no mapa).
--     Índice parcial, pois registros sem localização nunca entram nesse filtro.
--   * Última execução: order by iniciado_em desc limit 1.
-- -----------------------------------------------------------------------------
create index if not exists bolidos_energia_impacto_kt_idx
    on public.bolidos (energia_impacto_kt);

create index if not exists bolidos_lat_lon_idx
    on public.bolidos (latitude_graus, longitude_graus)
    where latitude_graus is not null;

create index if not exists execucoes_iniciado_em_idx
    on public.execucoes (iniciado_em desc);


-- -----------------------------------------------------------------------------
-- 5. Row Level Security em TODAS as tabelas
--    Apenas leitura pública (SELECT) para anon e authenticated.
--    Não há política de INSERT/UPDATE/DELETE: só o service_role (que ignora RLS)
--    consegue gravar — e ele é usado apenas pelo pipeline no GitHub Actions.
-- -----------------------------------------------------------------------------
alter table public.bolidos   enable row level security;
alter table public.execucoes enable row level security;

drop policy if exists "leitura_publica_bolidos" on public.bolidos;
create policy "leitura_publica_bolidos"
    on public.bolidos
    for select
    to anon, authenticated
    using (true);

drop policy if exists "leitura_publica_execucoes" on public.execucoes;
create policy "leitura_publica_execucoes"
    on public.execucoes
    for select
    to anon, authenticated
    using (true);


-- -----------------------------------------------------------------------------
-- 6. Permissões (GRANTs explícitos)
--    O Supabase concede ALL por padrão a anon/authenticated em objetos novos do
--    schema public; por isso revogamos tudo antes de conceder só o SELECT.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

-- Tabelas: leitura para o público; acesso total para o pipeline.
revoke all on table public.bolidos, public.execucoes from anon, authenticated;
grant select on table public.bolidos, public.execucoes to anon, authenticated;
grant all on table public.bolidos, public.execucoes to service_role;

-- Sequences das colunas identity: só o service_role precisa delas.
revoke all on sequence public.bolidos_id_seq, public.execucoes_id_seq from anon, authenticated;
grant all on sequence public.bolidos_id_seq, public.execucoes_id_seq to service_role;

-- Função do trigger: não fica exposta como RPC para anon/authenticated.
revoke all on function public.definir_atualizado_em() from public, anon, authenticated;
grant execute on function public.definir_atualizado_em() to service_role;
