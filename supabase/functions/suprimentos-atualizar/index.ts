// Suprimentos › "Atualizar relatório agora": dispara o mesmo robô da atualização agendada do Relatório 1187
// (workflow "UAU → Supabase" do repositório UAU-Sync, no GitHub Actions) e acompanha o resultado.
//
// Segurança: só administradores ativos do módulo Suprimentos (module_members) podem consultar ou disparar;
// a conferência é feita aqui, no servidor, a cada chamada. O token do GitHub fica nos secrets da função.
// Execuções simultâneas: uma execução manual ativa por vez (índice único em robo_execucoes_manuais) e
// nenhuma se o workflow já estiver na fila ou rodando (inclusive a agendada). O workflow ainda tem
// "concurrency: uau-sync", então duas execuções nunca entram no portal ao mesmo tempo.
//
// Secrets: UAU_SYNC_GITHUB_TOKEN (token do GitHub com permissão Actions: leitura e escrita no UAU-Sync).
// Opcionais: UAU_SYNC_REPO (GitRoniel/UAU-Sync), UAU_SYNC_WORKFLOW (uau-sync.yml), UAU_SYNC_REF (main).
import { withSupabase } from 'npm:@supabase/server@1.5.3'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.115.0/cors'

const MODULO = 'suprimentos'
// Relatório 1187 + tela Pedidos de Compra (observações dos pedidos): as duas fontes da aba Suprimentos.
const RELATORIOS = '1187 pedidos'
const NUMEROS = { 1187: 'Relatório 1187', 9001: 'Pedidos de Compra' } as Record<number, string>
const REPO = Deno.env.get('UAU_SYNC_REPO') ?? 'GitRoniel/UAU-Sync'
const WORKFLOW = Deno.env.get('UAU_SYNC_WORKFLOW') ?? 'uau-sync.yml'
const REF = Deno.env.get('UAU_SYNC_REF') ?? 'main'
const TOKEN = Deno.env.get('UAU_SYNC_GITHUB_TOKEN') ?? ''
const ATIVOS = ['aguardando', 'executando']
const LIMITE_MS = 3 * 3600e3        // o workflow tem timeout de 90 min + 10 min de nova tentativa
const SEM_RUN_MS = 10 * 60e3        // tempo para o GitHub criar a execução depois do disparo

type Row = {
  id: number; relatorios: string; status: string; solicitado_por: string | null; solicitado_email: string
  solicitado_em: string; iniciado_em: string | null; finalizado_em: string | null
  github_run_id: number | null; github_run_url: string | null; detalhe: string | null
}
type Run = { id: number; html_url: string; status: string; conclusion: string | null; event: string; head_branch: string; created_at: string; run_started_at?: string; updated_at: string }

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders })
}
const fail = (message: string, status = 400) => json({ ok: false, error: message }, status)

async function gh(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'amci-suprimentos-atualizar',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  const text = await res.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${typeof body === 'object' ? body?.message ?? '' : String(body).slice(0, 200)}`)
  return body
}

const runsDoWorkflow = async (query: string): Promise<Run[]> =>
  (await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=20&${query}`))?.workflow_runs ?? []

/** Execução do workflow na fila ou rodando agora (agendada ou manual). */
async function execucaoAtiva(): Promise<Run | null> {
  for (const status of ['in_progress', 'queued', 'waiting', 'requested', 'pending']) {
    const runs = await runsDoWorkflow(`status=${status}`)
    if (runs.length) return runs[0]
  }
  return null
}

/** Resumo do que o robô gravou em pedidos_execucoes desde o pedido (linhas ou motivo da falha). */
async function resumoRobo(supabaseAdmin: any, desde: string) {
  const { data } = await supabaseAdmin.from('pedidos_execucoes')
    .select('relatorio,status,linhas,erro,iniciado_em')
    .in('relatorio', Object.keys(NUMEROS).map(Number))
    .gte('iniciado_em', desde)
    .order('iniciado_em', { ascending: true })
  const ultimo = new Map<number, any>()
  for (const e of data ?? []) ultimo.set(e.relatorio, e)
  const partes = [...ultimo.values()].map((e) => {
    const nome = NUMEROS[e.relatorio] ?? `Relatório ${e.relatorio}`
    if (e.status === 'sucesso') return `${nome}: ${Number(e.linhas ?? 0).toLocaleString('pt-BR')} linhas gravadas`
    if (e.status === 'erro') return `${nome}: falhou — ${String(e.erro ?? 'sem detalhe').slice(0, 400)}`
    return `${nome}: em andamento`
  })
  return { partes, falhou: [...ultimo.values()].some((e) => e.status === 'erro'), vazio: ultimo.size === 0 }
}

/** Atualiza uma execução manual ativa com a situação do GitHub Actions e do robô. */
async function atualizar(supabaseAdmin: any, row: Row): Promise<Row> {
  if (!ATIVOS.includes(row.status)) return row
  const patch: Partial<Row> & { atualizado_em: string } = { atualizado_em: new Date().toISOString() }
  const idade = Date.now() - new Date(row.solicitado_em).getTime()
  try {
    let run: Run | null = null
    if (row.github_run_id) run = await gh(`/actions/runs/${row.github_run_id}`)
    else {
      // o disparo não devolve o id: procura a execução manual criada logo depois do pedido
      // (ignora execuções já ligadas a pedidos anteriores)
      const desde = new Date(new Date(row.solicitado_em).getTime() - 60e3).toISOString()
      const { data: usados } = await supabaseAdmin.from('robo_execucoes_manuais').select('github_run_id')
        .eq('modulo', MODULO).order('solicitado_em', { ascending: false }).limit(50)
      const ja = new Set((usados ?? []).map((u: { github_run_id: number | null }) => u.github_run_id).filter(Boolean))
      const runs = (await runsDoWorkflow(`event=workflow_dispatch&branch=${encodeURIComponent(REF)}&created=>=${desde}`))
        .filter((r) => r.created_at >= desde && !ja.has(r.id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
      run = runs[0] ?? null
      if (run) { patch.github_run_id = run.id; patch.github_run_url = run.html_url }
      else if (idade > SEM_RUN_MS) {
        patch.status = 'erro'; patch.finalizado_em = patch.atualizado_em
        patch.detalhe = 'O GitHub não iniciou a execução do robô em 10 minutos. Tente de novo.'
      }
    }
    if (run) {
      if (run.status === 'completed') {
        const robo = await resumoRobo(supabaseAdmin, row.solicitado_em)
        const ok = run.conclusion === 'success' && !robo.falhou
        patch.status = ok ? 'concluido' : 'erro'
        patch.finalizado_em = run.updated_at
        patch.iniciado_em = row.iniciado_em ?? run.run_started_at ?? run.created_at
        patch.detalhe = (robo.partes.length ? robo.partes.join(' · ')
          : ok ? 'Concluído.' : `O robô terminou com "${run.conclusion}" sem registrar a execução.`).slice(0, 2000)
      } else if (run.status === 'in_progress') {
        patch.status = 'executando'
        patch.iniciado_em = row.iniciado_em ?? run.run_started_at ?? run.created_at
      } else patch.status = 'aguardando'
    }
    if (ATIVOS.includes(patch.status ?? row.status) && idade > LIMITE_MS) {
      patch.status = 'erro'; patch.finalizado_em = patch.atualizado_em
      patch.detalhe = 'A execução passou de 3 horas sem terminar. Confira o robô no GitHub Actions.'
    }
  } catch (err) {
    // falha de comunicação com o GitHub: mantém a situação e tenta de novo na próxima consulta
    patch.detalhe = `Não foi possível consultar o GitHub agora (${(err as Error).message}).`.slice(0, 2000)
  }
  const { data, error } = await supabaseAdmin.from('robo_execucoes_manuais').update(patch).eq('id', row.id).select('*').single()
  return error ? row : data
}

const handleRequest = withSupabase({ auth: 'user' }, async (req, ctx) => {
  if (req.method !== 'POST') return fail('Método não permitido.', 405)
  let body: { action?: string } = {}
  try { body = await req.json() } catch { return fail('JSON inválido.') }

  const callerId = String(ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? '')
  if (!callerId) return fail('Sessão inválida.', 401)
  // Administrador de Suprimentos, conferido no servidor (não confia no que a tela mostra).
  const { data: membro } = await ctx.supabaseAdmin.from('module_members')
    .select('role,active').eq('user_id', callerId).eq('module', MODULO).maybeSingle()
  if (!membro?.active || membro.role !== 'admin') return fail('Acesso restrito a administradores de Suprimentos.', 403)

  const ultima = async (): Promise<Row | null> => {
    const { data } = await ctx.supabaseAdmin.from('robo_execucoes_manuais').select('*')
      .eq('modulo', MODULO).order('solicitado_em', { ascending: false }).limit(1).maybeSingle()
    return data ?? null
  }

  if (body.action === 'status') {
    let row = await ultima()
    if (row && TOKEN) row = await atualizar(ctx.supabaseAdmin, row)
    return json({ ok: true, configurado: !!TOKEN, execucao: row })
  }

  if (body.action !== 'run') return fail('Ação inválida.')
  if (!TOKEN) return fail('A execução manual ainda não foi configurada (falta o token do GitHub na função).', 503)

  // pedido anterior ainda ativo? atualiza a situação antes de recusar
  const anterior = await ultima()
  if (anterior && ATIVOS.includes(anterior.status)) {
    const atual = await atualizar(ctx.supabaseAdmin, anterior)
    if (ATIVOS.includes(atual.status)) return json({ ok: false, error: 'Já existe uma atualização manual em andamento.', execucao: atual }, 409)
  }
  let ativa: Run | null = null
  try { ativa = await execucaoAtiva() } catch (err) { return fail(`Não foi possível consultar o GitHub: ${(err as Error).message}`, 502) }
  if (ativa) {
    return fail(`O robô já está ${ativa.status === 'in_progress' ? 'rodando' : 'na fila'} (${ativa.event === 'schedule' ? 'atualização agendada' : 'execução manual'}). Aguarde terminar.`, 409)
  }

  const { data: perfil } = await ctx.supabaseAdmin.from('profiles').select('email').eq('id', callerId).maybeSingle()
  const { data: row, error: insErr } = await ctx.supabaseAdmin.from('robo_execucoes_manuais')
    .insert({ modulo: MODULO, relatorios: RELATORIOS, solicitado_por: callerId, solicitado_email: perfil?.email ?? String(ctx.userClaims?.email ?? '') })
    .select('*').single()
  if (insErr) {
    if ((insErr as any).code === '23505') return fail('Já existe uma atualização manual em andamento.', 409)
    return fail('Não foi possível registrar o pedido.', 500)
  }

  try {
    // mesmo workflow da atualização agendada; só limita aos relatórios da aba Suprimentos
    const resp = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: REF, inputs: { relatorios: RELATORIOS }, return_run_details: true }),
    })
    const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() }
    if (resp?.workflow_run_id) {
      patch.github_run_id = resp.workflow_run_id
      patch.github_run_url = resp.html_url ?? `https://github.com/${REPO}/actions/runs/${resp.workflow_run_id}`
    }
    const { data: atual } = await ctx.supabaseAdmin.from('robo_execucoes_manuais').update(patch).eq('id', row.id).select('*').single()
    return json({ ok: true, execucao: atual ?? row })
  } catch (err) {
    const detalhe = `Não foi possível iniciar o robô: ${(err as Error).message}`.slice(0, 2000)
    await ctx.supabaseAdmin.from('robo_execucoes_manuais')
      .update({ status: 'erro', detalhe, finalizado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', row.id)
    return fail(detalhe, 502)
  }
})

export default {
  fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    return handleRequest(req)
  },
}
