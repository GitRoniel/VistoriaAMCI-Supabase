-- Gestão de acessos aos módulos (somente administradores do módulo), com registro.
create or replace function public.listar_acessos_modulo(p_module text)
returns table (user_id uuid, email text, full_name text, role text, active boolean, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.email, p.full_name, mm.role, coalesce(mm.active, false), mm.updated_at
    from public.profiles p
    left join public.module_members mm on mm.user_id = p.id and mm.module = p_module
   where (select auth.uid()) is not null and private.is_module_admin(p_module)
   order by coalesce(mm.active, false) desc, lower(p.full_name), lower(p.email)
$$;

-- p_role: 'leitor', 'admin' ou null para retirar o acesso.
create or replace function public.definir_acesso_modulo(p_user uuid, p_module text, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_old public.module_members;
  v_action text;
begin
  if uid is null or not private.is_module_admin(p_module) then
    raise exception 'Somente administradores do módulo podem alterar acessos.' using errcode = '42501';
  end if;
  if p_role is not null and p_role not in ('leitor', 'admin') then
    raise exception 'Nível inválido.';
  end if;
  if p_user = uid and coalesce(p_role, '') <> 'admin' then
    raise exception 'Você não pode retirar o seu próprio acesso de administrador.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Usuário não encontrado.';
  end if;
  select * into v_old from public.module_members where user_id = p_user and module = p_module;
  if p_role is null then
    if not found or not v_old.active then
      return jsonb_build_object('changed', false);
    end if;
    update public.module_members set active = false, granted_by = uid, updated_at = now()
     where user_id = p_user and module = p_module;
    v_action := 'retirar';
  else
    insert into public.module_members (user_id, module, role, active, granted_by)
    values (p_user, p_module, p_role, true, uid)
    on conflict (user_id, module) do update
      set role = excluded.role, active = true, granted_by = uid, updated_at = now();
    v_action := case when v_old.user_id is null or not v_old.active then 'conceder' else 'alterar' end;
  end if;
  insert into public.module_access_log (actor_user_id, actor_email, target_user_id, target_email, module, action, role)
  values (uid, coalesce((select email from public.profiles where id = uid), ''),
          p_user, coalesce((select email from public.profiles where id = p_user), ''),
          p_module, v_action, p_role);
  return jsonb_build_object('changed', true, 'action', v_action);
end;
$$;

revoke all on function public.listar_acessos_modulo(text) from public, anon;
revoke all on function public.definir_acesso_modulo(uuid, text, text) from public, anon;
grant execute on function public.listar_acessos_modulo(text) to authenticated;
grant execute on function public.definir_acesso_modulo(uuid, text, text) to authenticated;
