-- Cores centralizadas: legendas do mapa da Execução M.O. (Revistoria · Cliente) editáveis pelo Admin.
--
-- Reaproveita a tabela public.cores_legendas (não cria outra estrutura): nova categoria "execucao_mapa", separada da
-- categoria "setor_chave" (setores do Controle de Chaves). As cores das equipes continuam em public.equipes_execucao.
-- Itens da categoria (identificadores fixos; o rótulo exibido fica no aplicativo):
--   sem_equipe          unidade em revistoria sem equipe de mão de obra
--   aprovado_sem_equipe unidade aprovada na revistoria e sem equipe
--   fora_revistoria     unidade fora da Revistoria · Cliente (no mapa da Execução M.O.)
--   liberado            marca ✓ "Liberado para execução"
--   st_em_andamento, st_finalizado, st_agendado, st_aprovado   botões de status da Execução M.O.
-- Só existe linha para a cor personalizada; sem linha = cor padrão do aplicativo (Restaurar apaga só a linha de
-- configuração). Escrita continua só pelas funções cores_legenda_salvar / cores_legenda_restaurar (administradores);
-- leitura, RLS, grants e tempo real não mudam. Só aditiva: nenhuma linha existente é alterada.

alter table public.cores_legendas drop constraint if exists cores_legendas_categoria_check;
alter table public.cores_legendas add constraint cores_legendas_categoria_check
  check (categoria in ('setor_chave', 'execucao_mapa'));

alter table public.cores_legendas drop constraint if exists cores_legendas_chave_check;
alter table public.cores_legendas add constraint cores_legendas_chave_check check (
  (categoria <> 'setor_chave' or chave in ('base', 'cx', 'asstec', 'producao', 'cliente', 'sem'))
  and (categoria <> 'execucao_mapa' or chave in ('sem_equipe', 'aprovado_sem_equipe', 'fora_revistoria', 'liberado',
                                                 'st_em_andamento', 'st_finalizado', 'st_agendado', 'st_aprovado'))
);

comment on table public.cores_legendas is
  'Cores personalizadas das legendas: categoria setor_chave (setores do Controle de Chaves, usados em todos os módulos) e categoria execucao_mapa (legendas do mapa e status da Execução M.O.). Categorias independentes. Sem linha = cor padrão. Escrita só por cores_legenda_salvar/cores_legenda_restaurar (administradores).';
