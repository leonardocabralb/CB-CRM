import { describe, expect, it } from 'vitest';

import { tipoDoDocumento } from './tipo-de-documento';

describe('tipoDoDocumento', () => {
  it('pela extensão do nome, em maiúsculas', () => {
    expect(tipoDoDocumento('Extrato_marco.pdf', null)).toEqual({ rotulo: 'PDF', familia: 'pdf' });
    expect(tipoDoDocumento('Parcelas.XLSX', null)).toEqual({ rotulo: 'XLSX', familia: 'planilha' });
    expect(tipoDoDocumento('contrato social.docx', null)).toEqual({ rotulo: 'DOCX', familia: 'texto' });
    expect(tipoDoDocumento('base.csv', null)).toEqual({ rotulo: 'CSV', familia: 'planilha' });
    expect(tipoDoDocumento('slides.pptx', null)).toEqual({ rotulo: 'PPTX', familia: 'apresentacao' });
    expect(tipoDoDocumento('docs.rar', null)).toEqual({ rotulo: 'RAR', familia: 'compactado' });
  });

  it('o nome vence o MIME: é o que o operador lê ao lado do selo', () => {
    expect(tipoDoDocumento('contrato.pdf', 'application/octet-stream')).toEqual({ rotulo: 'PDF', familia: 'pdf' });
  });

  it('sem extensão no nome, cai no MIME (com parâmetros)', () => {
    expect(tipoDoDocumento('Documento', 'application/pdf; charset=binary')).toEqual({ rotulo: 'PDF', familia: 'pdf' });
    expect(
      tipoDoDocumento(null, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ).toEqual({ rotulo: 'XLSX', familia: 'planilha' });
  });

  it('tipo que não se reconhece: família "outro", com a extensão quando cabe', () => {
    expect(tipoDoDocumento('Consulta Processual.html', 'text/html')).toEqual({ rotulo: 'HTML', familia: 'outro' });
    expect(tipoDoDocumento('certificado.pfx', null)).toEqual({ rotulo: 'PFX', familia: 'outro' });
  });

  it('nada que revele o tipo: rótulo vazio (o selo mostra o ícone)', () => {
    expect(tipoDoDocumento('Documento', null)).toEqual({ rotulo: '', familia: 'outro' });
    expect(tipoDoDocumento(undefined, 'application/octet-stream')).toEqual({ rotulo: '', familia: 'outro' });
  });

  it('o .bin do nome sintetizado não é tipo: ícone genérico, ou o MIME quando há', () => {
    expect(tipoDoDocumento('whatsapp-document-20261001-120000.bin', null)).toEqual({ rotulo: '', familia: 'outro' });
    expect(tipoDoDocumento('whatsapp-document-20261001-120000.bin', 'application/octet-stream')).toEqual({
      rotulo: '',
      familia: 'outro',
    });
    expect(tipoDoDocumento('arquivo.bin', 'application/pdf')).toEqual({ rotulo: 'PDF', familia: 'pdf' });
  });

  it('extensão longa demais para o selo não vira rótulo', () => {
    expect(tipoDoDocumento('copia.backup', null)).toEqual({ rotulo: '', familia: 'outro' });
    expect(tipoDoDocumento('copia.backup', 'application/pdf')).toEqual({ rotulo: 'PDF', familia: 'pdf' });
  });
});
