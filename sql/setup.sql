create table if not exists public.bolidos (
    id                       bigint generated always as identity primary key,

    data_hora_utc            timestamptz   not null,

    energia_irradiada_j_e10  numeric(12,3) not null check (energia_irradiada_j_e10 >= 0),
    energia_impacto_kt       numeric(12,3) not null check (energia_impacto_kt >= 0),

    latitude_graus           numeric(6,3)  check (latitude_graus  between  -90 and  90),
    longitude_graus          numeric(7,3)  check (longitude_graus between -180 and 180),

    altitude_km              numeric(7,2)  check (altitude_km >= 0),
    velocidade_km_s          numeric(6,2)  check (velocidade_km_s >= 0),
    velocidade_x_km_s        numeric(6,2),
    velocidade_y_km_s        numeric(6,2),
    velocidade_z_km_s        numeric(6,2),

    coletado_em              timestamptz   not null default now(),
    atualizado_em            timestamptz   not null default now(),

    constraint bolidos_data_hora_utc_key unique (data_hora_utc),

    constraint bolidos_lat_lon_juntas_chk
        check ((latitude_graus is null) = (longitude_graus is null))
);

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

create table if not exists public.execucoes (
    id                     bigint generated always as identity primary key,
    iniciado_em            timestamptz not null default now(),
    finalizado_em          timestamptz,
    registros_processados  integer     not null default 0 check (registros_processados >= 0),
    numero_lotes           integer     not null default 0 check (numero_lotes >= 0),
    quantidade_erros       integer     not null default 0 check (quantidade_erros >= 0),
    status                 text        not null,
    mensagem               text,

    constraint execucoes_status_chk
        check (status in ('concluido', 'erro_parcial', 'erro_critico')),

    constraint execucoes_periodo_chk
        check (finalizado_em is null or finalizado_em >= iniciado_em)
);

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

create index if not exists bolidos_energia_impacto_kt_idx
    on public.bolidos (energia_impacto_kt);

create index if not exists bolidos_lat_lon_idx
    on public.bolidos (latitude_graus, longitude_graus)
    where latitude_graus is not null;

create index if not exists execucoes_iniciado_em_idx
    on public.execucoes (iniciado_em desc);

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

grant usage on schema public to anon, authenticated, service_role;

revoke all on table public.bolidos, public.execucoes from anon, authenticated;
grant select on table public.bolidos, public.execucoes to anon, authenticated;
grant all on table public.bolidos, public.execucoes to service_role;

revoke all on sequence public.bolidos_id_seq, public.execucoes_id_seq from anon, authenticated;
grant all on sequence public.bolidos_id_seq, public.execucoes_id_seq to service_role;

revoke all on function public.definir_atualizado_em() from public, anon, authenticated;
grant execute on function public.definir_atualizado_em() to service_role;
