import { describe, expect, it } from 'vitest';

import {
  MIN_TERMO_DE_BUSCA,
  ramosDaBuscaDeContato,
  ramosDaBuscaNaTabela,
  temCaraDeTelefone,
  variantesDoTermoTelefonico,
} from './busca-remota';
import { variantesDoNonoDigito } from './telefone';

describe('variantesDoTermoTelefonico', () => {
  it('não inventa nada para termo sem dígito', () => {
    expect(variantesDoTermoTelefonico('')).toEqual([]);
  });

  // Os seis jeitos de digitar o mesmo celular, com e sem o nono dígito.
  // A forma digitada vem SEMPRE primeiro.
  it.each([
    ['DDI + DDD + 9', '5583980000016', '558380000016'],
    ['DDI + DDD', '558380000016', '5583980000016'],
    ['DDD + 9', '83980000016', '8380000016'],
    ['DDD', '8380000016', '83980000016'],
    ['local com 9', '980000016', '80000016'],
    ['local sem 9', '80000016', '980000016'],
  ])('%s: acha as duas grafias', (_caso, digitado, irma) => {
    expect(variantesDoTermoTelefonico(digitado)).toEqual([digitado, irma]);
  });

  it('fixo não ganha irmã — o 9 só foi acrescentado a celular', () => {
    expect(variantesDoTermoTelefonico('551133334444')).toEqual(['551133334444']);
    expect(variantesDoTermoTelefonico('33334444')).toEqual(['33334444']);
  });

  it('prefixo curto sai sozinho — o ilike por substring já cobre os dois', () => {
    expect(variantesDoTermoTelefonico('5583')).toEqual(['5583']);
  });

  it('fragmento que termina no meio do número sai sozinho (limite escrito)', () => {
    // Documentado em `busca-remota.ts`: a régua é ancorada no FIM.
    expect(variantesDoTermoTelefonico('3980000')).toEqual(['3980000']);
  });

  // ⚠️ O PINO que mantém as duas réguas de acordo. `variantesDoNonoDigito`
  // gera as grafias sobre o número do CONTATO (filtro em JS); esta gera
  // sobre o TERMO (filtro no banco). Se elas discordarem, a mesma busca
  // passa a achar o cliente numa tela e não na outra — que é o defeito que
  // o operador relata como "sumiu do CRM".
  //
  // O pino cobre só o BRASILEIRO COMPLETO (DDI 55, 12 ou 13 dígitos), que é
  // a forma que `contacts.phone` guarda e o único terreno comum: a função
  // daqui também responde por fragmento sem DDI, onde a outra nem tenta.
  it.each([
    '5583980000016',
    '558380000016',
    '5511999998888',
    '551199998888',
    '551133334444',
  ])('concorda com variantesDoNonoDigito em %s', (numero) => {
    expect(variantesDoTermoTelefonico(numero).slice().sort()).toEqual(
      variantesDoNonoDigito(numero).slice().sort()
    );
  });
});

describe('ramosDaBuscaDeContato', () => {
  it('devolve null abaixo do piso — "não consulte", não "não achei"', () => {
    expect(ramosDaBuscaDeContato('a')).toBeNull();
    expect(ramosDaBuscaDeContato('   ')).toBeNull();
    expect('ab'.length).toBe(MIN_TERMO_DE_BUSCA);
    expect(ramosDaBuscaDeContato('ab')).not.toBeNull();
  });

  it('busca por nome e pelo @ do Instagram — a ficha do Direct não tem telefone', () => {
    const ramos = ramosDaBuscaDeContato('ana')!;
    expect(ramos).toContain('name.imatch."ana"');
    expect(ramos).toContain('instagram_username.imatch."ana"');
  });

  it('o @ digitado não entra na comparação — a coluna guarda sem ele', () => {
    const ramos = ramosDaBuscaDeContato('@joana')!;
    expect(ramos).toContain('instagram_username.imatch."joana"');
    expect(ramos).toContain('wa_username.imatch."joana"');
  });

  it('busca pelo @ do WhatsApp — a ficha só-BSUID não tem telefone (Fase 11.4)', () => {
    const ramos = ramosDaBuscaDeContato('ana.silva')!;
    // O ponto do @ é literal: sem o escape, casaria "anaXsilva".
    expect(ramos).toContain('wa_username.imatch."ana\\\\.silva"');
  });

  it('"@" sozinho fica abaixo do piso — não consulta (a agulha do @ seria vazia)', () => {
    expect(ramosDaBuscaDeContato('@')).toBeNull();
    expect(ramosDaBuscaDeContato('@ ')).toBeNull();
  });

  it('termo sem dígito não gera ramo de telefone', () => {
    // A agulha vazia: `%%` casaria todo telefone da conta.
    expect(ramosDaBuscaDeContato('ana')).not.toContain('phone_normalized.');
  });

  it('telefone mascarado vira dígito, nas duas grafias do nono', () => {
    const ramos = ramosDaBuscaDeContato('(83) 98000-0016')!;
    expect(ramos).toContain('phone_normalized.imatch."83980000016"');
    expect(ramos).toContain('phone_normalized.imatch."8380000016"');
  });

  it('⚠️ o ramo de telefone é SEMPRE sobre a coluna gerada, nunca sobre `phone`', () => {
    // `phone` guarda o que foi DIGITADO: o formulário de contato preserva a
    // pontuação, e em "+55 (83) 98000-0016" os dígitos não são contíguos —
    // um padrão de dígitos nunca casa. A ficha sem nome fica inalcançável
    // pelos dois seletores. Medido: 1 dos 1.214 contatos da produção já está
    // assim. `phone_normalized` é coluna gerada e só tem dígitos (022).
    const ramos = ramosDaBuscaDeContato('98000-0016')!;
    for (const ramo of ramos.split(',')) {
      expect(ramo.startsWith('phone.')).toBe(false);
    }
    expect(ramos).toContain('phone_normalized.imatch');
  });

  it('os ramos são separados por vírgula, como o .or() espera', () => {
    // O termo perigoso viaja inteiro dentro das aspas: a vírgula que separa
    // os ramos é só a que este módulo escreveu.
    const ramos = ramosDaBuscaDeContato('silva, jr')!;
    expect(ramos.split('","').length).toBe(1);
    expect(ramos).toBe(
      'name.imatch."silva, jr",wa_username.imatch."silva, jr",instagram_username.imatch."silva, jr"',
    );
  });

  it('⚠️ `*`, `%` e `_` são literais — o `*` do ilike virava curinga (26/09/2026)', () => {
    // "L*K*A" é o nome de um cliente real: pelo ilike ele trazia 37 fichas.
    // O ramo do NOME conferido inteiro: `toContain` casaria dentro de
    // `wa_username.imatch…` e deixaria o nome sem escape passar.
    const nome = (termo: string) => ramosDaBuscaDeContato(termo)!.split(',')[0];
    expect(nome('l*k*a')).toBe('name.imatch."l\\\\*k\\\\*a"');
    expect(nome('50%')).toBe('name.imatch."50%"');
    expect(nome('a_b')).toBe('name.imatch."a_b"');
  });

  it('⚠️ a saída dos SELETORES não muda com a busca da tabela (porte #679, 17/11/2026)', () => {
    // Os seletores de cliente (negócio, tarefa, agenda) seguem a régua de
    // antes: a busca da tela de Contatos ganhou função própria
    // (`ramosDaBuscaNaTabela`), montada com as mesmas peças. A fotografia foi
    // tirada ANTES de separar as peças.
    const termos = [
      'ab',
      'ana',
      '@joana',
      'ana.silva',
      '(83) 98000-0016',
      '98000-0016',
      '+55 83 8000-0016',
      '5583980000016',
      'silva, jr',
      'l*k*a',
      'joao123@gmail.com',
      'Maria 2',
    ];
    expect(Object.fromEntries(termos.map((t) => [t, ramosDaBuscaDeContato(t)]))).toMatchInlineSnapshot(`
      {
        "(83) 98000-0016": "name.imatch."\\\\(83\\\\) 98000-0016",wa_username.imatch."\\\\(83\\\\) 98000-0016",instagram_username.imatch."\\\\(83\\\\) 98000-0016",phone_normalized.imatch."83980000016",phone_normalized.imatch."8380000016"",
        "+55 83 8000-0016": "name.imatch."\\\\+55 83 8000-0016",wa_username.imatch."\\\\+55 83 8000-0016",instagram_username.imatch."\\\\+55 83 8000-0016",phone_normalized.imatch."558380000016",phone_normalized.imatch."5583980000016"",
        "5583980000016": "name.imatch."5583980000016",wa_username.imatch."5583980000016",instagram_username.imatch."5583980000016",phone_normalized.imatch."5583980000016",phone_normalized.imatch."558380000016"",
        "98000-0016": "name.imatch."98000-0016",wa_username.imatch."98000-0016",instagram_username.imatch."98000-0016",phone_normalized.imatch."980000016",phone_normalized.imatch."80000016"",
        "@joana": "name.imatch."@joana",wa_username.imatch."joana",instagram_username.imatch."joana"",
        "Maria 2": "name.imatch."Maria 2",wa_username.imatch."Maria 2",instagram_username.imatch."Maria 2",phone_normalized.imatch."2"",
        "ab": "name.imatch."ab",wa_username.imatch."ab",instagram_username.imatch."ab"",
        "ana": "name.imatch."ana",wa_username.imatch."ana",instagram_username.imatch."ana"",
        "ana.silva": "name.imatch."ana\\\\.silva",wa_username.imatch."ana\\\\.silva",instagram_username.imatch."ana\\\\.silva"",
        "joao123@gmail.com": "name.imatch."joao123@gmail\\\\.com",wa_username.imatch."joao123@gmail\\\\.com",instagram_username.imatch."joao123@gmail\\\\.com",phone_normalized.imatch."123"",
        "l*k*a": "name.imatch."l\\\\*k\\\\*a",wa_username.imatch."l\\\\*k\\\\*a",instagram_username.imatch."l\\\\*k\\\\*a"",
        "silva, jr": "name.imatch."silva, jr",wa_username.imatch."silva, jr",instagram_username.imatch."silva, jr"",
      }
    `);
  });
});

describe('temCaraDeTelefone', () => {
  it('número digitado de qualquer jeito', () => {
    for (const termo of ['(83) 98874-5316', '+55 83 98874-5316', '83988745316', '8', '(83)', ' 98874.5316 ']) {
      expect(temCaraDeTelefone(termo)).toBe(true);
    }
  });

  it('e-mail, nome com número e pontuação solta não são telefone', () => {
    for (const termo of ['joao123@gmail.com', 'Maria 2', 'ana', '( )', '+', '', '83 ana']) {
      expect(temCaraDeTelefone(termo)).toBe(false);
    }
  });
});

describe('ramosDaBuscaNaTabela (tela de Contatos, porte #679)', () => {
  it('sem termo, sem filtro', () => {
    expect(ramosDaBuscaNaTabela('')).toBeNull();
    expect(ramosDaBuscaNaTabela('   ')).toBeNull();
  });

  it('⚠️ uma letra continua filtrando: a tabela não tem o piso dos seletores', () => {
    expect(ramosDaBuscaNaTabela('a')).toBe(
      'name.imatch."a",email.imatch."a",wa_username.imatch."a",instagram_username.imatch."a"',
    );
  });

  it('telefone formatado acha a ficha gravada só com dígitos, nas duas grafias do nono', () => {
    const ramos = ramosDaBuscaNaTabela('(83) 98874-5316')!;
    expect(ramos).toContain('phone_normalized.imatch."83988745316"');
    expect(ramos).toContain('phone_normalized.imatch."8388745316"');
    // Nunca contra `phone`, que guarda o que foi digitado.
    expect(ramos.split(',').some((r) => r.startsWith('phone.'))).toBe(false);
  });

  it('⚠️ e-mail com dígito NÃO vira busca de telefone (49% dos e-mails têm dígito)', () => {
    const ramos = ramosDaBuscaNaTabela('joao123@gmail.com')!;
    expect(ramos).not.toContain('phone_normalized');
    expect(ramos).toContain('email.imatch."joao123@gmail\\\\.com"');
  });

  it('nome com número também não', () => {
    expect(ramosDaBuscaNaTabela('Maria 2')).not.toContain('phone_normalized');
  });

  it('o @ acha a ficha do Direct e a só-BSUID, sem o @ digitado', () => {
    const ramos = ramosDaBuscaNaTabela('@joana')!;
    expect(ramos).toContain('wa_username.imatch."joana"');
    expect(ramos).toContain('instagram_username.imatch."joana"');
    expect(ramosDaBuscaNaTabela('@')).toBe('name.imatch."@",email.imatch."@"');
  });

  it('o termo perigoso viaja literal e inteiro (vírgula, parêntese, curinga)', () => {
    expect(ramosDaBuscaNaTabela('silva, jr')).toBe(
      'name.imatch."silva, jr",email.imatch."silva, jr",wa_username.imatch."silva, jr",instagram_username.imatch."silva, jr"',
    );
    expect(ramosDaBuscaNaTabela('l*k*a')!.split(',')[0]).toBe('name.imatch."l\\\\*k\\\\*a"');
  });
});
