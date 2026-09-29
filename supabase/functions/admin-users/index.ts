import { withSupabase } from 'npm:@supabase/server@1.5.3'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.115.0/cors'

const ROLES = new Set(['admin', 'revistorias', 'visitante'])

type RequestBody = {
  action?: 'list' | 'save' | 'reject'
  projectId?: number
  userId?: string
  email?: string
  password?: string
  fullName?: string
  role?: string
  active?: boolean
}

function fail(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status, headers: corsHeaders })
}

const handleRequest = withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return fail('Método não permitido.', 405)

    let body: RequestBody
    try {
      body = await req.json()
    } catch {
      return fail('JSON inválido.')
    }

    const projectId = Number(body.projectId)
    const callerId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '')
    if (!Number.isSafeInteger(projectId) || projectId <= 0 || !callerId) {
      return fail('Projeto ou sessão inválida.', 401)
    }

    const { data: membership, error: membershipError } = await ctx.supabase
      .from('project_members')
      .select('role,active')
      .eq('project_id', projectId)
      .eq('user_id', callerId)
      .maybeSingle()

    if (membershipError || !membership?.active || membership.role !== 'admin') {
      return fail('Acesso restrito a administradores.', 403)
    }

    if (body.action === 'list') {
      // project_members tem duas FKs para profiles (user_id e updated_by):
      // o relacionamento precisa ser explícito, senão o PostgREST responde 300.
      const [membersResult, requestsResult] = await Promise.all([
        ctx.supabaseAdmin
          .from('project_members')
          .select('user_id,role,active,created_at,updated_at,profiles!project_members_user_id_fkey!inner(email,full_name)')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true }),
        ctx.supabaseAdmin
          .from('access_requests')
          .select('user_id,email,full_name,requested_role,status,created_at,reviewed_at')
          .eq('project_id', projectId)
          .order('created_at', { ascending: true }),
      ])

      if (membersResult.error || requestsResult.error) {
        console.error('admin-users list', membersResult.error ?? requestsResult.error)
        return fail('Não foi possível listar os usuários.', 500)
      }

      const requestsByUser = new Map((requestsResult.data ?? []).map((row) => [row.user_id, row]))
      const memberIds = new Set((membersResult.data ?? []).map((row) => row.user_id))
      const members = (membersResult.data ?? []).map((row) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
        const request = requestsByUser.get(row.user_id)
        return {
          id: row.user_id,
          email: profile?.email ?? '',
          fullName: profile?.full_name ?? '',
          role: row.role,
          active: row.active,
          pending: false,
          status: row.active ? 'approved' : 'rejected',
          createdAt: request?.created_at ?? row.created_at,
          reviewedAt: request?.reviewed_at ?? row.updated_at,
        }
      })
      // Sem vínculo em project_members o acesso nunca foi liberado; a solicitação
      // continua pendente mesmo que tenha sido marcada como aprovada manualmente.
      const requests = (requestsResult.data ?? [])
        .filter((request) => !memberIds.has(request.user_id))
        .map((request) => {
          const rejected = request.status === 'rejected'
          return {
            id: request.user_id,
            email: request.email,
            fullName: request.full_name,
            role: request.requested_role,
            active: false,
            pending: !rejected,
            status: rejected ? 'rejected' : 'pending',
            createdAt: request.created_at,
            reviewedAt: request.reviewed_at,
          }
        })

      return Response.json({ ok: true, users: [...requests, ...members] }, { headers: corsHeaders })
    }

    const targetUserId = String(body.userId ?? '').trim()

    async function ensureAnotherAdmin(userId: string, nextRole: string, nextActive: boolean) {
      const { data: oldMember, error: oldMemberError } = await ctx.supabaseAdmin
        .from('project_members')
        .select('role,active')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .maybeSingle()

      if (oldMemberError) return { error: fail('Não foi possível consultar o acesso atual.', 500), member: null }

      if (oldMember?.role === 'admin' && oldMember.active && (nextRole !== 'admin' || !nextActive)) {
        const { count, error: countError } = await ctx.supabaseAdmin
          .from('project_members')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .eq('role', 'admin')
          .eq('active', true)

        if (countError) return { error: fail('Não foi possível validar os administradores.', 500), member: null }
        if ((count ?? 0) <= 1) return { error: fail('O projeto precisa manter ao menos um administrador.'), member: null }
      }
      return { error: null, member: oldMember }
    }

    if (body.action === 'reject') {
      if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) return fail('Usuário inválido.')
      const check = await ensureAnotherAdmin(targetUserId, '', false)
      if (check.error) return check.error

      if (check.member) {
        const { error: memberError } = await ctx.supabaseAdmin
          .from('project_members')
          .update({ active: false, updated_by: callerId })
          .eq('project_id', projectId)
          .eq('user_id', targetUserId)
        if (memberError) return fail('Não foi possível bloquear o acesso.', 500)
      }

      const { error: requestError } = await ctx.supabaseAdmin
        .from('access_requests')
        .update({ status: 'rejected', reviewed_by: callerId, reviewed_at: new Date().toISOString() })
        .eq('project_id', projectId)
        .eq('user_id', targetUserId)

      if (requestError) return fail('Não foi possível rejeitar a solicitação.', 500)
      return Response.json({ ok: true, userId: targetUserId }, { headers: corsHeaders })
    }

    if (body.action !== 'save') return fail('Ação inválida.')

    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const fullName = String(body.fullName ?? '').trim()
    const role = String(body.role ?? '').trim().toLowerCase()
    const active = body.active !== false

    if (!/^\S+@\S+\.\S+$/.test(email)) return fail('Informe um e-mail válido.')
    if (!ROLES.has(role)) return fail('Nível de acesso inválido.')

    // `_` e `%` são curingas no ILIKE; escapa para comparar o e-mail literalmente.
    const profileQuery = ctx.supabaseAdmin.from('profiles').select('id,email')
    const { data: existingProfile, error: profileLookupError } = await (
      /^[0-9a-f-]{36}$/i.test(targetUserId)
        ? profileQuery.eq('id', targetUserId)
        : profileQuery.ilike('email', email.replace(/[\\%_]/g, (c) => '\\' + c))
    ).maybeSingle()

    if (profileLookupError) return fail('Não foi possível consultar o usuário.', 500)
    if (!existingProfile && password.length < 8) {
      return fail('Novos usuários precisam de senha com pelo menos 8 caracteres.')
    }
    if (password && password.length < 8) {
      return fail('A senha precisa ter pelo menos 8 caracteres.')
    }

    let userId = existingProfile?.id as string | undefined

    if (!userId) {
      const { data: created, error: createError } = await ctx.supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (createError || !created.user) {
        return fail(createError?.message ?? 'Não foi possível criar o usuário.', 500)
      }
      userId = created.user.id
    } else {
      const attributes: { password?: string; user_metadata: { full_name: string } } = {
        user_metadata: { full_name: fullName },
      }
      if (password) attributes.password = password
      const { error: authUpdateError } = await ctx.supabaseAdmin.auth.admin.updateUserById(
        userId,
        attributes,
      )
      if (authUpdateError) return fail('Não foi possível atualizar a conta.', 500)
    }

    const check = await ensureAnotherAdmin(userId, role, active)
    if (check.error) return check.error

    const { error: profileError } = await ctx.supabaseAdmin
      .from('profiles')
      .upsert({ id: userId, email, full_name: fullName }, { onConflict: 'id' })

    if (profileError) return fail('A conta foi criada, mas o perfil não pôde ser salvo.', 500)

    const { error: accessError } = await ctx.supabaseAdmin
      .from('project_members')
      .upsert(
        { project_id: projectId, user_id: userId, role, active, updated_by: callerId },
        { onConflict: 'project_id,user_id' },
      )

    if (accessError) return fail('A conta foi criada, mas o acesso ao projeto não pôde ser salvo.', 500)

    const { error: requestError } = await ctx.supabaseAdmin
      .from('access_requests')
      .update({
        status: active ? 'approved' : 'rejected',
        reviewed_by: callerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('project_id', projectId)
      .eq('user_id', userId)

    if (requestError) return fail('O acesso foi salvo, mas a solicitação não pôde ser concluída.', 500)

    return Response.json({ ok: true, userId }, { headers: corsHeaders })
})

export default {
  fetch(req: Request) {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders })
    }
    return handleRequest(req)
  },
}
