// A bancada da 4a (docs/PLANO-ligar-pelo-crm.md, §8.13): faz o papel do CRM
// para testar o computador de ligações antes de mexer no CRM. Sai quando o
// CRM assumir (4c).
//
// Roda num contêiner TEMPORÁRIO na rede LigacoesNet, publicado só no
// 127.0.0.1 da VPS (a página abre pelo túnel SSH: localhost conta como seguro
// e o navegador libera o microfone). Só Node, sem dependências.
// - recebe da máquina os avisos e as gravações (com o segredo);
// - serve a página do atendente e repassa os pedidos dela à máquina, pondo o
//   segredo no cabeçalho (o segredo nunca vai ao navegador).
// ⚠️ A página não tem senha: o contêiner só fica de pé durante a sessão de
// teste (`docker rm -f ligacoes-bancada` ao terminar).
import { createHash, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'

const SEGREDO = process.env.LIGACOES_SEGREDO ?? ''
const MAQUINA = process.env.MAQUINA ?? 'http://ligacoes-previdenciario:8080'
const GRAVACOES = '/gravacoes'
const PAGINA = new URL('./atendente.html', import.meta.url)
const ID = '[A-Za-z0-9-]{1,64}'
const ARQUIVO = '(estereo|cliente|atendente)\\.ogg'
const TETO = 20 * 1024 * 1024
const avisos = []

if (SEGREDO.length < 32) {
  console.error('falta LIGACOES_SEGREDO')
  process.exit(1)
}
const esperado = createHash('sha256').update(SEGREDO).digest()

function autorizado(pedido) {
  const cabecalho = pedido.headers.authorization ?? ''
  if (!cabecalho.startsWith('Bearer ')) return false
  return timingSafeEqual(createHash('sha256').update(cabecalho.slice(7)).digest(), esperado)
}

async function lerCorpo(pedido) {
  const partes = []
  let tamanho = 0
  for await (const parte of pedido) {
    tamanho += parte.length
    if (tamanho > TETO) throw new Error('corpo grande demais')
    partes.push(parte)
  }
  return Buffer.concat(partes)
}

function responder(resposta, status, corpo, tipo = 'application/json') {
  resposta.writeHead(status, { 'content-type': tipo, 'cache-control': 'no-store' })
  resposta.end(tipo === 'application/json' ? JSON.stringify(corpo) : corpo)
}

createServer(async (pedido, resposta) => {
  try {
    const caminho = new URL(pedido.url ?? '/', 'http://bancada').pathname

    // 1) O que a máquina manda: os avisos e as gravações, com o segredo.
    if (pedido.method === 'POST' && caminho === '/api/cb/ligacoes/eventos') {
      if (!autorizado(pedido)) return responder(resposta, 401, { erro: 'sem_autorizacao' })
      const aviso = JSON.parse((await lerCorpo(pedido)).toString('utf8'))
      avisos.push({ recebido: new Date().toISOString(), ...aviso })
      avisos.splice(0, Math.max(0, avisos.length - 300))
      console.log('aviso', JSON.stringify(aviso))
      return responder(resposta, 200, {})
    }
    const gravacao = caminho.match(new RegExp(`^/api/cb/ligacoes/gravacao/(${ID})/${ARQUIVO}$`))
    if (pedido.method === 'PUT' && gravacao) {
      if (!autorizado(pedido)) return responder(resposta, 401, { erro: 'sem_autorizacao' })
      const corpo = await lerCorpo(pedido)
      await mkdir(join(GRAVACOES, gravacao[1]), { recursive: true })
      await writeFile(join(GRAVACOES, gravacao[1], `${gravacao[2]}.ogg`), corpo)
      console.log('gravação', gravacao[1], `${gravacao[2]}.ogg`, corpo.length, 'bytes')
      return responder(resposta, 200, {})
    }

    // 2) A página do atendente (pelo túnel SSH).
    if (pedido.method === 'GET' && caminho === '/') return responder(resposta, 200, await readFile(PAGINA), 'text/html; charset=utf-8')
    if (pedido.method === 'GET' && caminho === '/avisos') return responder(resposta, 200, avisos)
    if (pedido.method === 'GET' && caminho === '/gravacoes') {
      const lista = []
      for (const ligacao of await readdir(GRAVACOES).catch(() => [])) {
        for (const nome of await readdir(join(GRAVACOES, ligacao)).catch(() => [])) lista.push(`${ligacao}/${nome}`)
      }
      return responder(resposta, 200, lista)
    }
    const ouvir = caminho.match(new RegExp(`^/gravacoes/(${ID})/${ARQUIVO}$`))
    if (pedido.method === 'GET' && ouvir) {
      return responder(resposta, 200, await readFile(join(GRAVACOES, ouvir[1], `${ouvir[2]}.ogg`)), 'audio/ogg')
    }

    // 3) Os pedidos da página, repassados à máquina com o segredo. Só da
    // própria página pelo túnel (o Host do túnel) e, nos que mudam algo, só
    // JSON: uma página de outro site aberta no mesmo navegador não faz a
    // máquina discar (o JSON exige a pergunta prévia do navegador, que esta
    // bancada nunca responde).
    const rota = caminho.match(/^\/maquina\/(estado|qr|ligar|atender|desligar)$/)
    if (rota) {
      const host = pedido.headers.host ?? ''
      if (host !== 'localhost:8091' && host !== '127.0.0.1:8091') return responder(resposta, 403, { erro: 'so_pelo_tunel' })
      if (pedido.method === 'POST' && !(pedido.headers['content-type'] ?? '').startsWith('application/json')) {
        return responder(resposta, 415, { erro: 'so_json' })
      }
      const corpo = pedido.method === 'POST' ? await lerCorpo(pedido) : undefined
      const daMaquina = await fetch(`${MAQUINA}/${rota[1]}`, {
        method: pedido.method,
        headers: { authorization: `Bearer ${SEGREDO}`, 'content-type': 'application/json' },
        body: corpo,
        signal: AbortSignal.timeout(30_000),
      })
      // O corpo da máquina já é JSON: passa como veio.
      resposta.writeHead(daMaquina.status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      return resposta.end(await daMaquina.text())
    }
    return responder(resposta, 404, { erro: 'rota_desconhecida' })
  } catch (erro) {
    console.error('bancada:', erro instanceof Error ? erro.message : String(erro))
    if (!resposta.headersSent) responder(resposta, 500, { erro: 'falhou' })
  }
}).listen(8091, '0.0.0.0', () => console.log('bancada na 8091, máquina em', MAQUINA))
