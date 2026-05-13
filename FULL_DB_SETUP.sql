-- FULL_DB_SETUP.sql
-- Execute este arquivo no SQL Editor do Supabase.
-- Ele cria a tabela usada por este projeto e deixa um registro inicial pronto.

begin;

create table if not exists public.app_state (
  id text primary key,
  payload jsonb,
  data jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint app_state_payload_or_data_check check (payload is not null or data is not null)
);

alter table public.app_state add column if not exists payload jsonb;
alter table public.app_state add column if not exists data jsonb;
alter table public.app_state add column if not exists created_at timestamptz not null default timezone('utc', now());
alter table public.app_state add column if not exists updated_at timestamptz not null default timezone('utc', now());

create index if not exists app_state_updated_at_idx on public.app_state (updated_at desc);

create or replace function public.sync_app_state_columns()
returns trigger
language plpgsql
as $$
begin
  if new.payload is null and new.data is null then
    raise exception 'payload or data must be informed';
  end if;

  if new.payload is null then
    new.payload := new.data;
  elsif new.data is null then
    new.data := new.payload;
  else
    new.data := new.payload;
  end if;

  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_sync_app_state_columns on public.app_state;

create trigger trg_sync_app_state_columns
before insert or update on public.app_state
for each row
execute function public.sync_app_state_columns();

alter table public.app_state enable row level security;

drop policy if exists "app_state_select" on public.app_state;
drop policy if exists "app_state_insert" on public.app_state;
drop policy if exists "app_state_update" on public.app_state;

create policy "app_state_select"
on public.app_state
for select
to anon, authenticated
using (true);

create policy "app_state_insert"
on public.app_state
for insert
to anon, authenticated
with check (true);

create policy "app_state_update"
on public.app_state
for update
to anon, authenticated
using (true)
with check (true);

insert into public.app_state (id, payload, data)
values (
  'main',
  '{
    "schemaVersion": 1,
    "nextWardId": 2,
    "nextShiftId": 2,
    "users": [
      {
        "id": 1,
        "username": "admin",
        "password": "admin",
        "nome": "Administrador",
        "role": "admin",
        "activeShift": null,
        "shifts": [],
        "actions": []
      }
    ],
    "wards": [
      {
        "id": 1,
        "nome": "POSTO 2",
        "enfermarias": ["ENF. 230", "ENF. 240"],
        "indicadores": {
          "altas": 2,
          "obitos": 0
        },
        "equipe": {
          "medicoPlantao": "DRA JADE",
          "enfermeiroDia": "ALEXCIANA",
          "tecnicosDia": "FONTINELE, CLASCY E IACI",
          "enfermeiroNoite": "ALEXCIANA",
          "tecnicosNoite": "FONTINELE, CLASCY E IACI",
          "faltosos": ""
        },
        "beds": [
          {
            "id": 231,
            "enfermaria": "ENF. 230",
            "status": "OCUPADO",
            "admissao": "2026-03-20",
            "nome": "MARIA JOANA DA SILVA",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "FISIO/UMIDIFICAR TRAQUEOSTOMIA",
            "pendencias": "NEURO",
            "nir": "NEURO",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 232,
            "enfermaria": "ENF. 230",
            "status": "LIVRE",
            "admissao": "",
            "nome": "",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 233,
            "enfermaria": "ENF. 230",
            "status": "OCUPADO",
            "admissao": "2026-04-08",
            "nome": "MARIA RAIMUNDA DOS SANTOS",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "PNM",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 234,
            "enfermaria": "ENF. 230",
            "status": "LIVRE",
            "admissao": "",
            "nome": "",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 235,
            "enfermaria": "ENF. 230",
            "status": "OCUPADO",
            "admissao": "2026-04-01",
            "nome": "MARIA SILVA COSTA",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 236,
            "enfermaria": "ENF. 240",
            "status": "BLOQUEADO",
            "admissao": "",
            "nome": "",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "Manutencao",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 237,
            "enfermaria": "ENF. 240",
            "status": "RESERVADO",
            "admissao": "",
            "nome": "",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "Pre-cirurgia",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 238,
            "enfermaria": "ENF. 240",
            "status": "EXTRA",
            "admissao": "",
            "nome": "",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 239,
            "enfermaria": "ENF. 240",
            "status": "OCUPADO",
            "admissao": "2026-04-05",
            "nome": "JOAO PEREIRA",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "Pneumonia",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 240,
            "enfermaria": "ENF. 240",
            "status": "OCUPADO",
            "admissao": "2026-04-07",
            "nome": "ANTONIO SOUZA",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "AVC",
            "pendencias": "Tomografia",
            "nir": "NEURO",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          }
        ]
      }
    ]
  }'::jsonb,
  '{
    "schemaVersion": 1,
    "nextWardId": 2,
    "nextShiftId": 2,
    "users": [
      {
        "id": 1,
        "username": "admin",
        "password": "admin",
        "nome": "Administrador",
        "role": "admin",
        "activeShift": null,
        "shifts": [],
        "actions": []
      }
    ],
    "wards": [
      {
        "id": 1,
        "nome": "POSTO 2",
        "enfermarias": ["ENF. 230", "ENF. 240"],
        "indicadores": {
          "altas": 2,
          "obitos": 0
        },
        "equipe": {
          "medicoPlantao": "DRA JADE",
          "enfermeiroDia": "ALEXCIANA",
          "tecnicosDia": "FONTINELE, CLASCY E IACI",
          "enfermeiroNoite": "ALEXCIANA",
          "tecnicosNoite": "FONTINELE, CLASCY E IACI",
          "faltosos": ""
        },
        "beds": [
          {
            "id": 231,
            "enfermaria": "ENF. 230",
            "status": "OCUPADO",
            "admissao": "2026-03-20",
            "nome": "MARIA JOANA DA SILVA",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "FISIO/UMIDIFICAR TRAQUEOSTOMIA",
            "pendencias": "NEURO",
            "nir": "NEURO",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 232,
            "enfermaria": "ENF. 230",
            "status": "LIVRE",
            "admissao": "",
            "nome": "",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 233,
            "enfermaria": "ENF. 230",
            "status": "OCUPADO",
            "admissao": "2026-04-08",
            "nome": "MARIA RAIMUNDA DOS SANTOS",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "PNM",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 234,
            "enfermaria": "ENF. 230",
            "status": "LIVRE",
            "admissao": "",
            "nome": "",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 235,
            "enfermaria": "ENF. 230",
            "status": "OCUPADO",
            "admissao": "2026-04-01",
            "nome": "MARIA SILVA COSTA",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 236,
            "enfermaria": "ENF. 240",
            "status": "BLOQUEADO",
            "admissao": "",
            "nome": "",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "Manutencao",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 237,
            "enfermaria": "ENF. 240",
            "status": "RESERVADO",
            "admissao": "",
            "nome": "",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "Pre-cirurgia",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 238,
            "enfermaria": "ENF. 240",
            "status": "EXTRA",
            "admissao": "",
            "nome": "",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 239,
            "enfermaria": "ENF. 240",
            "status": "OCUPADO",
            "admissao": "2026-04-05",
            "nome": "JOAO PEREIRA",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "Pneumonia",
            "pendencias": "",
            "nir": "",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          },
          {
            "id": 240,
            "enfermaria": "ENF. 240",
            "status": "OCUPADO",
            "admissao": "2026-04-07",
            "nome": "ANTONIO SOUZA",
            "cpf": "",
            "birthDate": "",
            "diagnostico": "AVC",
            "pendencias": "Tomografia",
            "nir": "NEURO",
            "procedimentos": [],
            "pendenciasHistorico": [],
            "procedimentosHistorico": []
          }
        ]
      }
    ]
  }'::jsonb
)
on conflict (id) do nothing;

update public.app_state
set
  payload = coalesce(payload, data),
  data = coalesce(data, payload),
  updated_at = timezone('utc', now())
where id = 'main';

commit;
