// Edge Function relatorio-converter: converte o Relatório de Entrega da Unidade do Mobuss (PDF original enviado na aba
// Revistoria) no relatório compacto e guarda a nova versão no Storage, ligada ao mesmo registro do relatório.
//
// POST { relatorio_id, reprocessar? }  (usuário autenticado)
//   1. revistoria_conversao_solicitar roda como o usuário: confere o acesso de edição e evita conversões em dobro;
//   2. a conversão segue em segundo plano (EdgeRuntime.waitUntil) e a resposta volta na hora (202) com a versão;
//   3. cada etapa é gravada (revistoria_conversao_etapa) e a tela acompanha em tempo real;
//   4. o PDF compacto é enviado para <condomínio>/conversoes/<relatório>/vN.pdf e só então a versão é marcada
//      como disponível (revistoria_conversao_concluir confere o arquivo no Storage);
//   5. qualquer erro → revistoria_conversao_falhar: o original e a última versão válida ficam intactos.
// O original nunca é alterado nem apagado. Nenhuma chave sai do servidor: o service role só existe aqui.
import { withSupabase } from 'npm:@supabase/server@1.5.3'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.115.0/cors'
import * as PDFLib from 'npm:pdf-lib@1.17.1'
import { converter, ErroConversao, VERSAO_CONVERSOR } from './conversor/converter.js'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const BUCKET = 'revistorias-relatorios'

type Versao = { id: number; project_id: number; relatorio_id: number; versao: number; status: string }
// deno-lint-ignore no-explicit-any
type Cliente = any

function responder(corpo: unknown, status = 200) {
  return Response.json(corpo, { status, headers: corsHeaders })
}

async function processar(admin: Cliente, v: Versao) {
  const etapa = async (status: string) => {
    const { error } = await admin.rpc('revistoria_conversao_etapa', { p_versao_id: v.id, p_status: status })
    if (error) throw new Error(`Não foi possível registrar a etapa "${status}": ${error.message}`)
  }
  let enviado = ''
  try {
    await etapa('processando')
    const { data: rel, error: eRel } = await admin.from('revistorias_relatorios')
      .select('id,caminho,removido_em').eq('id', v.relatorio_id).single()
    if (eRel || !rel) throw new ErroConversao('Relatório não encontrado.')
    if (rel.removido_em) throw new ErroConversao('O relatório foi retirado.')
    const { data: arq, error: eArq } = await admin.storage.from(BUCKET).download(rel.caminho)
    if (eArq || !arq) throw new ErroConversao('Não foi possível ler o PDF original no armazenamento.')
    const dados = new Uint8Array(await arq.arrayBuffer())
    const { data: regras } = await admin.from('relatorio_servicos_dicionario').select('original,curto,ativo').eq('ativo', true)
    const r = await converter(PDFLib, dados, { regras: regras || [], etapa })
    const caminho = `${v.project_id}/conversoes/${v.relatorio_id}/v${v.versao}.pdf`
    const { error: eUp } = await admin.storage.from(BUCKET)
      .upload(caminho, new Blob([r.bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true })
    if (eUp) throw new Error(`Falha ao salvar o PDF convertido: ${eUp.message}`)
    enviado = caminho
    const { error: eFim } = await admin.rpc('revistoria_conversao_concluir', {
      p_versao_id: v.id, p_caminho: caminho, p_tamanho: r.bytes.length, p_paginas: r.paginas,
      p_resumo: r.resumo, p_conversor: VERSAO_CONVERSOR,
    })
    if (eFim) throw new Error(`Falha ao concluir a conversão: ${eFim.message}`)
    enviado = ''
  } catch (e) {
    const msg = e instanceof ErroConversao ? e.message : `Erro inesperado na conversão: ${(e as Error)?.message || e}`
    console.error('relatorio-converter', v.id, msg, (e as ErroConversao)?.detalhe || '')
    if (enviado) await admin.storage.from(BUCKET).remove([enviado]).catch(() => {})
    const { error } = await admin.rpc('revistoria_conversao_falhar', { p_versao_id: v.id, p_erro: msg })
    if (error) console.error('relatorio-converter: não registrou a falha', v.id, error.message)
  }
}

const tratar = withSupabase({ auth: 'user' }, async (req, ctx) => {
  if (req.method !== 'POST') return responder({ ok: false, error: 'Método não permitido.' }, 405)
  let corpo: { relatorio_id?: number; reprocessar?: boolean }
  try { corpo = await req.json() } catch { return responder({ ok: false, error: 'JSON inválido.' }, 400) }
  const relatorioId = Number(corpo.relatorio_id)
  if (!Number.isSafeInteger(relatorioId) || relatorioId <= 0) return responder({ ok: false, error: 'Relatório inválido.' }, 400)

  // Como o usuário: a função do banco confere o acesso (admin/revistorias do condomínio) e a idempotência.
  const usuario: Cliente = ctx.supabase
  const { data, error } = await usuario.rpc('revistoria_conversao_solicitar', {
    p_relatorio_id: relatorioId, p_reprocessar: corpo.reprocessar === true,
  })
  if (error) {
    const proibido = error.code === '42501' || /permite|permiss/i.test(error.message)
    return responder({ ok: false, error: error.message }, proibido ? 403 : 400)
  }
  if (data?.em_andamento || data?.ja_convertido) return responder({ ok: true, ...data })

  const v = data.versao as Versao
  const tarefa = processar(ctx.supabaseAdmin, v)
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(tarefa)
    return responder({ ok: true, iniciado: true, versao: v }, 202)
  }
  await tarefa
  return responder({ ok: true, iniciado: true, versao: v })
})

export default {
  fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    return tratar(req)
  },
}
