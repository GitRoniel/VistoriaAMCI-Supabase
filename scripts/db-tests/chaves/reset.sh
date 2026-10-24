#!/bin/bash
# Recria o banco local: stub do Supabase + todas as migrations do repositório (exceto as do robô ERP).
set -e
SP=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$SP/../../.." && pwd)
P="psql -h ${PGHOST:-/var/tmp} -p ${PGPORT:-55432} -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists amci" -c "create database amci" 2>/dev/null
$P -d amci -f $SP/00_stub.sql 2>/dev/null
for f in $REPO/supabase/migrations/*.sql; do
  case "$f" in *rls_erp*|*somente_leitura_erp*|*pedidos_observacoes_rls*) continue;; esac
  if [[ "$f" == *alto_do_buriti.sql ]]; then
    $P -d amci -c "insert into public.units (project_id,bloco,pav,apto) select p.id,b,pv,lpad(a::text,2,'0') from public.projects p, unnest(array['A','B','C','D','E','F','G','H']) b, unnest(array['T','1º','2º','3º','4º','5º','6º']) pv, generate_series(1,8) a where p.slug='alto-do-jeriva'"
  fi
  $P -d amci -f "$f" >/dev/null 2>&1 || { echo "FALHOU $f"; exit 1; }
done
echo "banco recriado"
