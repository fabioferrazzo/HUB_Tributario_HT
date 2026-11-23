# Scripts obsoletos — NÃO rodar

Estes scripts criavam as tabelas antigas de Avaliações (`avaliacoes` e `avaliacoes_coordenacao`), das versões 1 a 3 do módulo.

- Em 23/11/2026 essas tabelas foram apagadas com `supabase/limpeza_avaliacoes_antigas.sql`.
- A cópia de segurança está no esquema `arquivo_morto` do banco:
  - `avaliacoes_v3_backup_20261119`
  - `avaliacoes_coordenacao_v3_backup_20261119`
- O módulo Avaliações atual usa `avd_avaliacoes` e `avd_eventos`, criadas por `supabase/patch_avaliacoes_v4.sql`.

Rodar qualquer script desta pasta recriaria as tabelas antigas sem uso. Eles ficam aqui apenas como registro.
