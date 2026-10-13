#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sentinela do WhatsApp — roda NA VPS, de hora em hora (cron), e avisa no sino
do CRM. Instalação, arquivos e como desligar: docs/INFRA-VPS.md, seção 12.

Cada execução:
1. COLETA: lê o log da Evolution, o do CRM e o do agendador desde a execução
   anterior (inclusive o dos contêineres parados) e guarda só o TIPO de cada
   linha de erro/aviso, com contagem, em coleta/AAAA-MM-DD.jsonl. O log da
   Evolution cobre poucas horas (~6 h em 13/10/2026) e o do CRM some a cada
   deploy: a varredura semanal lê estes arquivos.
2. CHECAGENS, só leitura (banco da Evolution em transação read-only, Docker,
   Redis e o PostgREST do CRM): serviço sem réplica, memória, disco e
   conexão rodam MESMO sem o banco; conexão aberta sem receber, mensagem que
   a Evolution recebeu e o CRM não gravou (conferida pelo id), falha real de
   entrega, mensagem descartada antes do banco da Evolution (o caso da sessão
   '.99') e sessão legada '.99'. Medição que falha 3 vezes seguidas também
   vira aviso ("a sentinela não consegue medir").
3. AVISO: problema NOVO vira notificação 'whatsapp_alert' (1085) para quem é
   owner/admin da conta, gravada pelo PostgREST com a service role do
   /root/crm.env. Um aviso por problema, lembrete a cada 24 h enquanto durar
   e "Normalizou" quando passa; evento (mensagem descartada) no máximo a cada
   6 h, guardado para a próxima execução se o sino recusar.

Escreve SÓ em /root/saude-whatsapp e na tabela notifications. Nunca imprime
segredo, telefone nem conteúdo de mensagem.

Modos:
  (sem argumento)  o do cron: coleta, checa, avisa e grava o estado.
  --simular        checa e mostra o que avisaria; não grava NADA (nem estado,
                   nem coleta, nem aviso). Serve para conferir por ssh:
                   ssh root@<vps> 'python3 - --simular' < sentinela.py
  --teste-aviso    manda UM aviso de teste aos administradores.

Python 3.8 (Ubuntu 20.04), só biblioteca padrão.
"""
import collections
import datetime
import fcntl
import glob
import http.client
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PASTA = '/root/saude-whatsapp'
ARQ_ESTADO = os.path.join(PASTA, 'estado.json')
PASTA_COLETA = os.path.join(PASTA, 'coleta')
ARQ_TRAVA = os.path.join(PASTA, '.trava')
ARQ_LOG = os.path.join(PASTA, 'sentinela.log')
CRM_ENV = '/root/crm.env'

# O Brasil não tem horário de verão desde 2019: UTC-3 fixo.
BRT = datetime.timezone(datetime.timedelta(hours=-3))
UTC = datetime.timezone.utc

TIPO_DO_AVISO = 'whatsapp_alert'
LEMBRETE_H = 24
INTERVALO_DE_EVENTO_H = 6
DIAS_DE_COLETA = 90
COLETA_MAXIMA_H = 26
RECHECAGEM_S = 60
# Medição que falha (banco fora, consulta quebrada) em N execuções seguidas
# vira aviso: "não medido" calado no log local é a sentinela cega.
CEGA_DEPOIS_DE = 3

# Os serviços de que o WhatsApp e o CRM dependem. Os outros do Swarm (n8n,
# Typebot, Portainer…) ficam só na varredura semanal: um serviço de terceiros
# em laço viraria aviso diário no sino do CRM.
SERVICOS_VIGIADOS = ('crm_crm', 'crm_agendador', 'evolution_evolution',
                     'postgres_postgres', 'redis_redis', 'traefik_traefik')

# "Aberta sem receber": em dia útil, com a janela de 2 h inteira entre 8h e
# 20h, nenhuma mensagem de cliente e pelo menos 5 nossas saindo pela conexão.
# Calibrada em 13/10/2026 contra 5 semanas de histórico: disparou 3 vezes, 2
# delas no incidente real de 16/09 (a fila de entrada presa). Sem exigir
# saídas, a regra dispararia em todo dia parado e em todo feriado.
JANELA_SEM_ENTRADA_H = 2
SAIDAS_MINIMAS = 5
# "A Evolution recebeu e o CRM não gravou": as mensagens de cliente das
# últimas 2 h (com mais de 10 min) conferidas PELO ID em `messages.message_id`
# — exato, e pega também a perda parcial que a fronteira de entrega (1002)
# não vê.
JANELA_DE_CONFERENCIA_H = 2
IDADE_MINIMA_S = 600
NAO_GRAVADAS_MINIMAS = 3
FALHAS_MINIMAS = 3
DISCO_MAXIMO = 85
MEMORIA_MINIMA_MB = 300
HORA_DA_VARREDURA_99 = 10

# Tipos que a Evolution grava em "Message" e o CRM descarta de propósito
# (reação, controle, abertura de álbum, cópia auxiliar, a EDIÇÃO cifrada que
# só carimba `edited_at`): não são mensagem "perdida" quando faltam no CRM.
TIPOS_SEM_CONTEUDO = (
    'reactionMessage', 'encReactionMessage', 'protocolMessage', 'albumMessage',
    'secretEncryptedMessage',
    'associatedChildMessage', 'pollUpdateMessage', 'senderKeyDistributionMessage',
    'messageContextInfo', 'keepInChatMessage', 'pinInChatMessage', 'editedMessage',
)
# 1:1 de verdade: fora grupo, status, lista de transmissão e canal.
FILTRO_1A1 = (
    "coalesce(m.key->>'remoteJid', '') not like '%@g.us' "
    "and coalesce(m.key->>'remoteJid', '') not like '%@broadcast' "
    "and coalesce(m.key->>'remoteJid', '') not like '%@newsletter'"
)

SEP = '\x1f'
AGORA = datetime.datetime.now(UTC)


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------

def iso(dt):
    return dt.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def de_iso(texto):
    """Instante gravado por esta sentinela ou pelo banco, sempre em UTC."""
    return datetime.datetime.strptime(texto[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=UTC)


def quando(dt):
    """'13:36' hoje; '12/10 às 13:36' noutro dia (horário de Brasília)."""
    local = dt.astimezone(BRT)
    if local.date() != AGORA.astimezone(BRT).date():
        return local.strftime('%d/%m às %H:%M')
    return local.strftime('%H:%M')


def quando_com_preposicao(dt):
    """'às 13:36' hoje; 'em 12/10 às 13:36' noutro dia."""
    texto = quando(dt)
    return ('em ' + texto) if '/' in texto else ('às ' + texto)


def rodar(args, timeout=60, entrada=None):
    # Sem entrada, o filho NÃO herda o stdin: no --simular o programa chega
    # por ele (python3 - < sentinela.py).
    extra = {'input': entrada} if entrada is not None else {'stdin': subprocess.DEVNULL}
    r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       timeout=timeout, **extra)
    if r.returncode != 0:
        erro = r.stderr.decode('utf-8', 'replace').strip().splitlines()
        raise RuntimeError('%s %s saiu com %d: %s' % (
            args[0], args[1], r.returncode, (erro[-1] if erro else '')[:200]))
    return r.stdout.decode('utf-8', 'replace')


def sem_segredo(texto):
    """Corta qualquer bloco longo (chave, token) antes de ir para o log."""
    return re.sub(r'[A-Za-z0-9._\-+/=]{30,}', '<omitido>', str(texto))[:300]


def conteineres(nome, todos=False):
    args = ['docker', 'ps', '-q', '--no-trunc', '-f', 'name=' + nome]
    if todos:
        args.insert(2, '-a')
    return [c for c in rodar(args).split() if c]


def psql(pg, sql):
    """Consulta no banco `evolution`, numa transação SÓ DE LEITURA."""
    saida = rodar(['docker', 'exec', '-i', pg, 'psql', '-U', 'postgres', '-d', 'evolution',
                   '-q', '-At', '-F', SEP, '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                  timeout=90,
                  entrada=('set default_transaction_read_only = on;\n' + sql).encode('utf-8'))
    return [linha.split(SEP) for linha in saida.splitlines() if linha]


def literal(texto):
    return "'" + str(texto).replace("'", "''") + "'"


def ler_env(caminho):
    valores = {}
    with open(caminho, encoding='utf-8') as fh:
        for linha in fh:
            linha = linha.strip()
            if not linha or linha.startswith('#') or '=' not in linha:
                continue
            if linha.startswith('export '):
                linha = linha[len('export '):]
            chave, valor = linha.split('=', 1)
            valor = valor.strip()
            if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in '"\'':
                valor = valor[1:-1]
            valores[chave.strip()] = valor
    return valores


class Crm:
    """PostgREST do Supabase com a service role. Nunca imprime a chave."""

    def __init__(self, env):
        self.base = env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/') + '/rest/v1/'
        self.chave = env['SUPABASE_SERVICE_ROLE_KEY']
        if not self.chave or not env['NEXT_PUBLIC_SUPABASE_URL']:
            raise RuntimeError('URL do Supabase ou service role vazia no crm.env')

    def pedir(self, metodo, caminho, corpo=None):
        """(status, dados). Erro de REDE devolve status 0 — nunca lança: um
        aviso já gravado nesta execução não pode se perder do estado."""
        dados = None if corpo is None else json.dumps(corpo).encode('utf-8')
        req = urllib.request.Request(self.base + caminho, data=dados, method=metodo, headers={
            'apikey': self.chave,
            'Authorization': 'Bearer ' + self.chave,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
            # O Cloudflare do Supabase recusa (1010) o user-agent padrão do urllib.
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) sentinela-whatsapp',
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                texto = r.read().decode('utf-8', 'replace')
                return r.status, (json.loads(texto) if texto else None)
        except urllib.error.HTTPError as e:
            return e.code, sem_segredo(e.read().decode('utf-8', 'replace'))
        except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError) as e:
            return 0, 'erro de rede: %s' % type(e).__name__

    def ler(self, caminho):
        status, dados = self.pedir('GET', caminho)
        if status != 200 or not isinstance(dados, list):
            raise RuntimeError('leitura de %s voltou %s: %s' % (caminho.split('?')[0], status, dados))
        return dados


# --------------------------------------------------------------------------
# Coleta dos logs (só o TIPO de cada linha, com contagem)
# --------------------------------------------------------------------------

ANSI = re.compile(r'\x1b\[[0-9;]*m')
# Linha com material de sessão (chaves Signal, Buffer impresso): descartada
# inteira — inclusive o formato do util.inspect (`private: <Buffer …>`).
SESSAO = re.compile(r'privKey|noiseKey|advSecretKey|signedIdentityKey|signedPreKey|\bprivate\b|'
                    r'rootKey|chainKey|keyData|pubKey|macKey|encKey|<Buffer', re.I)
VALOR = re.compile(r'(apikey|api_key|token|secret|password|senha|authorization|bearer)(["\'\s:=]+)([^\s"\',}]+)', re.I)
CONHECIDAS = ('transaction failed, rolling back', 'error in handling message', 'failed to decrypt message',
              'Connection Closed', 'Stream Errored', 'connection errored', 'restart required', 'logged out',
              'Message ignored with messageStubParameters', 'Original message not found for update',
              'Bad MAC', 'No session', 'No matching sessions', 'PreKeyError', 'SessionError')
TAG = re.compile(r'\s*(\[[^\]\s]{1,40}\])\s*')
EMAIL = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+')
ERRO_NOMEADO = re.compile(r'\s*((?:[A-Z]\w*)?Error\b.*)')


def assinatura(texto, tamanho=120):
    """O TIPO da linha, nunca o conteúdo (a coleta fica 90 dias em disco).
    Corta no primeiro '{' ou '[' — objeto e lista impressos, por onde vem o
    nó cru da mensagem (o caso do "error in handling message") —, troca todo
    trecho entre aspas por <…>, apaga e-mail e mascara chave, id, blob e
    número. Uma etiqueta de abertura do app (`[radar]`) é mantida."""
    if SESSAO.search(texto):
        return '[linha com chave de sessão omitida]'
    prefixo = ''
    m = TAG.match(texto)
    if m:
        prefixo, texto = m.group(1) + ' ', texto[m.end():]
    texto = VALOR.sub(r'\1\2<omitido>', texto)
    texto = re.split(r'[{\[]', texto, 1)[0]
    texto = re.sub(r'"[^"]*"?|\'[^\']*\'?|`[^`]*`?', '<…>', texto)
    texto = EMAIL.sub('<email>', texto)
    texto = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', texto)
    texto = re.sub(r'[0-9A-Fa-f]{16,}', '<id>', texto)
    texto = re.sub(r'[A-Za-z0-9+/_=-]{24,}', '<blob>', texto)
    texto = re.sub(r'\d{4,}', '#', texto)
    return (prefixo + re.sub(r'\s+', ' ', texto).strip())[:tamanho]


def arquivos_de_log(nome_do_servico, desde):
    """Os json-file de TODOS os contêineres do serviço (o parado guarda o log
    de antes do reinício ou do deploy), menos os que não mudam desde `desde`."""
    corte = de_iso(desde).timestamp()
    arquivos = []
    for conteiner in conteineres(nome_do_servico, todos=True):
        try:
            caminho = rodar(['docker', 'inspect', '-f', '{{.LogPath}}', conteiner]).strip()
        except RuntimeError:
            continue
        if not caminho:
            continue

        def ordem(p):
            fim = p.rsplit('.', 1)[1]
            return -int(fim) if fim.isdigit() else 0
        for nome in sorted(glob.glob(caminho + '*'), key=ordem):
            try:
                if os.path.getmtime(nome) >= corte:
                    arquivos.append(nome)
            except OSError:
                continue
    return arquivos


def linhas_do_log(arquivos, desde, ate):
    """(instante, texto) do json-file do Docker, em streaming, na janela."""
    for nome in arquivos:
        try:
            fh = open(nome, 'rb')
        except OSError:
            continue
        with fh:
            for bruto in fh:
                try:
                    obj = json.loads(bruto)
                except ValueError:
                    continue
                instante = obj.get('time', '')[:19]
                if instante < desde or instante >= ate:
                    continue
                yield instante, ANSI.sub('', obj.get('log', ''))


def coletar_evolution(desde, ate):
    """As assinaturas do log da Evolution — a leitura da seção 5 do
    vps-saude.sh —, os recibos ERROR por (conexão, tipo, código) e as
    mensagens DESCARTADAS antes do banco ("error in handling message")."""
    assinaturas = collections.Counter()
    recibos = collections.Counter()
    descartadas = 0
    # A linha do "error in handling message" não diz a instância: a provável é
    # a do prefixo "[Evolution API] [<instância>]" mais próximo antes dela
    # ('?' se nenhum). Heurística — o aviso diz "provável".
    descartadas_por_instancia = collections.Counter()
    linhas = 0
    primeiro = ultimo = None
    historico = collections.deque(maxlen=14)
    pendente = None
    sem_texto = None  # (nível, componente) de um ERROR/WARN cujo texto vem na linha seguinte
    for instante, s in linhas_do_log(arquivos_de_log('evolution_evolution', desde), desde, ate):
        linhas += 1
        primeiro = primeiro or instante
        ultimo = instante
        if 'error in handling message' in s:
            descartadas += 1
            provavel = '?'
            for anterior in reversed(historico):
                achou = re.findall(r'\[Evolution API\]\s*\[([A-Za-z0-9 _-]+)\]', anterior)
                if achou:
                    provavel = achou[-1].strip()
                    break
            descartadas_por_instancia[provavel] += 1
        historico.append(s)
        if pendente is not None:
            m = re.search(r'"(\d{3})"', s)
            if m:
                recibos['\t'.join(pendente + (m.group(1),))] += 1
                pendente = None
            elif ']' in s:
                recibos['\t'.join(pendente + ('?',))] += 1
                pendente = None
        if '"status": 0' in s:
            bloco = ''.join(historico)
            inst = re.findall(r'\[Evolution API\]\s*\[([a-z0-9-]+)\]', bloco)
            rj = re.findall(r'"remoteJid": "[0-9]+(:[0-9]+)?@', bloco)
            if inst and rj:
                pendente = (inst[-1], 'aparelho' if rj[-1] else 'principal')
        if sem_texto is not None:
            # Só entra a linha seguinte que for o NOME de um erro ("Error:
            # Connection Closed"); objeto impresso (o nó da mensagem) nunca.
            nivel_anterior, componente_anterior = sem_texto
            sem_texto = None
            erro = ERRO_NOMEADO.match(s)
            if erro:
                assinaturas[nivel_anterior + '\t' + componente_anterior + ': ' + assinatura(erro.group(1))] += 1
                continue
            assinaturas[nivel_anterior + '\t' + componente_anterior + ': (objeto omitido)'] += 1
        nivel = None
        m = re.search(r'\s(ERROR|WARN)\s+\[([^\]]+)\]\s*\[[^\]]*\]\s*(.*)', s)
        if m:
            nivel, componente = m.group(1), assinatura(m.group(2), 60)
            if m.group(3).strip() in ('', '{', '['):
                sem_texto = (nivel, componente)
                continue
            texto = componente + ': ' + assinatura(m.group(3))
        else:
            m = re.match(r'\s*\{"level":(\d+).*"msg":"([^"]*)"', s)
            if m and int(m.group(1)) >= 40:
                nivel = 'baileys-' + ('erro' if int(m.group(1)) >= 50 else 'aviso')
                texto = assinatura(m.group(2))
        if nivel is None:
            for conhecida in CONHECIDAS:
                if conhecida in s:
                    nivel, texto = 'conhecida', conhecida
                    break
        if nivel is None:
            continue
        assinaturas[nivel + '\t' + texto] += 1
    return {'linhas': linhas, 'cobertura': [primeiro, ultimo], 'descartadas': descartadas,
            'descartadas_por_instancia': dict(descartadas_por_instancia),
            'assinaturas': dict(assinaturas.most_common(60)), 'recibos': dict(recibos)}


def coletar_app(nome_do_servico, desde, ate):
    """Falhas e avisos do log de um serviço do CRM (crm_crm, crm_agendador) —
    a leitura da seção 6 do vps-saude.sh."""
    contagem = collections.Counter()
    linhas = 0
    for _instante, s in linhas_do_log(arquivos_de_log(nome_do_servico, desde), desde, ate):
        linhas += 1
        if not re.search(r'error|failed|falhou|warn|\[evolution/webhook\]|\[send-message\]|ignorad|curl', s, re.I):
            continue
        contagem[assinatura(s, 160)] += 1
    return {'linhas': linhas, 'assinaturas': dict(contagem.most_common(60))}


# --------------------------------------------------------------------------
# Checagens
# --------------------------------------------------------------------------

class Achados:
    def __init__(self):
        self.problemas = {}   # chave -> {titulo, corpo, contas, evento, dados}
        self.normais = set()  # chaves medidas e em ordem (para "Normalizou")
        self.nao_medido = []  # o que falhou ao medir, com o motivo

    def problema(self, chave, titulo, corpo, contas, evento=False, dados=None):
        self.problemas[chave] = {'titulo': titulo, 'corpo': corpo, 'contas': sorted(contas),
                                 'evento': evento, 'dados': dados or {}}

    def normal(self, chave):
        self.normais.add(chave)


def situacao_do_servidor():
    """Réplicas dos serviços vigiados e memória: o que se mede sem o banco.
    Serviço vigiado que nem aparece no `docker service ls` conta como parado."""
    replicas = {}
    for linha in rodar(['docker', 'service', 'ls', '--format', '{{.Name}} {{.Replicas}}']).splitlines():
        partes = linha.split()
        if len(partes) >= 2 and partes[0] in SERVICOS_VIGIADOS and '/' in partes[1]:
            rodando, esperado = partes[1].split('/', 1)
            replicas[partes[0]] = (rodando, esperado.split()[0])
    for servico in SERVICOS_VIGIADOS:
        replicas.setdefault(servico, ('0', 'serviço ausente'))
    memoria_mb = None
    with open('/proc/meminfo') as fh:
        for linha in fh:
            if linha.startswith('MemAvailable:'):
                memoria_mb = int(linha.split()[1]) // 1024
    return {'replicas': replicas, 'memoria_mb': memoria_mb}


def situacao_das_conexoes(pg):
    """{instância: situação} da tabela "Instance"; None = o banco não respondeu
    (e então nada sobre conexão é afirmado, nem problema nem normal)."""
    if pg is None:
        return None
    try:
        linhas = psql(pg, '''
            select "name", "connectionStatus", coalesce("disconnectionReasonCode"::text, ''),
                   coalesce(to_char("disconnectionAt", 'YYYY-MM-DD"T"HH24:MI:SS'), '')
            from "Instance";''')
    except (RuntimeError, subprocess.TimeoutExpired):
        return None
    return {nome: {'status': status, 'codigo': codigo, 'desde': desde}
            for nome, status, codigo, desde in linhas}


def parado(rodando, esperado):
    """Réplicas faltando, serviço ausente — ou desligado de propósito
    (`docker service scale …=0` vira "0/0", que pareceria saudável)."""
    return rodando != esperado or esperado == '0'


def suspeitas(servidor, conexoes, producao):
    s = set()
    for servico, (rodando, esperado) in servidor['replicas'].items():
        if parado(rodando, esperado):
            s.add('replica:' + servico)
    if servidor['memoria_mb'] is not None and servidor['memoria_mb'] < MEMORIA_MINIMA_MB:
        s.add('memoria')
    if conexoes is not None:
        for canal in producao:
            inst = conexoes.get(canal['instance_name'])
            # Instância que sumiu do servidor (apagada ou renomeada) é conexão
            # inutilizável — nunca motivo para tirar o canal da conta.
            if inst is None or inst['status'] != 'open':
                s.add('conexao:' + canal['instance_name'])
    return s


def checar_servidor_e_conexoes(pg, producao, contas, achados):
    """Réplica, memória, disco e conexão. Roda MESMO com o banco da Evolution
    fora — é justamente quando o Postgres parado precisa de aviso. A suspeita
    só vira problema se continuar depois de RECHECAGEM_S (deploy do CRM,
    reconexão de rotina). Devolve a situação das conexões (None = o banco não
    respondeu)."""
    servidor = situacao_do_servidor()
    conexoes = situacao_das_conexoes(pg)
    primeira = suspeitas(servidor, conexoes, producao)
    if primeira:
        time.sleep(RECHECAGEM_S)
        servidor = situacao_do_servidor()
        conexoes = situacao_das_conexoes(pg)
    persistentes = primeira & suspeitas(servidor, conexoes, producao)

    for servico, (rodando, esperado) in servidor['replicas'].items():
        chave = 'replica:' + servico
        if chave in persistentes:
            if esperado == 'serviço ausente':
                corpo = 'O serviço não existe mais no Swarm.'
            elif esperado == '0':
                corpo = 'O serviço está desligado (escalado para 0 réplicas).'
            else:
                corpo = '%s de %s réplicas rodando.' % (rodando, esperado)
            achados.problema(chave, 'Serviço parado no servidor: ' + servico, corpo, contas)
        elif not parado(rodando, esperado):
            achados.normal(chave)
    if 'memoria' in persistentes:
        achados.problema('memoria', 'Memória do servidor quase no fim',
                         '%d MB livres, e o servidor não tem swap.' % servidor['memoria_mb'], contas)
    elif servidor['memoria_mb'] is not None and servidor['memoria_mb'] >= MEMORIA_MINIMA_MB:
        achados.normal('memoria')

    st = os.statvfs('/')
    usado = (st.f_blocks - st.f_bfree) * st.f_frsize
    livre = st.f_bavail * st.f_frsize
    pct = int(round(100.0 * usado / (usado + livre))) if usado + livre else 0
    if pct > DISCO_MAXIMO:
        achados.problema('disco', 'Disco do servidor em %d%%' % pct,
                         '%d%% usado (o alerta acende acima de %d%%).' % (pct, DISCO_MAXIMO), contas)
    else:
        achados.normal('disco')

    if conexoes is None:
        achados.nao_medido.append('banco da Evolution não respondeu: conexões e mensagens não medidas')
        return None
    for canal in producao:
        chave = 'conexao:' + canal['instance_name']
        inst = conexoes.get(canal['instance_name'])
        if chave in persistentes:
            if inst is None:
                corpo = ('A conexão existe no CRM, mas a instância "%s" não existe no servidor do WhatsApp '
                         '(apagada ou renomeada). Se ela não é mais usada, apague-a em Configurações → Conexões.'
                         % canal['instance_name'])
            else:
                desde = de_iso(inst['desde']) if inst['desde'] else None
                codigo = inst['codigo']
                motivo = (' (código %s%s)' % (codigo, ': deslogada ou suspensa' if codigo == '401' else '')
                          if codigo else '')
                corpo = ('Desconectada desde %s%s.' % (quando(desde), motivo) if desde
                         else 'Situação "%s" no servidor do WhatsApp.' % inst['status'])
                corpo += ' Veja Configurações → Conexões.'
            achados.problema(chave, 'WhatsApp fora do ar: ' + canal['label'], corpo, [canal['account_id']])
        elif inst is not None and inst['status'] == 'open':
            achados.normal(chave)
    return conexoes


def checar_mensagens(pg, crm, producao, conexoes, achados):
    """O que depende do banco da Evolution: tráfego, o que o CRM não gravou e
    falha real de entrega — só nas conexões cuja instância existe."""
    producao = [c for c in producao if c['instance_name'] in conexoes]
    if not producao:
        achados.nao_medido.append('nenhuma conexão de produção casou CRM × Evolution')
        return
    nomes = ', '.join(literal(c['instance_name']) for c in producao)
    por_nome = {c['instance_name']: c for c in producao}

    # 1. Aberta sem receber (só se decide em horário útil; normaliza a qualquer hora).
    trafego = {nome: (int(e), int(s)) for nome, e, s in psql(pg, '''
        select i."name",
               count(*) filter (where not (m.key->>'fromMe')::boolean),
               count(*) filter (where (m.key->>'fromMe')::boolean)
        from "Message" m join "Instance" i on i.id = m."instanceId"
        where i."name" in (%s)
          and m."messageTimestamp" > extract(epoch from now() - interval '%d hours')
          and %s
        group by 1;''' % (nomes, JANELA_SEM_ENTRADA_H, FILTRO_1A1))}
    local = AGORA.astimezone(BRT)
    inicio_da_janela = (AGORA - datetime.timedelta(hours=JANELA_SEM_ENTRADA_H)).astimezone(BRT)
    horario_util = local.isoweekday() <= 5 and inicio_da_janela.hour >= 8 and local.hour < 20 \
        and inicio_da_janela.date() == local.date()
    for nome, canal in por_nome.items():
        entrada, saida = trafego.get(nome, (0, 0))
        chave = 'sem_entrada:' + nome
        if entrada > 0:
            achados.normal(chave)
        elif horario_util and saida >= SAIDAS_MINIMAS and conexoes[nome]['status'] == 'open':
            achados.problema(chave, 'WhatsApp sem receber: ' + canal['label'],
                             'Nenhuma mensagem de cliente nas últimas %d h, e %d saíram por ela. '
                             'A conexão aparece ativa.' % (JANELA_SEM_ENTRADA_H, saida), [canal['account_id']])

    # 2. A Evolution recebeu e o CRM não gravou — conferido PELO ID. Falha
    # aqui não pula a checagem 3.
    try:
        conferir_gravacao(pg, crm, nomes, por_nome, achados)
    except Exception as e:
        achados.nao_medido.append('conferência por id: ' + sem_segredo(e))

    # 3. Falha real de entrega: ERROR do envio PRINCIPAL em 1:1, sem entrega. A
    # mesma régua do CRM (`ehErroDeAparelhoSecundario`): remoteJid sem "@" OU
    # com ":" é reenvio a aparelho secundário, não falha.
    falhas = {nome: int(n) for nome, n in psql(pg, '''
        with x as (
          select i."name" as nome, m.id,
                 bool_or(u.status = 'ERROR' and u."remoteJid" like '%%@%%'
                         and u."remoteJid" not like '%%:%%') as principal,
                 bool_or(u.status in ('DELIVERY_ACK', 'READ', 'PLAYED')) as chegou
          from "Message" m
          join "Instance" i on i.id = m."instanceId"
          join "MessageUpdate" u on u."messageId" = m.id
          where i."name" in (%s)
            and (m.key->>'fromMe')::boolean
            and m."messageTimestamp" > extract(epoch from now() - interval '24 hours')
            and m.id in (select "messageId" from "MessageUpdate" where status = 'ERROR')
            and %s
          group by 1, 2)
        select nome, count(*) filter (where principal and not chegou) from x group by 1;''' % (nomes, FILTRO_1A1))}
    for nome, canal in por_nome.items():
        chave = 'falhas:' + nome
        n = falhas.get(nome, 0)
        if n >= FALHAS_MINIMAS:
            achados.problema(chave, 'Mensagens não entregues: ' + canal['label'],
                             '%d mensagens enviadas nas últimas 24 h foram recusadas pelo WhatsApp '
                             '(falha do envio principal, não de aparelho secundário).' % n, [canal['account_id']])
        else:
            achados.normal(chave)


def conferir_gravacao(pg, crm, nomes, por_nome, achados):
    """Mensagens de cliente das últimas JANELA_DE_CONFERENCIA_H horas (com mais
    de IDADE_MINIMA_S) que a Evolution tem e `messages.message_id` não."""
    if crm is not None:
        tipos = ', '.join(literal(t) for t in TIPOS_SEM_CONTEUDO)
        candidatas = collections.defaultdict(dict)
        for nome, mid, ts in psql(pg, '''
            select i."name", m.key->>'id', m."messageTimestamp"
            from "Message" m join "Instance" i on i.id = m."instanceId"
            where i."name" in (%s)
              and not (m.key->>'fromMe')::boolean
              and m."messageTimestamp" > extract(epoch from now() - interval '%d hours')
              and m."messageTimestamp" < extract(epoch from now()) - %d
              -- Fora só o LID SEM telefone (o CRM retém, 1010). A 2.4 manda
              -- quase tudo com o LID em remoteJid e o telefone em remoteJidAlt.
              and not (coalesce(m.key->>'remoteJid', '') like '%%@lid'
                       and coalesce(m.key->>'remoteJidAlt', '') not like '%%@s.whatsapp.net')
              and coalesce(m."messageType", '') not in (%s)
              and %s
              and m.key->>'id' ~ '^[A-Za-z0-9]+$';''' % (
                nomes, JANELA_DE_CONFERENCIA_H, IDADE_MINIMA_S, tipos, FILTRO_1A1)):
            candidatas[nome][mid] = int(ts)  # a Evolution guarda a do histórico DUAS vezes
        for nome, canal in por_nome.items():
            ids = candidatas.get(nome, {})
            chave = 'nao_gravadas:' + nome
            gravadas = set()
            lista = sorted(ids)
            for i in range(0, len(lista), 100):
                lote = lista[i:i + 100]
                # Na conexão DA mensagem: `message_id` só é único por conversa
                # (0040), e a mesma mensagem entre duas conexões do CRM existe
                # nas duas — achada na outra, esconderia a que faltou aqui.
                for linha in crm.ler('messages?select=message_id&channel_id=eq.%s&message_id=in.(%s)'
                                     % (urllib.parse.quote(canal['id']),
                                        urllib.parse.quote(','.join(lote), safe=','))):
                    gravadas.add(linha.get('message_id'))
            faltando = [ids[m] for m in lista if m not in gravadas]
            if len(faltando) >= NAO_GRAVADAS_MINIMAS:
                achados.problema(chave, 'Mensagens não chegam ao CRM: ' + canal['label'],
                                 '%d mensagens de cliente chegaram ao WhatsApp entre %s e %s e não estão no CRM.'
                                 % (len(faltando), quando(datetime.datetime.fromtimestamp(min(faltando), UTC)),
                                    quando(datetime.datetime.fromtimestamp(max(faltando), UTC))),
                                 [canal['account_id']])
            elif lista and not faltando:
                # Normaliza só com PROVA de que o CRM voltou a gravar: chegou
                # mensagem na janela e todas estão lá. Conexão quieta (janela
                # vazia) ou perda abaixo do limite não decidem nada — senão o
                # tempo "curaria" a perda sozinho.
                achados.normal(chave)


def checar_sessoes_99(rd, contas, achados, simular, estado):
    """Sessão legada '.99' (INFRA-VPS §8): uma vez por dia a partir das 10h
    — e de novo a cada hora até dar certo no dia, senão uma varredura que
    falha todo dia nunca chegaria às 3 falhas seguidas da `sentinela_cega` —,
    ou sempre no --simular. HSCAN com MATCH, nunca HKEYS: o Redis é
    compartilhado e os hashes de chaves Signal são grandes."""
    local = AGORA.astimezone(BRT)
    hoje = local.strftime('%Y-%m-%d')
    if not simular and (local.hour < HORA_DA_VARREDURA_99 or estado.get('sessao99_ok_em') == hoje):
        return
    if not rd:
        raise RuntimeError('contêiner do Redis não encontrado')
    legadas = 0
    for chave_redis in rodar(['docker', 'exec', rd, 'redis-cli', '-n', '8', '--scan',
                              '--pattern', 'evolution:instance:*']).split():
        cursor = '0'
        for _volta in range(100000):
            saida = rodar(['docker', 'exec', rd, 'redis-cli', '-n', '8', 'HSCAN', chave_redis, cursor,
                           'MATCH', 'session-*.99', 'COUNT', '1000'], timeout=60).splitlines()
            if not saida:
                break
            cursor = saida[0].strip()
            legadas += sum(1 for campo in saida[1:] if re.match(r'^session-[0-9]+\.99$', campo))
            if cursor == '0':
                break
    if legadas > 0:
        # Não marca o dia como feito: com sessão legada a varredura repete a
        # cada hora (barata, por HSCAN) e o problema segue aceso até sumir —
        # senão um aviso que o sino recusasse só voltaria amanhã.
        achados.problema('sessao99', 'Sessão antiga que derruba conversas',
                         "%d sessões legadas '.99' no servidor do WhatsApp: a conversa do contato para de chegar."
                         % legadas, contas)
    else:
        achados.normal('sessao99')
        estado['sessao99_ok_em'] = hoje


# --------------------------------------------------------------------------
# Estado e avisos
# --------------------------------------------------------------------------

def ler_estado():
    try:
        with open(ARQ_ESTADO, encoding='utf-8') as fh:
            estado = json.load(fh)
        if isinstance(estado, dict):
            return estado
    except (OSError, ValueError):
        pass
    return {}


def gravar_json(caminho, dados):
    temporario = caminho + '.tmp'
    with open(temporario, 'w', encoding='utf-8') as fh:
        json.dump(dados, fh, ensure_ascii=False, indent=1, sort_keys=True)
    os.chmod(temporario, 0o600)
    os.replace(temporario, caminho)


def texto_das_descartadas(dados, rotulos):
    """O log não diz de quem é a mensagem descartada (cliente, grupo, conexão
    de teste): o texto não afirma — dá a conexão PROVÁVEL pelo log."""
    partes = ['%s (%d)' % ('não identificada' if inst == '?' else rotulos.get(inst, inst), n)
              for inst, n in sorted(dados['por_instancia'].items())]
    return ('%d mensagem(ns) recebida(s) descartada(s) pela Evolution antes de chegar ao CRM desde %s '
            '(erro ao decifrar ou processar). Conexão provável pelo log: %s. Elas não aparecem em '
            'conversa nenhuma.' % (dados['n'], quando(de_iso(dados['desde'])), ', '.join(partes)))


def juntar_eventos_pendentes(estado, achados, rotulos, contas):
    """Evento que ainda não foi ao sino (recusado, ou dentro do intervalo de
    6 h) volta agora, somado ao desta execução — o log daquela janela não
    será relido. Os destinatários são os de AGORA somados aos guardados: um
    evento guardado com o CRM fora (sem conta) não pode ficar sem destino."""
    for chave, pendente in sorted((estado.get('eventos_pendentes') or {}).items()):
        atual = ((achados.problemas.get(chave) or {}).get('dados') or {})
        por_instancia = collections.Counter(pendente['dados'].get('por_instancia') or {})
        por_instancia.update(atual.get('por_instancia') or {})
        dados = {'n': pendente['dados'].get('n', 0) + atual.get('n', 0),
                 'desde': pendente['dados'].get('desde') or iso(AGORA),
                 'por_instancia': dict(por_instancia)}
        achados.problema(chave, pendente['titulo'], texto_das_descartadas(dados, rotulos),
                         sorted(set(pendente.get('contas') or []) | set(contas)), evento=True, dados=dados)


def decidir(estado, achados):
    """Os avisos desta execução: (chave, motivo, titulo, corpo, contas)."""
    ativos = estado.get('ativos', {})
    eventos = estado.get('eventos', {})
    avisos = []
    for chave, p in sorted(achados.problemas.items()):
        if p['evento']:
            ultimo = eventos.get(chave)
            if ultimo and AGORA - de_iso(ultimo) < datetime.timedelta(hours=INTERVALO_DE_EVENTO_H):
                continue
            avisos.append((chave, 'evento', p['titulo'], p['corpo'], p['contas']))
            continue
        atual = ativos.get(chave)
        if atual is None:
            avisos.append((chave, 'novo', p['titulo'], p['corpo'], p['contas']))
        elif AGORA - de_iso(atual['avisado_em']) >= datetime.timedelta(hours=LEMBRETE_H):
            avisos.append((chave, 'lembrete', 'Continua — ' + p['titulo'],
                           p['corpo'] + ' Desde %s.' % quando(de_iso(atual['desde'])), p['contas']))
    for chave, atual in sorted(ativos.items()):
        if chave in achados.normais and chave not in achados.problemas:
            corpo = 'Voltou ao normal %s; tinha começado %s.' % (
                quando_com_preposicao(AGORA), quando_com_preposicao(de_iso(atual['desde'])))
            if chave.startswith('nao_gravadas:'):
                corpo += (' As mensagens que faltaram NÃO entram sozinhas no CRM: '
                          'precisam ser importadas à mão.')
            avisos.append((chave, 'resolvido', 'Normalizou — ' + atual['titulo'], corpo, atual['contas']))
    return avisos


def aplicar(estado, achados, enviados):
    ativos = estado.setdefault('ativos', {})
    eventos = estado.setdefault('eventos', {})
    pendentes = estado.setdefault('eventos_pendentes', {})
    for chave, motivo in enviados:
        if motivo == 'evento':
            eventos[chave] = iso(AGORA)
            pendentes.pop(chave, None)
        elif motivo == 'novo':
            p = achados.problemas[chave]
            ativos[chave] = {'desde': iso(AGORA), 'avisado_em': iso(AGORA),
                             'titulo': p['titulo'], 'contas': p['contas']}
        elif motivo == 'lembrete':
            ativos[chave]['avisado_em'] = iso(AGORA)
        elif motivo == 'resolvido':
            ativos.pop(chave, None)
    # Evento que não foi ao sino nesta execução — recusado, ou dentro do
    # intervalo de 6 h — fica guardado (já somado) para a próxima.
    for chave, p in achados.problemas.items():
        if p['evento'] and (chave, 'evento') not in enviados:
            pendentes[chave] = {'titulo': p['titulo'], 'contas': p['contas'], 'dados': p['dados']}


def enviar(crm, admins, avisos):
    """Grava os avisos no sino. Devolve [(chave, motivo)] dos que entraram;
    o que falhar fica para a próxima execução (o estado não muda)."""
    enviados = []
    if crm is None:
        if avisos:
            print('  %d aviso(s) sem CRM para gravar' % len(avisos))
        return enviados
    for chave, motivo, titulo, corpo, contas in avisos:
        linhas = [{'account_id': conta, 'user_id': uid, 'type': TIPO_DO_AVISO,
                   'title': titulo[:200], 'body': corpo[:500]}
                  for conta in contas for uid in admins.get(conta, [])]
        if not linhas:
            print('  sem administrador para avisar: %s' % chave)
            continue
        status, resposta = crm.pedir('POST', 'notifications', linhas)
        if status == 201:
            enviados.append((chave, motivo))
        else:
            print('  aviso %s NÃO gravado: HTTP %s %s' % (chave, status, sem_segredo(resposta)))
    return enviados


def administradores(crm):
    por_conta = collections.defaultdict(list)
    for p in crm.ler('profiles?select=user_id,account_id&account_role=in.(owner,admin)&suspenso_em=is.null'):
        if p.get('user_id') and p.get('account_id'):
            por_conta[p['account_id']].append(p['user_id'])
    return por_conta


def vigiar_a_propria_medicao(estado, achados, contas):
    """"Não medido" calado no log local é a sentinela cega: depois de
    CEGA_DEPOIS_DE execuções seguidas, vira aviso. Sem o CRM não há como
    avisar — esse caso fica só no sentinela.log."""
    motivos = [m for m in achados.nao_medido if not m.startswith('CRM:')]
    cega = estado.setdefault('cega', {})
    if not motivos:
        estado['cega'] = {}
        achados.normal('sentinela_cega')
        return
    cega['seguidas'] = cega.get('seguidas', 0) + 1
    cega.setdefault('desde', iso(AGORA))
    if cega['seguidas'] >= CEGA_DEPOIS_DE:
        achados.problema('sentinela_cega', 'A sentinela do WhatsApp não consegue medir',
                         ('Desde %s: ' % quando(de_iso(cega['desde']))) + '; '.join(motivos)[:300], contas)


# --------------------------------------------------------------------------
# Execução
# --------------------------------------------------------------------------

def arrumar_a_casa():
    limite = AGORA - datetime.timedelta(days=DIAS_DE_COLETA)
    for nome in glob.glob(os.path.join(PASTA_COLETA, '*.jsonl')):
        if datetime.datetime.fromtimestamp(os.path.getmtime(nome), UTC) < limite:
            os.remove(nome)
    try:
        if os.path.getsize(ARQ_LOG) > 2 * 1024 * 1024:
            with open(ARQ_LOG, 'rb') as fh:
                fh.seek(-1024 * 1024, os.SEEK_END)
                resto = fh.read()
            with open(ARQ_LOG, 'wb') as fh:
                fh.write(resto[resto.find(b'\n') + 1:])
    except OSError:
        pass


def primeiro_conteiner(nome, achados):
    try:
        return (conteineres(nome) or [None])[0]
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as e:
        achados.nao_medido.append('docker: ' + sem_segredo(e))
        return None


def main():
    simular = '--simular' in sys.argv
    teste = '--teste-aviso' in sys.argv

    if not simular:
        os.makedirs(PASTA_COLETA, mode=0o700, exist_ok=True)
        os.chmod(PASTA, 0o700)
        trava = open(ARQ_TRAVA, 'w')
        try:
            fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print('%s outra execução em andamento; saindo' % iso(AGORA))
            return 0

    achados = Achados()
    # Sem o CRM (crm.env ausente, chave vazia, rede) não há a quem avisar, mas
    # a coleta dos logs segue: é ela que não pode ter buraco.
    crm, canais, admins = None, [], {}
    try:
        crm = Crm(ler_env(CRM_ENV))
        canais = crm.ler('cb_channels?select=id,account_id,label,instance_name'
                         '&kind=eq.evolution&instance_name=not.is.null')
        admins = administradores(crm)
    except Exception as e:
        achados.nao_medido.append('CRM: ' + sem_segredo(e))
    producao = [c for c in canais if 'teste' not in ((c.get('label') or '') + c['instance_name']).lower()]
    contas = sorted({c['account_id'] for c in producao})

    if teste:
        enviados = enviar(crm, admins, [('teste', 'evento', 'Teste da sentinela do WhatsApp',
                                         'Se você está vendo isto, os avisos do servidor chegam ao sino.',
                                         contas)])
        print('%s aviso de teste: %s%s' % (iso(AGORA), 'gravado' if enviados else 'FALHOU',
                                           ' (' + ' | '.join(achados.nao_medido) + ')' if achados.nao_medido else ''))
        return 0 if enviados else 1

    pg = primeiro_conteiner('postgres_postgres', achados)
    rd = primeiro_conteiner('redis_redis', achados)
    estado = ler_estado()

    # Checagens. Cada parte falha sozinha: uma que quebra não cala as outras
    # nem a coleta. Postgres parado aparece como réplica faltando (`docker
    # service ls`), não como checagem pulada.
    conexoes = None
    try:
        conexoes = checar_servidor_e_conexoes(pg, producao, contas, achados)
    except Exception as e:
        achados.nao_medido.append('servidor e conexões: ' + sem_segredo(e))
    if conexoes is not None and producao:
        try:
            checar_mensagens(pg, crm, producao, conexoes, achados)
        except Exception as e:
            achados.nao_medido.append('mensagens: ' + sem_segredo(e))
    try:
        checar_sessoes_99(rd, contas, achados, simular, estado)
    except Exception as e:
        achados.nao_medido.append("sessões '.99': " + sem_segredo(e))

    # Coleta dos logs, desde a execução anterior (no máximo COLETA_MAXIMA_H).
    # Ou entra inteira, ou não entra: linha parcial seria contada duas vezes
    # quando a janela for relida.
    ate = iso(AGORA)[:19]
    piso = iso(AGORA - datetime.timedelta(hours=COLETA_MAXIMA_H))[:19]
    desde = max(estado.get('coletado_ate', piso)[:19], piso)
    registro = {'execucao': iso(AGORA), 'janela': [desde + 'Z', ate + 'Z']}
    coleta_ok = False
    try:
        coleta = {'evolution': coletar_evolution(desde, ate),
                  'crm': coletar_app('crm_crm', desde, ate),
                  'agendador': coletar_app('crm_agendador', desde, ate)}
        registro.update(coleta)
        coleta_ok = True
    except Exception as e:
        achados.nao_medido.append('coleta: ' + sem_segredo(e))
    rotulos = {c['instance_name']: (c.get('label') or c['instance_name']) for c in canais}
    if coleta_ok and registro['evolution']['descartadas']:
        dados = {'n': registro['evolution']['descartadas'], 'desde': desde + 'Z',
                 'por_instancia': registro['evolution']['descartadas_por_instancia']}
        achados.problema('descartadas', 'WhatsApp descartou mensagens recebidas',
                         texto_das_descartadas(dados, rotulos), contas, evento=True, dados=dados)
    juntar_eventos_pendentes(estado, achados, rotulos, contas)
    vigiar_a_propria_medicao(estado, achados, contas)

    avisos = decidir(estado, achados)
    registro['problemas'] = sorted(achados.problemas)
    registro['nao_medido'] = achados.nao_medido

    if simular:
        resumo = {}
        for fonte in ('evolution', 'crm', 'agendador'):
            dados = registro.get(fonte)
            if isinstance(dados, dict):
                resumo[fonte] = {k: v for k, v in dados.items() if k != 'assinaturas'}
                resumo[fonte]['assinaturas_top'] = list(dados['assinaturas'].items())[:12]
        print(json.dumps({'problemas': achados.problemas, 'normais': sorted(achados.normais),
                          'nao_medido': achados.nao_medido, 'janela_da_coleta': registro['janela'],
                          'avisaria': [{'chave': a[0], 'motivo': a[1], 'titulo': a[2], 'corpo': a[3],
                                        'destinatarios': sum(len(admins.get(c, [])) for c in a[4])}
                                       for a in avisos],
                          'coleta': resumo}, ensure_ascii=False, indent=1))
        return 0

    enviados = enviar(crm, admins, avisos)
    aplicar(estado, achados, enviados)
    registro['avisos'] = [list(e) for e in enviados]
    if coleta_ok:
        estado['coletado_ate'] = ate + 'Z'
    estado['ultima_execucao'] = iso(AGORA)
    dia = AGORA.astimezone(BRT).strftime('%Y-%m-%d')
    with open(os.path.join(PASTA_COLETA, dia + '.jsonl'), 'a', encoding='utf-8') as fh:
        fh.write(json.dumps(registro, ensure_ascii=False, sort_keys=True) + '\n')
    gravar_json(ARQ_ESTADO, estado)
    arrumar_a_casa()
    print('%s ok: %d problema(s) %s; %d aviso(s) gravado(s)%s' % (
        iso(AGORA), len(achados.problemas), sorted(achados.problemas), len(enviados),
        ('; NÃO MEDIDO: ' + ' | '.join(achados.nao_medido)) if achados.nao_medido else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
