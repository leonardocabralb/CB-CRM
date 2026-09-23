import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Os catálogos DA CONTA em Configurações não se recortam por `user_id`.
//
// `tags` e `message_templates` têm RLS por conta; ali `user_id` é só quem
// CRIOU. O upstream lia os dois com `.eq('user_id', user.id)`, e até
// 23/09/2026 todo membro que não era o dono via o catálogo VAZIO (medido: as
// 17 etiquetas e os 9 modelos da conta eram do dono) e "0" na visão geral.
// Um merge do upstream que traga a versão deles crua devolve o filtro sem
// conflito nem erro — o CI fica verde e a tela fica vazia. Daí o pino.
//
// E o par: com o catálogo inteiro na tela, os controles de escrita (de ADMIN
// nas policies e nas rotas) somem para quem não é admin. Sem a guarda, o
// atendente via botões que sempre falham — e no modelo o Editar sobe a imagem
// do cabeçalho antes do 403, deixando objeto órfão no bucket.
// ============================================================

const AQUI = __dirname;

/** Fonte sem comentários — os próprios avisos citam `.eq('user_id'`. */
function fonte(arquivo: string): string {
  const texto = fs.readFileSync(path.join(AQUI, arquivo), 'utf8');
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const CATALOGOS = ['tag-manager.tsx', 'template-manager.tsx', 'settings-overview.tsx'];

describe('catálogos da conta em Configurações', () => {
  it.each(CATALOGOS)('%s não recorta a leitura por user_id', (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/\.eq\(\s*['"`]user_id['"`]/);
  });

  it.each(['tag-manager.tsx', 'template-manager.tsx'])(
    '%s esconde a escrita de quem não é admin',
    (arquivo) => {
      const src = fonte(arquivo);
      expect(src).toMatch(/const podeEditar = useCan\(\s*['"]edit-settings['"]\s*\)/);
      expect(src).toMatch(/podeEditar \?/);
    },
  );

  it('template-manager guarda o cabeçalho (criar/sincronizar) E as ações por linha', () => {
    // Duas guardas distintas: a do `action` do cabeçalho (seletor de WABA,
    // Sincronizar, Novo modelo) e a dos botões de cada cartão (Editar,
    // Reenviar, lixeira). Uma não cobre a outra.
    const src = fonte('template-manager.tsx');
    expect(src).toMatch(/podeEditar \? \(\s*<div className="flex items-center gap-2">/);
    expect(src).toMatch(
      /podeEditar \? \(\s*<div className="flex items-center gap-1 shrink-0 ml-2">/,
    );
  });

  it('tag-manager confere o rowcount do DELETE e mede o motivo do zero', () => {
    const src = fonte('tag-manager.tsx');
    expect(src).toMatch(/\.delete\(\{\s*count:\s*'exact'\s*\}\)/);
    expect(src).toMatch(/lerExclusao\(/);
  });
});
