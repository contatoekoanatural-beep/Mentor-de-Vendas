/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest, onCall, HttpsError} = require("firebase-functions/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

// Initialize Firebase Admin (protected against double-init)
if (!admin.apps.length) admin.initializeApp();

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

const RESPONDECHAT_WEBHOOK_LEAD = "https://backend.respondechat.ai/webhook/188/EfEtTZsjXiR6R62esjGD7XWlHlIVwGv1Ru0YES1XOE";
const REMARKETING_THRESHOLD_HORAS = 22;
// Prazo entre o remarketing (que ARQUIVA o lead) e a exclusão do lead morto.
// Se o cliente não responder dentro dessa janela, o job diário (00:00) exclui a
// conversa. Se responder antes, o webhook desarquiva e o lead volta pra Ativas.
const EXCLUSAO_LEAD_MORTO_HORAS = 24;

// Nota interna gravada no histórico quando o remarketing dispara. É a fonte
// única do texto: quem grava (processarRemarketing) e quem precisa reconhecer a
// nota depois (o vigia de saúde) apontam para cá. Não é enviada ao cliente como
// está — o disparo real sai pelo webhook do canal.
const NOTA_REMARKETING =
  "[Enviamos uma mensagem de remarketing perguntando se o cliente ainda " +
  "tem interesse no perfume. A próxima resposta do cliente é uma reação a " +
  "essa mensagem de remarketing.]";

/** Uma mensagem do histórico é a nota interna de remarketing? */
function ehNotaRemarketing(msg) {
  return !!msg && msg.role === "model" && msg.text === NOTA_REMARKETING;
}

// Vigia de saúde dos chips. O Responde Chat responde 200 "Mensagem enviada"
// mesmo com o chip fora do ar, então o envio "some" sem erro. O vigia detecta
// isso pelo comportamento (ver vigiaSaudeChips): janela de análise e nº mínimo
// de leads respondidos para um chip poder ser avaliado.
const VIGIA_JANELA_MIN = 30;
const VIGIA_MIN_ENVIOS = 5;

// ----------------------------------------
// Provedores de WhatsApp (o "cano" de entrada/saída)
// ----------------------------------------
// Responde Chat e ConverteChat falam quase a mesma língua: webhook de entrada
// com ?agente=<slug>&canal=<slug>, e envio por POST com Bearer + {number, body}.
// Só mudam a URL de envio e onde o token mora nas settings. Todo o miolo (Gemini,
// buffer do funil, áudio, split, lead pronto, boleto, remarketing) é compartilhado
// em processarWebhookCanal(). Trocar de ferramenta = trocar a tomada, não o aparelho.
const PROVIDERS = {
  respondechat: {
    nome: "respondechat",
    sendUrl: "https://backend.respondechat.ai/api/messages/send",
    tokenDoCanal: (c) => c && c.token,
    tokenPadrao: (s) => s.respondechatToken,
    tokenLegado: (s, canal) => s.respondechatTokens && s.respondechatTokens[canal],
  },
  convertechat: {
    nome: "convertechat",
    sendUrl: "https://api.convertechat.com/api/send",
    // Um chip pode ter os dois tokens ao mesmo tempo (RC em `token`, CC em
    // `tokenConverteChat`), o que permite testar o CC em paralelo sem derrubar o RC.
    tokenDoCanal: (c) => c && c.tokenConverteChat,
    tokenPadrao: (s) => s.convertechatToken,
    tokenLegado: () => null,
  },
};

/**
 * Resolve o token de envio do chip para o provedor em uso. O token do canal
 * manda; sem canal ou sem token próprio, cai no token padrão do provedor.
 * @param {Object} provider Entrada de PROVIDERS.
 * @param {Object} settingsData Documento settings/app.
 * @param {?string} canal Slug do chip.
 * @return {?string} Token ou null.
 */
function resolverTokenCanal(provider, settingsData, canal) {
  const doCanal = canal && settingsData.canais && settingsData.canais[canal];
  return (
    provider.tokenDoCanal(doCanal) ||
    provider.tokenLegado(settingsData, canal) ||
    provider.tokenPadrao(settingsData) ||
    null
  );
}

/**
 * Escolhe o webhook a disparar levando em conta o canal (chip) de origem.
 * Cada chip em settings.canais tem seus próprios webhooks. Se o chip tem URL
 * própria para o evento, ela manda — assim a automação roda na caixa do chip
 * certo (ex.: mover o lead para "atendendo" na conexão do Claro 2, não na do
 * Claro 4). Sem canal, ou canal sem URL para o evento, cai no webhook global
 * (o canal padrão). Um webhook de chip COM URL mas marcado inativo NÃO cai no
 * global: o dono desligou aquele evento de propósito para aquele chip.
 * @param {Object} settingsData Documento settings/app.
 * @param {?string} canal Slug do chip (ex.: "claro2") ou null para o padrão.
 * @param {string} chave Evento: "iaAcionada" | "leadPronto" | "remarketing".
 * @param {?string} fallbackUrl URL embutida usada se nem o global tiver URL.
 * @return {{url: ?string, ativo: boolean, origem: string}}
 */
function resolverWebhook(settingsData, canal, chave, fallbackUrl) {
  const doChip =
    canal &&
    settingsData.canais &&
    settingsData.canais[canal] &&
    settingsData.canais[canal].webhooks &&
    settingsData.canais[canal].webhooks[chave];
  if (doChip && doChip.url) {
    return { url: doChip.url, ativo: doChip.ativo !== false, origem: canal };
  }
  const global = (settingsData.webhooks && settingsData.webhooks[chave]) || {};
  return {
    url: global.url || fallbackUrl || null,
    ativo: global.ativo !== false,
    origem: "padrao",
  };
}

// ----------------------------------------
// Gemini
// ----------------------------------------
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODELO_PADRAO = "gemini-3.5-flash";
const GEMINI_MODELO_FALLBACK = "gemini-2.5-flash";
const GEMINI_TENTATIVAS = 3;

/** Modelos a tentar, em ordem. settings/app.geminiModel troca o primário sem exigir deploy. */
function resolverModelosGemini(settingsData) {
  const configurado = settingsData && typeof settingsData.geminiModel === "string"
    ? settingsData.geminiModel.trim()
    : "";
  const primario = configurado || GEMINI_MODELO_PADRAO;
  return primario === GEMINI_MODELO_FALLBACK
    ? [primario]
    : [primario, GEMINI_MODELO_FALLBACK];
}

/**
 * Chama generateContent com retry e fallback de modelo. Devolve o JSON da API.
 *
 * 429/5xx/rede são transitórios e repetidos no mesmo modelo com backoff. 400/404
 * não adianta repetir: pula direto para o próximo modelo da lista — em 09/07/2026
 * o gemini-2.5-flash devolveu 404 "no longer available" por ~50min e, sem
 * fallback, a IA não respondeu a ninguém nesse intervalo.
 *
 * Lança se todos os modelos falharem.
 */
async function chamarGemini(apiKey, corpo, modelos, contexto = {}) {
  let ultimoErro = null;

  for (const modelo of modelos) {
    for (let tentativa = 1; tentativa <= GEMINI_TENTATIVAS; tentativa++) {
      try {
        const res = await fetch(`${GEMINI_BASE_URL}/${modelo}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });

        if (res.ok) {
          if (modelo !== modelos[0]) {
            logger.warn("chamarGemini — atendido pelo modelo de fallback", { ...contexto, modelo });
          }
          return await res.json();
        }

        const body = await res.text();
        ultimoErro = new Error(`Gemini ${res.status} (${modelo}): ${body}`);

        const transitorio = res.status === 429 || res.status >= 500;
        logger.warn("chamarGemini — erro na API", {
          ...contexto, modelo, tentativa, status: res.status, transitorio,
          body: body.slice(0, 300),
        });

        if (!transitorio) break;
      } catch (err) {
        ultimoErro = err;
        logger.warn("chamarGemini — excecao de rede", {
          ...contexto, modelo, tentativa, error: String(err),
        });
      }

      if (tentativa < GEMINI_TENTATIVAS) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, tentativa - 1)));
      }
    }
  }

  throw ultimoErro || new Error("Gemini: falha desconhecida");
}

// ----------------------------------------
// Buffer de mensagens que chegam durante o funil
// ----------------------------------------
const WEBHOOK_URL = "https://webhookrespondechat-2vqjvotywa-uc.a.run.app";
const BUFFER_MAX_MSGS = 20;
const BUFFER_TTL_MS = 24 * 60 * 60 * 1000;

// Quem escreve nos últimos segundos antes do ativarAgente está respondendo ao
// áudio final do funil e apenas perdeu a corrida — merece resposta. Quem
// escreve minutos antes está reagindo NO MEIO da automação (ex.: "Sim" para
// "posso mandar os valores?", que o próprio funil já responde): esse não é
// atendido, segue para o remarketing. Medido em 7 dias de log: mediana de 81s
// entre a mensagem e o ativarAgente, e só ~2 msgs/semana abaixo de 5s.
const BUFFER_JANELA_RESPOSTA_MS = 5000;

function bufferRef(numero, agenteSlug) {
  return admin.firestore().collection("pendingMessages").doc(numero + "_" + agenteSlug);
}

/** Tira thumbnails base64 do payload para ele caber no documento do Firestore. */
function enxugarPayload(body) {
  const copia = JSON.parse(JSON.stringify(body || {}));
  const raw = copia?.message?.raw;
  if (raw) {
    for (const k of Object.keys(raw)) {
      if (raw[k] && typeof raw[k] === "object") {
        delete raw[k].JPEGThumbnail;
        delete raw[k].jpegThumbnail;
        delete raw[k].thumbnail;
      }
    }
  }
  if (JSON.stringify(copia).length > 200000) {
    return { message: {
      type: copia.message?.type,
      body: copia.message?.body,
      mediaUrl: copia.message?.mediaUrl,
    } };
  }
  return copia;
}

/**
 * Guarda uma mensagem que chegou antes de a conversa existir (funil rodando).
 * Não chama Gemini e não transcreve mídia: as ~300 reações de meio de funil por
 * semana continuam custando zero. O payload original da última fala do cliente
 * é guardado para um eventual replay, que aí sim transcreve.
 */
async function bufferizarMensagem({ numero, agenteSlug, texto, isFromMe, body, canal, provider }) {
  const tipo = body?.message?.type || "text";
  const textoLimpo = (texto && texto.trim())
    ? texto.trim()
    : (tipo === "text" ? "" : (tipo === "audio" ? "[áudio recebido]" : "[mídia recebida]"));

  if (!textoLimpo) {
    logger.info("bufferizarMensagem — mensagem sem conteudo, ignorada", { numero, tipo });
    return;
  }

  const ref = bufferRef(numero, agenteSlug);
  const agora = Date.now();
  const snap = await ref.get();
  const anteriores = snap.exists && Array.isArray(snap.data().messages) ? snap.data().messages : [];

  const dados = {
    numero,
    agenteSlug,
    messages: [...anteriores, { role: isFromMe ? "model" : "user", text: textoLimpo, ts: agora }]
      .slice(-BUFFER_MAX_MSGS),
    criadoEm: (snap.exists && snap.data().criadoEm) || agora,
    updatedAt: agora,
    // Chip e provedor de ORIGEM: o replay do ativarAgente precisa voltar pelo
    // mesmo cano por onde o lead entrou (ex.: vivo/convertechat), senão a
    // primeira resposta da IA sai pela API errada e some.
    canal: canal || null,
    provider: provider || "respondechat",
  };

  if (!isFromMe) {
    dados.ultimoPayloadCliente = JSON.stringify(enxugarPayload(body));
    dados.ultimoTsCliente = agora;
  }

  await ref.set(dados, { merge: true });
  logger.info("webhookRespondeChat — mensagem bufferizada (funil ainda rodando)", {
    numero, agenteSlug, isFromMe, total: dados.messages.length,
  });
}

/**
 * Chamado pelo ativarAgente ao fim do funil. Move as mensagens bufferizadas
 * para o histórico da conversa e, se a última fala do cliente chegou nos
 * últimos BUFFER_JANELA_RESPOSTA_MS, reenvia o payload dela ao webhook para
 * que a IA responda de verdade (reaproveitando debounce, transcrição e envio).
 */
async function consumirBuffer(numero, agenteSlug, convRef) {
  const ref = bufferRef(numero, agenteSlug);
  const snap = await ref.get();
  if (!snap.exists) return;

  const data = snap.data();
  const bufferizadas = Array.isArray(data.messages) ? data.messages : [];
  await ref.delete();
  if (!bufferizadas.length) return;

  // O buffer já sabe o chip de origem (gravado em bufferizarMensagem). Sem isto
  // a conversa nasce SEM canal e cai em "Padrão" na bancada até que uma mensagem
  // etiquetada chegue depois — grava já na criação para o marcador ficar certo.
  if (data.canal) {
    await convRef.set({ canal: data.canal }, { merge: true });
  }

  const ultima = bufferizadas[bufferizadas.length - 1];
  const respondeAgora =
    ultima.role === "user" &&
    !!data.ultimoPayloadCliente &&
    (Date.now() - (data.ultimoTsCliente || 0)) <= BUFFER_JANELA_RESPOSTA_MS;

  // Se vamos reenviar a última mensagem ao webhook, ela não entra aqui: o
  // próprio webhook a grava (já transcrita, se for áudio).
  const paraHistorico = respondeAgora ? bufferizadas.slice(0, -1) : bufferizadas;

  if (paraHistorico.length) {
    const convSnap = await convRef.get();
    const historico = convSnap.exists && Array.isArray(convSnap.data().messages)
      ? convSnap.data().messages
      : [];
    await convRef.set({
      messages: [...historico, ...paraHistorico],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  logger.info("ativarAgente — buffer do funil consumido", {
    numero, agenteSlug,
    bufferizadas: bufferizadas.length,
    gravadas: paraHistorico.length,
    respondeAgora,
    atrasoMs: Date.now() - (data.ultimoTsCliente || 0),
  });

  if (!respondeAgora) return;

  try {
    const body = JSON.parse(data.ultimoPayloadCliente);
    body.replayDoBuffer = true;
    // Replay pelo mesmo chip/provedor de origem (o payload guardado já está no
    // formato interno, então o reenvio vai sempre ao webhookRespondeChat — o
    // ?provider= diz por qual API a resposta deve SAIR).
    const qsCanal = data.canal ? `&canal=${encodeURIComponent(data.canal)}` : "";
    const qsProvider = data.provider && data.provider !== "respondechat"
      ? `&provider=${encodeURIComponent(data.provider)}`
      : "";
    const res = await fetch(`${WEBHOOK_URL}?agente=${encodeURIComponent(agenteSlug)}${qsCanal}${qsProvider}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    logger.info("ativarAgente — replay enviado ao webhook", { numero, status: res.status });
  } catch (err) {
    logger.error("ativarAgente — falha no replay da mensagem bufferizada", {
      numero, error: String(err),
    });
  }
}

/** Buffers de leads que nunca chegaram ao fim do funil viram lixo: limpa por idade. */
async function limparBuffersAntigos() {
  const corte = Date.now() - BUFFER_TTL_MS;
  const snap = await admin.firestore()
    .collection("pendingMessages")
    .where("criadoEm", "<", corte)
    .limit(500)
    .get();

  if (snap.empty) return 0;
  const lote = admin.firestore().batch();
  snap.docs.forEach((d) => lote.delete(d.ref));
  await lote.commit();
  logger.info("limparBuffersAntigos — buffers expirados removidos", { total: snap.size });
  return snap.size;
}

/**
 * Marca a conversa como "IA falhou" e avisa o vendedor.
 *
 * O flag pinta a conversa de vermelho na bancada, mas é passivo: só serve se
 * alguém estiver olhando a tela. O webhook avisa no WhatsApp na hora — em
 * 09/07/2026 o Gemini caiu por ~50min e o vendedor só descobriu à noite, por
 * acaso, com o cliente esperando desde a tarde.
 *
 * Dispara no máximo uma vez por conversa: `falhaIAWebhookEnviado` é zerado
 * assim que a IA volta a responder, então uma nova queda avisa de novo.
 */
async function marcarFalhaIA(convRef, motivo, contexto = {}, settingsData = null) {
  logger.error("webhookRespondeChat — IA sem resposta, conversa marcada para atendimento humano", {
    ...contexto, motivo: String(motivo).slice(0, 300),
  });

  let jaAvisou = false;
  try {
    const snap = await convRef.get();
    jaAvisou = snap.exists && snap.data().falhaIAWebhookEnviado === true;

    await convRef.set({
      falhaIA: true,
      falhaIAMotivo: String(motivo).slice(0, 500),
      falhaIATs: Date.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    logger.error("marcarFalhaIA — nao consegui gravar o flag", { ...contexto, error: String(err) });
  }

  if (jaAvisou || !settingsData) return;

  // Resolve pelo chip de origem (contexto.canal), com o global como padrão —
  // mesma regra dos demais eventos, para o alerta cair na caixa certa.
  const wh = resolverWebhook(settingsData, contexto.canal || null, "falhaIA", null);
  const webhookUrl = wh.url;
  const webhookAtivo = wh.ativo;

  if (!webhookAtivo || !webhookUrl) {
    logger.info("Disparo de falha da IA pulado: webhook inativo ou sem URL", {
      ...contexto, ativo: webhookAtivo, hasUrl: !!webhookUrl,
    });
    return;
  }

  try {
    logger.info("Disparando webhook de falha da IA", { ...contexto, url: webhookUrl, canal: wh.origem });
    const responseHook = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_phone: contexto.numero || "",
        ...(contexto.nomeCliente ? { client_name: contexto.nomeCliente } : {}),
      }).toString(),
    });
    const corpoResposta = await responseHook.text();
    logger.info("Resposta do webhook de falha da IA", {
      status: responseHook.status, corpo: corpoResposta.slice(0, 200),
    });

    if (responseHook.status >= 200 && responseHook.status < 300) {
      await convRef.set({ falhaIAWebhookEnviado: true }, { merge: true });
    }
  } catch (err) {
    logger.error("Erro ao disparar webhook de falha da IA", { ...contexto, error: String(err) });
  }
}

// ----------------------------------------
// Asaas — geração automática de boleto no [LEAD_PRONTO forma=boleto valor=...]
// Chave, URL, vencimento e liga/desliga ficam em settings/app (asaasApiKey + asaas.*),
// no mesmo padrão do geminiApiKey/respondechatToken — editável sem deploy.
// ----------------------------------------
const ASAAS_URL_PADRAO = "https://api-sandbox.asaas.com/v3"; // troque p/ https://api.asaas.com/v3 em settings/app.asaas.apiUrl quando for pra produção
const ASAAS_VENCIMENTO_DIAS_PADRAO = 3;
const ASAAS_VALOR_MIN = 10;
const ASAAS_VALOR_MAX = 2000;
// O [LEAD_PRONTO] volta a disparar a cada mensagem depois do fechamento (num caso
// real: 4x em 34min). Sem uma janela mínima entre ações de boleto, o reenvio vira
// spam e uma troca de valor viraria cobrança em duplicata.
const BOLETO_INTERVALO_MS = 5 * 60 * 1000;

// ----------------------------------------
// CRM — pedido direto no lead pronto (produto/quantidade/endereço/valor).
// Chave, URL e liga/desliga ficam em settings/app (crmApiKey + crm.*), mesmo
// padrão do Asaas — um único token vale pra todos os telefones, não é por chip.
// ----------------------------------------
const CRM_URL_PADRAO = "https://us-central1-crm-ekoa.cloudfunctions.net/webhookRespondChat";
// Só vendemos Lattifah com a IA por enquanto — ID interno do produto no CRM (não é o do ERP).
const CRM_PRODUTO_ID_LATTIFAH = "JvQJJtGT0cH3ZzlF9pe6";

// Pagador fictício rotativo: não coletamos CPF real do cliente (regra do prompt).
const NOMES_BOLETO = [
  "Ana Paula Souza", "Carlos Eduardo Oliveira", "Mariana Costa Lima",
  "Roberto Alves Pereira", "Juliana Ferreira Santos", "Marcos Vinicius Rocha",
  "Patricia Gomes Ribeiro", "Fernando Henrique Dias", "Camila Barbosa Nunes",
  "Rafael Augusto Cardoso",
];

/** CPF com dígitos verificadores válidos (número fictício, sem pontuação). */
function gerarCpfValido() {
  const d = [];
  for (let i = 0; i < 9; i++) d.push(Math.floor(Math.random() * 10));
  for (let j = 0; j < 2; j++) {
    let soma = 0;
    for (let i = 0; i < 9 + j; i++) soma += d[i] * (10 + j - i);
    let dig = (soma * 10) % 11;
    if (dig === 10) dig = 0;
    d.push(dig);
  }
  return d.join("");
}

function gerarNomeBoleto() {
  return NOMES_BOLETO[Math.floor(Math.random() * NOMES_BOLETO.length)];
}

/** "149,90" | "149.90" | "1.149,90" → número (149.9 / 1149.9), ou null se não parsear. */
function parseValorBRL(bruto) {
  if (!bruto) return null;
  let s = String(bruto).trim().replace(/[^\d.,]/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    // vírgula é o separador decimal → pontos viram milhar e somem
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Hoje + N dias no formato YYYY-MM-DD, fuso America/Sao_Paulo (UTC-3). */
function vencimentoISO(dias) {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  brt.setUTCDate(brt.getUTCDate() + (dias || ASAAS_VENCIMENTO_DIAS_PADRAO));
  return brt.toISOString().slice(0, 10);
}

/**
 * Data de HOJE no fuso de Brasília (UTC-3), formato AAAA-MM-DD.
 * Helper próprio porque vencimentoISO(0) cairia no padrão de 3 dias (dias || PADRAO).
 */
function hojeISOBrasilia() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ----------------------------------------
// CEP — consulta real (ViaCEP), mesma fonte que o CRM já usa
// ----------------------------------------
// Endereço NÃO pode ser adivinhado pela IA: ela inventaria rua plausível e o
// pedido sairia para o lugar errado. Consultamos o CEP de verdade e usamos o
// resultado tanto para a Patrícia parar de pedir rua/bairro que já conhecemos
// quanto para completar o pedido no CRM.

/** Primeiro CEP (8 dígitos) encontrado num texto livre, ou null. */
function extrairCep(texto) {
  if (!texto) return null;
  // Aceita "93546220", "93546-220" e também "93.546-220" (ponto de milhar, que
  // parte o primeiro grupo). As bordas \b impedem casar pedaço de telefone.
  const m = String(texto).match(/\b(\d{2})\.?(\d{3})[-.\s]?(\d{3})\b/);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/**
 * Consulta o CEP no ViaCEP. Devolve null se não existir ou se a consulta falhar
 * (best-effort: nunca derruba o atendimento). CEP "genérico" de cidade volta com
 * rua e bairro vazios — nesse caso o cliente ainda precisa informar.
 */
async function consultarCep(cep) {
  const limpo = String(cep || "").replace(/\D/g, "");
  if (limpo.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
    if (!res.ok) return null;
    const d = await res.json().catch(() => ({}));
    if (d.erro === true || d.erro === "true") return null;
    return {
      cep: limpo,
      rua: d.logradouro || "",
      bairro: d.bairro || "",
      cidade: d.localidade || "",
      estado: (d.uf || "").toUpperCase(),
    };
  } catch (e) {
    logger.warn("consultarCep — falha na consulta, seguindo sem o endereço", {
      cep: limpo, error: String(e).slice(0, 150),
    });
    return null;
  }
}

/** Hoje por extenso em pt-BR ("terça-feira, 22/07/2026") para o prompt da IA. */
function hojePorExtensoBrasilia() {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const dias = ["domingo", "segunda-feira", "terça-feira", "quarta-feira",
    "quinta-feira", "sexta-feira", "sábado"];
  const dd = String(brt.getUTCDate()).padStart(2, "0");
  const mm = String(brt.getUTCMonth() + 1).padStart(2, "0");
  return `${dias[brt.getUTCDay()]}, ${dd}/${mm}/${brt.getUTCFullYear()}`;
}

/**
 * Linha digitável de um boleto (GET sem body — corpo vazio evita 403).
 * Best-effort: se falhar, devolve null e o chamador segue só com o link, que
 * sempre abre.
 */
async function buscarLinhaDigitavel(base, apiKey, paymentId, contexto = {}) {
  try {
    const idRes = await fetch(`${base}/payments/${paymentId}/identificationField`, {
      method: "GET",
      headers: { "access_token": apiKey },
    });
    if (!idRes.ok) return null;
    const idData = await idRes.json().catch(() => ({}));
    return idData.identificationField || null;
  } catch (e) {
    logger.warn("Asaas — linha digitável indisponível, seguindo só com o link", {
      ...contexto, error: String(e).slice(0, 200),
    });
    return null;
  }
}

/**
 * Consulta um boleto já existente no Asaas. Diz se ainda vale (status/vencimento),
 * por quanto foi emitido e devolve link + linha digitável para reenviar ao cliente.
 * Lança erro se não conseguir consultar — o chamador decide o fallback.
 */
async function consultarBoletoAsaas({ apiKey, apiUrl, paymentId, contexto = {} }) {
  const base = (apiUrl || ASAAS_URL_PADRAO).replace(/\/+$/, "");
  const res = await fetch(`${base}/payments/${paymentId}`, {
    method: "GET",
    headers: { "access_token": apiKey },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.id) {
    throw new Error(`Asaas GET /payments/${paymentId} ${res.status}: ${JSON.stringify(d).slice(0, 200)}`);
  }

  // Pago (RECEIVED/CONFIRMED) não deve virar boleto novo nem reenvio.
  const pago = d.status === "RECEIVED" || d.status === "CONFIRMED" ||
    d.status === "RECEIVED_IN_CASH";
  // Vencido: o Asaas marca OVERDUE, mas conferimos a data também — o status
  // pode demorar a virar e um boleto vencido não adianta reenviar.
  const vencido = d.status === "OVERDUE" ||
    (typeof d.dueDate === "string" && d.dueDate < hojeISOBrasilia());

  return {
    paymentId: d.id,
    status: d.status,
    dueDate: d.dueDate || null,
    valor: Number(d.value),
    pago,
    vencido,
    bankSlipUrl: d.bankSlipUrl || d.invoiceUrl || null,
    linhaDigitavel: await buscarLinhaDigitavel(base, apiKey, d.id, contexto),
  };
}

/**
 * Cancela uma cobrança no Asaas, para o cliente não conseguir pagar um boleto
 * que foi substituído (valor errado). Best-effort e NUNCA lança: quando é
 * chamada, o boleto novo já foi emitido, então uma falha aqui não pode derrubar
 * o envio — vira aviso no log. O Asaas recusa apagar cobrança já paga, o que
 * protege do caso raro de o cliente pagar entre a consulta e o cancelamento.
 */
async function cancelarBoletoAsaas({ apiKey, apiUrl, paymentId, contexto = {} }) {
  const base = (apiUrl || ASAAS_URL_PADRAO).replace(/\/+$/, "");
  try {
    const res = await fetch(`${base}/payments/${paymentId}`, {
      method: "DELETE",
      headers: { "access_token": apiKey },
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || d.deleted !== true) {
      logger.warn("Asaas — nao foi possivel cancelar o boleto anterior", {
        ...contexto, paymentId, status: res.status, corpo: JSON.stringify(d).slice(0, 200),
      });
      return false;
    }
    logger.info("Asaas — boleto anterior cancelado", { ...contexto, paymentId });
    return true;
  } catch (e) {
    logger.warn("Asaas — erro ao cancelar o boleto anterior", {
      ...contexto, paymentId, error: String(e).slice(0, 200),
    });
    return false;
  }
}

/**
 * Cria cliente + cobrança boleto no Asaas e devolve link e linha digitável.
 * Lança erro em qualquer falha — o chamador decide o fallback (marcar falhaIA).
 */
async function gerarBoletoAsaas({ apiKey, apiUrl, valor, vencimentoDias, numero, agenteSlug, nome, dueDateISO }) {
  const base = (apiUrl || ASAAS_URL_PADRAO).replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json", "access_token": apiKey };

  // 1. Cliente: nome REAL informado pelo cliente (boleto sai no nome dele); só cai
  //    no nome fictício rotativo se a IA não tiver coletado. O CPF é sempre fictício.
  const nomePagador = (nome && nome.trim()) ? nome.trim() : gerarNomeBoleto();
  const cliRes = await fetch(`${base}/customers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: nomePagador, cpfCnpj: gerarCpfValido() }),
  });
  const cliData = await cliRes.json().catch(() => ({}));
  if (!cliRes.ok || !cliData.id) {
    throw new Error(`Asaas /customers ${cliRes.status}: ${JSON.stringify(cliData).slice(0, 300)}`);
  }

  // 2. Cobrança boleto
  const payRes = await fetch(`${base}/payments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customer: cliData.id,
      billingType: "BOLETO",
      value: Number(Number(valor).toFixed(2)),
      // Data pedida pelo cliente manda; sem ela, o prazo padrão da config. Sem
      // isto a IA prometia "vence terça" e o boleto saía com o prazo fixo.
      dueDate: dueDateISO || vencimentoISO(vencimentoDias),
      externalReference: `${numero}_${agenteSlug}`,
      description: "Perfume Atracao Arabe / Lattifah",
    }),
  });
  const payData = await payRes.json().catch(() => ({}));
  if (!payRes.ok || !payData.id) {
    throw new Error(`Asaas /payments ${payRes.status}: ${JSON.stringify(payData).slice(0, 300)}`);
  }

  // 3. Linha digitável — best-effort (ver buscarLinhaDigitavel).
  const linhaDigitavel = await buscarLinhaDigitavel(base, apiKey, payData.id, { numero, agenteSlug });

  return {
    paymentId: payData.id,
    bankSlipUrl: payData.bankSlipUrl || payData.invoiceUrl || null,
    linhaDigitavel,
  };
}

// ----------------------------------------
// CRM — extração estruturada pra montar o pedido (lead pronto)
// Chamada separada do Gemini, NÃO mexe no prompt principal da Patrícia nem no
// marcador [LEAD_PRONTO] (forma/valor/nome continuam vindo de lá). Best-effort:
// falha aqui nunca derruba o fluxo de lead pronto, só manda o pedido mais pobre.
// ----------------------------------------

/**
 * Extrai quantidade de frascos, endereço estruturado e (se o cliente pediu
 * explicitamente) uma data futura de pagamento, a partir do histórico da
 * conversa. Devolve campos null quando não encontra ou em qualquer erro.
 */
async function extrairDadosParaCrm(apiKey, historico, modelos, contexto = {}) {
  const vazio = { quantidade: null, endereco: null, dataDesejada: null, valorTotal: null };
  try {
    const transcricao = (historico || [])
      .slice(-40)
      .map((m) => `${m.role === "user" ? "Cliente" : "Vendedora"}: ${m.text}`)
      .join("\n");

    if (!transcricao.trim()) return vazio;

    const schema = {
      type: "OBJECT",
      properties: {
        quantidade: { type: "INTEGER", nullable: true },
        endereco: {
          type: "OBJECT",
          nullable: true,
          properties: {
            cep: { type: "STRING" },
            rua: { type: "STRING" },
            numero: { type: "STRING" },
            bairro: { type: "STRING" },
            cidade: { type: "STRING" },
            estado: { type: "STRING" },
          },
        },
        dataDesejada: { type: "STRING", nullable: true },
        valorTotal: { type: "NUMBER", nullable: true },
      },
    };

    // O modelo não tem relógio: sem dizer a data de hoje, "dia 5" virava um chute
    // (já produziu 2024-05-05 pra um "dia cinco" em julho/2026).
    const hoje = hojeISOBrasilia();

    const prompt = `HOJE É ${hoje} (fuso de Brasília). Use SEMPRE esta data como referência para qualquer data relativa.\n\n` +
      "Leia a conversa de vendas abaixo e extraia, SE EXISTIREM:\n" +
      "1. A quantidade de frascos que o cliente vai comprar (número inteiro).\n" +
      "2. O endereço de entrega, separado em cep/rua/numero/bairro/cidade/estado. O que não tiver, deixe em branco (\"\").\n" +
      "3. Só se o cliente pediu EXPLICITAMENTE uma data futura específica para pagar/vencer (ex.: \"só posso pagar dia 27\", \"pode ser pro dia 10 do mês que vem\"), essa data no formato AAAA-MM-DD. REGRAS DA DATA: ela é SEMPRE no futuro em relação a HOJE; se o cliente disser só o dia (\"dia 5\"), use a PRÓXIMA vez que esse dia acontece a partir de hoje (se já passou neste mês, é no mês seguinte); nunca devolva uma data anterior a HOJE. Se o cliente não mencionou nenhuma data específica (combinou pagar \"agora\"/\"hoje\"/\"amanhã\", ou não falou nada sobre isso), deixe null. Não invente nada que não esteja escrito.\n" +
      "4. O valor TOTAL em reais que a vendedora e o cliente combinaram pra essa compra (ela normalmente diz o preço na conversa, ex.: \"fica R$149,90\"). Número com ponto decimal (ex.: 149.90). Só extraia um valor que tenha sido dito de fato na conversa — nunca calcule ou invente um valor. Se não ficou claro, deixe null.\n\n" +
      "CONVERSA:\n" + transcricao;

    const data = await chamarGemini(apiKey, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    }, modelos, { ...contexto, etapa: "extracaoCrm" });

    const textoResposta = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = JSON.parse(textoResposta);

    const quantidade = Number.isFinite(parsed.quantidade) && parsed.quantidade > 0 ? parsed.quantidade : null;
    const endereco = parsed.endereco && typeof parsed.endereco === "object" ? parsed.endereco : null;
    // Trava de sanidade: mesmo avisado da data de hoje, o modelo erra. Data no
    // passado viraria pedido "VENCIDO" falso (e, na agenda, cobrança errada);
    // data absurda no futuro idem. Fora da janela, melhor não mandar nada.
    let dataDesejada = typeof parsed.dataDesejada === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dataDesejada)
      ? parsed.dataDesejada
      : null;
    if (dataDesejada) {
      const limite = new Date(`${hoje}T12:00:00Z`);
      limite.setUTCFullYear(limite.getUTCFullYear() + 1);
      const limiteISO = limite.toISOString().slice(0, 10);
      if (dataDesejada < hoje || dataDesejada > limiteISO) {
        logger.warn("extrairDadosParaCrm — data extraida fora da janela, descartada", {
          ...contexto, dataDesejada, hoje, limiteISO,
        });
        dataDesejada = null;
      }
    }
    const valorTotal = Number.isFinite(parsed.valorTotal) && parsed.valorTotal > 0 ? parsed.valorTotal : null;

    return { quantidade, endereco, dataDesejada, valorTotal };
  } catch (err) {
    logger.warn("extrairDadosParaCrm — falha na extracao, seguindo sem dados estruturados", {
      ...contexto, error: String(err).slice(0, 200),
    });
    return vazio;
  }
}

// ----------------------------------------
// ping — Cloud Function de teste
// Retorna um JSON simples pra confirmar que o deploy funcionou.
// ----------------------------------------
exports.ping = onRequest((request, response) => {
  logger.info("ping called", { method: request.method });
  response.json({
    status: "ok",
    message: "Cloud Function funcionando!",
    method: request.method,
    timestamp: new Date().toISOString(),
  });
});

// ----------------------------------------
// buildAgentSystemPrompt — monta o system prompt do agente
// Nasceu como cópia de src/services/aiService.ts, mas ESTE é o que atende de
// verdade: o do frontend (chat de teste) ficou para trás e não tem os atributos
// do marcador. Ao mexer aqui, lembrar que o chat de teste não acompanha.
// ----------------------------------------
function buildAgentSystemPrompt(config, cases) {
  const sections = [config.base.trim()];

  // A IA não tem relógio. Sem isto ela chuta datas ao combinar prazo com o
  // cliente — na extração, um "dia cinco" em julho/2026 já virou 2024-05-05.
  sections.push(
    `\nDATA DE HOJE: ${hojePorExtensoBrasilia()}. Use SEMPRE esta data como referência ao falar de prazos, vencimentos ou datas combinadas com o cliente.`
  );

  if (config.tone && config.tone.trim()) {
    sections.push(
      `\nTOM DE VOZ: responda sempre com o seguinte tom: ${config.tone.trim()}`
    );
  }

  if (config.handoffRule && config.handoffRule.trim()) {
    sections.push(
      `\nCONDIÇÃO DE LEAD PRONTO (OBRIGATÓRIO):
Quando a seguinte situação ocorrer — ${config.handoffRule.trim()} — você DEVE obrigatoriamente adicionar o marcador [LEAD_PRONTO] ao final absoluto da sua resposta.

O marcador carrega a forma de pagamento, quando o cliente vai pagar e, quando a forma for boleto, o valor total e o nome do cliente:
[LEAD_PRONTO forma=<pix|boleto|cartao> valor=<valor total em reais> pagar=<agora|depois> nome=<nome completo do cliente>]
- "forma" é a forma que o cliente escolheu, sem acento: pix, boleto ou cartao.
- "valor" é o valor TOTAL da compra conforme a tabela de preços, com ponto decimal (ex.: 149.90). OBRIGATÓRIO quando forma=boleto; nas demais formas pode ser omitido.
- "pagar" diz QUANDO o cliente vai pagar: use "agora" quando ele vai pagar já, hoje ou nos próximos dias; use "depois" APENAS quando ele avisou que só consegue pagar numa data futura específica (ex.: "só recebo dia 5", "pode deixar pro dia 27", "meu salário cai dia 10"). Na dúvida, use "agora".
- "nome" é o nome completo que o cliente informou, para emitir o boleto no nome dele. OBRIGATÓRIO quando forma=boleto e deve ser SEMPRE o ÚLTIMO atributo do marcador (pode conter espaços). Nas demais formas, omita.
- Exemplo boleto agora: [LEAD_PRONTO forma=boleto valor=249.90 pagar=agora nome=João da Silva]
- Exemplo boleto para data futura: [LEAD_PRONTO forma=boleto valor=149.90 pagar=depois nome=Maria Souza]
- Exemplo pix: [LEAD_PRONTO forma=pix pagar=agora]

Regras rigorosas para a emissão do marcador:
1. O marcador deve ser escrito exatamente nesse formato (LEAD_PRONTO em maiúsculas, entre colchetes) em uma LINHA TOTALMENTE ISOLADA no final absoluto de toda a sua resposta.
2. O marcador deve ficar sempre DEPOIS da última linha de conteúdo e DEPOIS de qualquer separador de mensagens "---" (caso esteja no formato split). O marcador NÃO é uma mensagem para o cliente e NÃO deve ser tratado como uma das partes do split. Não insira outro separador "---" após o marcador.
3. Este marcador é de uso estritamente interno do sistema e invisível para o cliente. NUNCA mencione, explique ou faça referência ao marcador na conversa, e NUNCA escreva o valor ou a forma como se fossem texto para o cliente.
4. Você deve CONTINUAR conversando e atendendo o cliente normalmente, respondendo suas dúvidas e conduzindo o fechamento como se você fosse o vendedor. NÃO pare de responder e NÃO encerre o fluxo.
5. Quando forma=boleto e pagar=agora, NÃO escreva você mesma nenhum link, código de barras ou linha digitável — o sistema anexa o boleto automaticamente logo após a sua mensagem de transição. Apenas conduza normalmente ("já te envio por aqui").
6. Quando pagar=depois, o boleto NÃO é emitido agora: ele só é gerado perto da data que o cliente combinou, senão vence antes de ele conseguir pagar. Portanto, NUNCA diga que vai mandar o boleto agora nem peça para ele aguardar o envio — ele não vai receber nada e vai ficar esperando à toa. Em vez disso, confirme o combinado com naturalidade e deixe claro que VOCÊ volta a procurá-lo perto da data. Ex.: "Perfeito, deixo tudo reservado aqui pra você. Uns dias antes do dia 5 eu te chamo pra mandar o boleto certinho, pode ser?"
7. O ideal é sempre o cliente pagar o quanto antes — só trate como data futura quando ELE pedir. Não ofereça nem sugira pagar depois por conta própria.

Exemplo de formato de resposta quando a condição de lead pronto ocorre (boleto, pagando agora):
Perfeito! Vou gerar o seu boleto aqui com o vencimento certinho.
---
Só um minutinho que já te envio por aqui mesmo.
[LEAD_PRONTO forma=boleto valor=149.90 pagar=agora]

Exemplo quando o cliente só vai pagar numa data futura:
Combinado, Maria! Já deixo o seu pedido reservado aqui no sistema.
---
Uns dias antes do dia 5 eu te chamo pra te mandar o boleto certinho, tudo bem?
[LEAD_PRONTO forma=boleto valor=149.90 pagar=depois nome=Maria Souza]`
    );
  }

  if (
    config.responseMode === "split" &&
    config.maxMessages &&
    config.maxMessages > 1
  ) {
    sections.push(
      `\nFORMATO DE RESPOSTA: divida sua resposta em no máximo ${config.maxMessages} mensagens curtas e separadas. Separe cada mensagem com uma linha contendo exatamente '---' (três hifens), e nada mais nessa linha. Não use '---' dentro do conteúdo de uma mensagem.`
    );
  } else {
    sections.push(
      `\nFORMATO DE RESPOSTA: responda em uma única mensagem. Não use o separador '---'.`
    );
  }

  // Injeção de Casos de Treinamento
  if (cases && cases.length > 0) {
    const goodCases = cases.filter(c => c.kind === "good" && c.content && c.content.trim());
    const badCases = cases.filter(c => c.kind === "bad" && c.content && c.content.trim());

    if (goodCases.length > 0 || badCases.length > 0) {
      let casesSection = "\nEXEMPLOS REAIS DE ATENDIMENTO:\nAbaixo estão exemplos reais de conversas de atendimento. Eles mostram, na prática, o jeito de conduzir a conversa. Estude o estilo, o tom e a forma de conduzir — não copie o texto literalmente, use como referência de como agir.\n";

      if (goodCases.length > 0) {
        casesSection += "\nEXEMPLOS DE COMO CONDUZIR BEM (siga este estilo):\n";
        goodCases.forEach(c => {
          casesSection += `\n${c.content.trim()}\n`;
        });
      }

      if (badCases.length > 0) {
        casesSection += "\nEXEMPLOS DO QUE EVITAR (NÃO conduza assim):\n";
        badCases.forEach(c => {
          casesSection += `\n${c.content.trim()}\n`;
        });
      }

      sections.push(casesSection);
    }
  }

  return sections.join("\n");
}

// ----------------------------------------
// processarWebhookCanal — miolo COMPARTILHADO entre os provedores.
// ----------------------------------------
// Recebe a mensagem do lead (já no formato do Responde Chat — o ConverteChat é
// traduzido para cá pelo adaptador em webhookConverteChat), gera a resposta da
// Patrícia via Gemini e envia de volta pelo provedor de origem.
// @param {Object} provider Entrada de PROVIDERS (define token e URL de envio).
async function processarWebhookCanal(provider, request, response) {
  try {
    // 1. Aceitar apenas POST
    if (request.method !== 'POST') {
      logger.info("webhookRespondeChat — metodo nao permitido", { method: request.method });
      return response.status(200).json({ ignored: true, reason: "metodo_nao_permitido" });
    }

    // 2. Validar payload básico
    if (!request.body || !request.body.message) {
      logger.info("webhookRespondeChat — payload sem message", { body: JSON.stringify(request.body) });
      return response.status(200).json({ ignored: true, reason: "sem_message" });
    }

    // 3. Ignorar eventos de status
    const validEvents = ['mensagem.upsert', 'messages.upsert', 'message.upsert'];
    if (request.body.event && !validEvents.includes(request.body.event)) {
      logger.info("webhookRespondeChat — evento ignorado", { event: request.body.event });
      return response.status(200).json({ ignored: true, reason: "evento_ignorado" });
    }

    const raw = request.body.message.raw || {};
    const key = raw.key || {};

    // 4. Detectar mensagem de SAÍDA (própria da IA, funil, remarketing ou
    // atendente humano). Ela NUNCA gera resposta (anti-loop). Mais abaixo, se
    // não for eco da IA e a conversa já existir, guardamos no histórico para
    // dar contexto à IA (evita responder "no escuro").
    const isFromMe = key.fromMe === true || raw.IsFromMe === true;

    // 5. Ignorar grupos
    if (key.remoteJid && key.remoteJid.includes('@g.us')) {
      logger.info("webhookRespondeChat — mensagem de grupo ignorada", { jid: key.remoteJid });
      return response.status(200).json({ ignored: true, reason: "grupo" });
    }

    // 6. Extrair número de telefone
    let numero = "";
    if (key.remoteJid) {
      numero = key.remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');
    }
    if (!numero && request.body.contact?.number) {
      numero = request.body.contact.number;
    }
    if (!numero && request.body.phone) {
      numero = request.body.phone;
    }
    if (!numero) {
      logger.warn("webhookRespondeChat — numero nao encontrado");
      return response.status(200).json({ ignored: true, reason: "numero_nao_encontrado" });
    }

    // Nome do contato (o ConverteChat manda em contact.name). Guardado na conversa
    // para exibir na bancada; opcional (RC pode não mandar).
    const nomeCliente = String(request.body.contact?.name || "").trim();

    logger.info("DIAG_MIDIA_PAYLOAD", {
      numero,
      type: request.body.message?.type,
      mediaUrl: request.body.message?.mediaUrl,
      messageKeys: Object.keys(request.body.message || {}),
      rawKeys: Object.keys(raw || {}),
      imageMessageKeys: raw?.imageMessage ? Object.keys(raw.imageMessage) : null,
      stickerMessageKeys: raw?.stickerMessage ? Object.keys(raw.stickerMessage) : null,
      candidateUrls: {
        msgMediaUrl: request.body.message?.mediaUrl,
        imageUrl: raw?.imageMessage?.url,
        stickerUrl: raw?.stickerMessage?.url
      }
    });

    const agenteSlug = request.query.agente || null;
    // Canal de origem (ex.: claro2, claro4) vem da URL do webhook (?...&canal=claro2).
    // Cada conexão do Responde Chat tem token próprio; a resposta precisa sair pelo
    // MESMO canal que recebeu a mensagem, senão vai tudo pelo canal padrão.
    const canal = request.query.canal || null;
    // Rede de segurança: com o "canal padrão" aposentado (todo chip tem &canal=),
    // mensagem SEM canal é sinal de URL mal configurada. Ainda respondemos pelo
    // token/webhooks globais para não perder o lead, mas registramos o aviso.
    if (!canal) {
      logger.warn("webhookRespondeChat — mensagem SEM &canal= (usando fallback global)", {
        numero, agenteSlug, provider: provider.nome,
      });
    }

    // 7. Extrair texto da mensagem
    let texto = request.body.message?.body || "";
    if (!texto) {
      texto = raw?.extendedTextMessage?.text ||
              raw?.conversation ||
              raw?.message?.extendedTextMessage?.text ||
              raw?.message?.conversation ||
              "";
    }

    // 8. Validar slug e buscar agente por slug no Firestore
    if (!agenteSlug) {
      logger.info("webhookRespondeChat — sem slug na URL");
      return response.status(200).json({ error: "semSlug" });
    }

    // 8b. A conversa só nasce no último passo do funil (ativarAgente). Enquanto
    // ela não existe, a mensagem NÃO gera resposta — mas também não é jogada
    // fora: vai para um buffer que o ativarAgente consome ao criar a conversa.
    // Assim a IA herda o contexto do que já foi dito (funil e cliente) e, se o
    // cliente respondeu ao áudio final perdendo a corrida por segundos, o
    // ativarAgente reenvia a mensagem para cá e ela é atendida.
    const convDocId = numero + "_" + agenteSlug;
    const convRef = admin.firestore().collection("conversations").doc(convDocId);
    const convSnapInicial = await convRef.get();
    if (!convSnapInicial.exists) {
      if (request.body.replayDoBuffer === true) {
        // Não pode acontecer: o replay só parte do ativarAgente, que acabou de
        // criar a conversa. Se acontecer, bufferizar de novo criaria um laço.
        logger.warn("webhookRespondeChat — replay sem conversa, ignorado", { numero, agenteSlug });
        return response.status(200).json({ ignored: true, reason: "replay_sem_conversa" });
      }
      await bufferizarMensagem({
        numero, agenteSlug, texto, isFromMe, body: request.body,
        canal, provider: provider.nome,
      });
      return response.status(200).json({ ignored: true, reason: "bufferizado" });
    }

    // 8c. Mensagem de SAÍDA (funil, remarketing ou atendente humano): NÃO gera
    // resposta. Se não for eco da própria IA, guarda no histórico para a IA ter
    // contexto do que já foi dito ao cliente (evita responder "no escuro").
    if (isFromMe) {
      const textoSaida = (texto && texto.trim()) ? texto.trim() : "[mensagem enviada ao cliente]";
      const msgsSaida = Array.isArray(convSnapInicial.data().messages)
        ? convSnapInicial.data().messages
        : [];
      // Dedup: se o texto já aparece nas últimas mensagens da IA (inclusive
      // partes de um split), é eco da própria IA — ignora.
      const recentesModel = msgsSaida.slice(-6).filter((m) => m.role === "model");
      const ecoDaIA = recentesModel.some(
        (m) => typeof m.text === "string" && m.text.includes(textoSaida)
      );
      if (ecoDaIA) {
        logger.info("webhookRespondeChat — saida eco da propria IA, ignorada", { numero });
        return response.status(200).json({ ignored: true, reason: "eco_ia" });
      }
      msgsSaida.push({ role: "model", text: textoSaida, ts: Date.now() });
      await convRef.set(
        { messages: msgsSaida, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      logger.info("webhookRespondeChat — saida externa guardada no historico", { numero, textoSaida });
      return response.status(200).json({ ignored: true, reason: "saida_externa_guardada" });
    }

    const agentSnap = await admin
      .firestore()
      .collection("agents")
      .where("slug", "==", agenteSlug)
      .limit(1)
      .get();

    if (agentSnap.empty) {
      logger.warn("webhookRespondeChat — agente nao encontrado", { slug: agenteSlug });
      return response.status(200).json({ error: "agenteNaoEncontrado" });
    }

    const agentDoc = agentSnap.docs[0];
    const agent = { id: agentDoc.id, ...agentDoc.data() };

    // Buscar casos do agente no Firestore
    const casesSnap = await admin
      .firestore()
      .collection("agentCases")
      .where("agentId", "==", agent.id)
      .get();
    const cases = casesSnap.docs.map((doc) => doc.data());

    // 9. Ler configurações do app (Gemini API Key e Respondechat Token)
    const settingsSnap = await admin
      .firestore()
      .doc("settings/app")
      .get();

    const geminiApiKey = settingsSnap.exists
      ? settingsSnap.data().geminiApiKey
      : null;

    if (!geminiApiKey) {
      logger.warn("webhookRespondeChat — sem chave gemini");
      return response.status(200).json({ error: "semChave" });
    }

    const modelosGemini = resolverModelosGemini(settingsSnap.exists ? settingsSnap.data() : null);

    // 9b. Chip desligado na mão (Configurações): a IA NÃO responde neste número.
    // Serve para pausar um chip (ex.: evitar loop de IA-responde-IA em teste)
    // sem desconectar nada. Só vale para chip nomeado; o canal padrão não tem
    // esse liga/desliga por enquanto.
    if (canal && settingsSnap.exists) {
      const chipCfg = (settingsSnap.data().canais || {})[canal];
      if (chipCfg && chipCfg.ativo === false) {
        logger.info("webhookRespondeChat — chip desativado, ignorando", { canal, numero });
        return response.status(200).json({ ignored: true, reason: "chip_desativado" });
      }
    }

    // Reservar timestamp para debounce no início (convRef já validado acima)
    const meuTs = Date.now();
    await convRef.set({ ultimaMensagemTs: meuTs }, { merge: true });

    // --- TRANSCRIÇÃO DE ÁUDIO (Gatilho) ---
    const isAudio = request.body.message?.type === "audio" && request.body.message?.mediaUrl;
    let transcricaoSucesso = false;

    if (isAudio) {
      try {
        const mediaUrl = request.body.message.mediaUrl;
        logger.info("webhookRespondeChat — baixando audio para transcricao", { numero, mediaUrl });

        const audioRes = await fetch(mediaUrl);
        if (!audioRes.ok) {
          throw new Error(`Falha ao baixar o audio. Status: ${audioRes.status}`);
        }

        const audioBuffer = await audioRes.arrayBuffer();
        const base64Audio = Buffer.from(audioBuffer).toString("base64");

        logger.info("webhookRespondeChat — enviando audio para transcricao no Gemini", { numero });

        const transData = await chamarGemini(geminiApiKey, {
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: "audio/mpeg",
                  data: base64Audio
                }
              },
              {
                text: "Transcreva exatamente o que foi dito neste áudio, em português. Responda apenas com a transcrição, sem comentários."
              }
            ]
          }]
        }, modelosGemini, { numero, etapa: "transcricao" });

        const transcricao = transData.candidates?.[0]?.content?.parts?.[0]?.text || "";

        if (transcricao.trim()) {
          logger.info("webhookRespondeChat — transcricao concluida", { numero, transcricao: transcricao.trim() });
          texto = transcricao.trim();
          transcricaoSucesso = true;
        } else {
          logger.warn("webhookRespondeChat — transcricao retornou vazia");
        }
      } catch (errTrans) {
        logger.error("webhookRespondeChat — erro durante o processo de transcricao de audio", {
          error: String(errTrans),
          stack: errTrans.stack
        });
      }

      // Se a transcricao falhar por qualquer razao, limpamos o texto para forcar o fallback
      if (!transcricaoSucesso) {
        texto = "";
      }
    }

    // --- LEITURA DE IMAGEM/FIGURINHA ---
    const isImagemOuFigurinha = (request.body.message?.type === "image" || request.body.message?.type === "sticker") && request.body.message?.mediaUrl;
    let leituraMidiaSucesso = false;

    if (isImagemOuFigurinha) {
      try {
        // Zerar texto para evitar poluição do campo body nas imagens
        texto = "";
        const mediaUrl = request.body.message.mediaUrl;
        const mediaType = request.body.message.type;
        logger.info("webhookRespondeChat — baixando imagem/figurinha para leitura", { numero, mediaUrl, mediaType });

        const mediaRes = await fetch(mediaUrl);
        if (!mediaRes.ok) {
          throw new Error(`Falha ao baixar a mídia. Status: ${mediaRes.status}`);
        }

        const mediaBuffer = await mediaRes.arrayBuffer();
        const base64Media = Buffer.from(mediaBuffer).toString("base64");

        // Determinar o tipo mime correto (webp para sticker, raw?.imageMessage?.mimetype ou image/jpeg para image)
        const mimeType = mediaType === "sticker"
          ? "image/webp"
          : (request.body.message?.raw?.imageMessage?.mimetype || "image/jpeg");

        logger.info("webhookRespondeChat — enviando imagem/figurinha para leitura no Gemini", { numero, mimeType });

        const visionData = await chamarGemini(geminiApiKey, {
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Media
                }
              },
              {
                text: "Você está lendo uma imagem ou figurinha que um cliente enviou em uma conversa de vendas pelo WhatsApp. Descreva de forma objetiva e em português o que a imagem mostra. Se houver QUALQUER texto na imagem (endereço, nome, número, comprovante, documento), transcreva-o fielmente. Se for uma figurinha, descreva o gesto ou emoção que ela expressa (ex.: positivo/joinha, ok, mãos pedindo, coração, risada). Responda apenas com a descrição e o texto extraído, sem comentários, sem saudação e sem inventar nada que não esteja visível."
              }
            ]
          }]
        }, modelosGemini, { numero, etapa: "visao" });

        const descricao = visionData.candidates?.[0]?.content?.parts?.[0]?.text || "";

        if (descricao.trim()) {
          logger.info("DIAG_MIDIA_LEITURA", { numero, descricao: descricao.trim() });
          texto = `[O cliente enviou uma imagem. Conteúdo: ${descricao.trim()}]`;
          leituraMidiaSucesso = true;
        } else {
          logger.warn("webhookRespondeChat — leitura de mídia retornou vazia");
        }
      } catch (errMedia) {
        logger.error("webhookRespondeChat — erro durante o processo de leitura de imagem/figurinha", {
          error: String(errMedia),
          stack: errMedia.stack
        });
      }

      // Se a leitura falhar, mantemos o texto vazio para acionar o fallback padrão
      if (!leituraMidiaSucesso) {
        texto = "";
      }
    }

    // 10. Montar systemPrompt
    const systemPrompt = buildAgentSystemPrompt({
      base: agent.base || "",
      tone: agent.tone,
      handoffRule: agent.handoffRule,
      responseMode: agent.responseMode,
      maxMessages: agent.maxMessages,
    }, cases);

    // 11. Ler histórico de conversa do Firestore (referências já criadas anteriormente)
    const convSnap = await convRef.get();
    const historico = convSnap.exists && Array.isArray(convSnap.data().messages)
      ? convSnap.data().messages
      : [];

    let iaAcionadaEnviado = convSnap.exists ? !!convSnap.data().iaAcionadaEnviado : false;

    // 12. Checar interruptor: só responde se ativo === true
    const ativo = convSnap.exists && convSnap.data().ativo === true;
    const estavaArquivada = convSnap.exists && convSnap.data().arquivada === true;

    if (!ativo) {
      // Gravar a mensagem do cliente no histórico (para visibilidade na bancada).
      // Não força reativação: respeita desligamento manual do vendedor ou reset de conversa.
      historico.push({ role: "user", text: texto || "[áudio recebido]", ts: Date.now() });
      const payloadDesligado = {
        messages: historico,
        numero,
        agenteSlug,
        status: "ativa",
        remarketingEnviado: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (estavaArquivada) {
        payloadDesligado.arquivada = false;
      }
      await convRef.set(payloadDesligado, { merge: true });
      logger.info("webhookRespondeChat — patricia desligada para este cliente, mensagem gravada sem resposta", { numero, agenteSlug });
      return response.status(200).json({ ignored: "desligado", numero });
    }

    // --- A partir daqui, Patrícia está LIGADA (ativo === true) ---

    // 13. Debounce: calcular tempo com base no configurado no agente
    const debounceSeg = agent.debounceSegundos ?? 8;
    const debounceMs = Math.max(0, Math.min(30, debounceSeg)) * 1000;

    // Cliente mandou CEP: resolvemos na hora e anexamos o endereço à mensagem,
    // no mesmo padrão da leitura de imagem. Sem isso a Patrícia pede rua e bairro
    // que o próprio CEP já entrega — atrito à toa. CEP genérico (sem logradouro)
    // não vira nota: aí ela precisa mesmo perguntar.
    let notaCep = null;
    const cepDetectado = extrairCep(texto);
    if (cepDetectado) {
      const end = await consultarCep(cepDetectado);
      if (end && end.rua) {
        notaCep = `[Endereço do CEP ${end.cep}: ${end.rua}, ${end.bairro}, ${end.cidade}/${end.estado}. Confirmado pelos Correios — não peça rua nem bairro, peça apenas o número (e complemento, se houver).]`;
        logger.info("webhookRespondeChat — CEP resolvido", { numero, cep: end.cep, cidade: end.cidade, uf: end.estado });
      } else {
        logger.info("webhookRespondeChat — CEP sem logradouro ou nao encontrado", { numero, cep: cepDetectado });
      }
    }

    const textoParaHistorico = (!texto)
      ? "[áudio recebido]"
      : (notaCep ? `${texto}\n${notaCep}` : texto);

    historico.push({ role: "user", text: textoParaHistorico, ts: meuTs });

    const payloadCaminhoB = {
      messages: historico,
      numero,
      agenteSlug,
      status: "ativa",
      ultimaMensagemTs: meuTs,
      remarketingEnviado: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (estavaArquivada) {
      payloadCaminhoB.arquivada = false;
    }

    await convRef.set(payloadCaminhoB, { merge: true });

    let historicoAtualizado = historico;

    if (debounceMs > 0) {
      // 14. Esperar debounceMs (janela de debounce)
      await new Promise((r) => setTimeout(r, debounceMs));

      // 15. Reler o documento e verificar se sou a execução mais recente
      const convSnap2 = await convRef.get();
      const ultimoTs = convSnap2.exists ? convSnap2.data().ultimaMensagemTs : null;

      if (ultimoTs !== meuTs) {
        logger.info("webhookRespondeChat — debounce: desisto, mensagem mais nova chegou", {
          numero, meuTs, ultimoTs,
        });
        return response.status(200).json({ ignored: "debounce" });
      }

      // 16. Sou a execução vencedora — usar histórico atualizado
      historicoAtualizado = convSnap2.exists && Array.isArray(convSnap2.data().messages)
        ? convSnap2.data().messages
        : [];

      iaAcionadaEnviado = convSnap2.exists ? !!convSnap2.data().iaAcionadaEnviado : false;
    }

    let mensagens;
    let respostaTipo = "normal";

    // 17. Se não é texto (áudio/mídia): responder pedindo texto sem chamar Gemini
    if (!texto) {
      const respostaAudio = "Oi! 😊 No momento consigo te entender melhor por mensagem escrita. Pode me mandar sua dúvida em texto, por favor?";
      const agora = Date.now();

      historicoAtualizado.push({ role: "model", text: respostaAudio, ts: agora });

      await convRef.set(
        {
          messages: historicoAtualizado,
          numero,
          agenteSlug,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      mensagens = [respostaAudio];
      respostaTipo = "pedidoTexto";

      logger.info("webhookRespondeChat — mídia recebida, pedido de texto enviado", {
        numero,
        agenteSlug,
      });
    } else {
      // 18. Texto normal: fluxo Gemini completo

      // Pegar últimas 20 mensagens do histórico atualizado
      const ultimas20 = historicoAtualizado.slice(-20);
      const contents = ultimas20.map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      }));

      // Chamar Gemini (com retry e fallback de modelo)
      let geminiData;
      try {
        geminiData = await chamarGemini(geminiApiKey, {
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            // O Gemini Flash usa tokens de "thinking" que contam no limite de
            // saída. Desligamos (budget 0) para evitar respostas cortadas em
            // objeções longas, reduzir custo e ganhar velocidade.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }, modelosGemini, { numero, agenteSlug, etapa: "resposta" });
      } catch (errGemini) {
        await marcarFalhaIA(convRef, errGemini, { numero, agenteSlug, canal, nomeCliente },
          settingsSnap.exists ? settingsSnap.data() : null);
        return response
          .status(200)
          .json({ error: "geminiApiError", detalhe: String(errGemini) });
      }

      // Extrair texto da resposta
      const respostaCrua =
        geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // 10b. Detecção e remoção preliminar do marcador de lead pronto
      let leadPronto = false;
      let formaPagamento = null;
      let valorBoleto = null;
      let nomeBoleto = null;
      let pagamentoAdiado = false;
      let respostaLimpa = respostaCrua;
      // Aceita [LEAD_PRONTO] ou [LEAD_PRONTO forma=boleto valor=149.90 pagar=depois nome=João Silva]
      // (forma/valor/pagar em qualquer ordem; nome, se houver, é sempre o último — pode ter espaços).
      const regexDetect = /^[ \t]*\[LEAD_PRONTO([^\]]*)\][ \t]*$/mi;
      const matchLead = respostaLimpa.match(regexDetect);
      if (matchLead) {
        leadPronto = true;
        const attrs = matchLead[1] || "";
        const fm = attrs.match(/forma\s*=\s*([a-zà-ú]+)/i);
        const vm = attrs.match(/valor\s*=\s*([\d.,]+)/i);
        const pm = attrs.match(/pagar\s*=\s*([a-zà-ú]+)/i);
        const nm = attrs.match(/nome\s*=\s*(.+?)\s*$/i);
        formaPagamento = fm ? fm[1].toLowerCase() : null;
        valorBoleto = vm ? parseValorBRL(vm[1]) : null;
        // Só "depois" adia; qualquer outra coisa (ou ausência) cobra na hora —
        // o default seguro é o comportamento antigo, de emitir agora.
        pagamentoAdiado = pm ? pm[1].toLowerCase().startsWith("depois") : false;
        // remove sobra caso o modelo ponha forma/valor/pagar DEPOIS do nome; limita tamanho
        nomeBoleto = nm ? nm[1].replace(/\s+(?:forma|valor|pagar)\s*=.*$/i, "").trim().slice(0, 80) : null;
        logger.info("lead pronto detectado", {
          numero, agenteSlug, formaPagamento, valorBoleto, nomeBoleto, pagamentoAdiado,
        });

        // Remover a(s) linha(s) do marcador (com ou sem atributos)
        respostaLimpa = respostaLimpa.replace(/^[ \t]*\[LEAD_PRONTO[^\]]*\][ \t]*\r?\n?/gmi, "");
        respostaLimpa = respostaLimpa.replace(/\r?\n?[ \t]*\[LEAD_PRONTO[^\]]*\][ \t]*$/gmi, "");
      }

      respostaLimpa = respostaLimpa.trim();

      // Remover o "---" órfão no final
      if (respostaLimpa.endsWith("---")) {
        respostaLimpa = respostaLimpa.slice(0, -3).trim();
      }

      // Conferência final anti-resposta-dupla: enquanto o Gemini gerava esta
      // resposta, o cliente pode ter enviado outra mensagem. Se isso ocorreu,
      // descartamos esta resposta (não grava histórico, não dispara webhook,
      // não envia) — a execução mais nova responderá de forma consolidada.
      const convSnapPreSend = await convRef.get();
      const ultimoTsPreSend = convSnapPreSend.exists ? convSnapPreSend.data().ultimaMensagemTs : null;
      if (ultimoTsPreSend !== meuTs) {
        logger.info("webhookRespondeChat — resposta descartada, mensagem mais nova chegou durante a geracao", {
          numero, meuTs, ultimoTsPreSend,
        });
        return response.status(200).json({ ignored: "superseded" });
      }

      // Gemini pode devolver 200 com texto vazio (filtro de segurança, corte de
      // token). Sem isso o cliente também ficaria no vácuo, só que sem erro no
      // log. Exceção: em [LEAD_PRONTO] o silêncio é esperado — quem assume é o
      // humano, e o webhook de lead ainda precisa disparar.
      if (!respostaLimpa && !leadPronto) {
        await marcarFalhaIA(convRef, "Gemini devolveu resposta vazia", {
          numero, agenteSlug, canal, nomeCliente, finishReason: geminiData.candidates?.[0]?.finishReason,
        }, settingsSnap.exists ? settingsSnap.data() : null);
        return response.status(200).json({ error: "respostaVazia", numero });
      }

      // Gravar histórico no Firestore (resposta da IA limpa)
      const agora = Date.now();
      historicoAtualizado.push({ role: "model", text: respostaLimpa, ts: agora });

      const updateData = {
        messages: historicoAtualizado,
        numero,
        agenteSlug,
        // Zera o alerta: uma nova queda volta a avisar no WhatsApp.
        falhaIA: false,
        falhaIAWebhookEnviado: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Reengajamento: se a conversa tinha recebido remarketing (foi arquivada) e
      // agora o cliente respondeu, ela VOLTA para Ativas e reinicia o ciclo —
      // remarketingEnviado zerado deixa o lead elegível a um novo remarketing se
      // esfriar de novo. Só mexe em quem veio do remarketing (arquivo manual do
      // vendedor não é desfeito).
      if (convSnapInicial.exists && convSnapInicial.data().remarketingEnviado === true) {
        updateData.arquivada = false;
        updateData.remarketingEnviado = false;
        updateData.remarketingTs = admin.firestore.FieldValue.delete();
        logger.info("webhookRespondeChat — lead respondeu ao remarketing, reengajado (volta pra Ativas)", { numero });
      }

      if (leadPronto) {
        updateData.leadPronto = true;
      }
      // Guarda o canal na conversa (útil para debug e para envios futuros fora do webhook).
      if (canal) {
        updateData.canal = canal;
      }
      // Nome do cliente (quando o provedor manda) — para exibir na bancada.
      if (nomeCliente) {
        updateData.nomeCliente = nomeCliente;
      }

      await convRef.set(updateData, { merge: true });

      if (leadPronto) {
        try {
          // Releitura fresca do documento da conversa imediatamente antes de disparar (dedup contra condição de corrida)
          const convSnapFresco = await convRef.get();
          const leadProntoWebhookEnviado = convSnapFresco.exists ? !!convSnapFresco.data().leadProntoWebhookEnviado : false;

          if (!leadProntoWebhookEnviado) {
            const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
            const wh = resolverWebhook(settingsData, canal, "leadPronto", RESPONDECHAT_WEBHOOK_LEAD);
            const webhookUrl = wh.url;
            const webhookAtivo = wh.ativo;

            if (webhookAtivo && webhookUrl) {
              logger.info("Disparando webhook de lead quente", { numero, url: webhookUrl, canal: wh.origem });
              const responseHook = await fetch(webhookUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  client_phone: numero,
                  ...(nomeCliente ? { client_name: nomeCliente } : {}),
                }).toString(),
              });
              const corpoResposta = await responseHook.text();
              logger.info("Resposta do webhook de lead quente", {
                status: responseHook.status,
                corpo: corpoResposta,
              });

              // Grava o flag de dedup para impedir novos disparos neste ciclo
              await convRef.set({ leadProntoWebhookEnviado: true }, { merge: true });
            } else {
              logger.info("disparo lead pronto pulado: webhook inativo ou sem url", {
                ativo: webhookAtivo,
                hasUrl: !!webhookUrl,
              });
            }
          } else {
            logger.info("Disparo de lead pronto pulado por dedup (leitura fresca): webhook ja enviado anteriormente para esta conversa", { numero });
          }
        } catch (err) {
          logger.error("Erro ao disparar webhook de lead quente", err);
        }
      }

      // Extração estruturada best-effort (não mexe no marcador nem no prompt
      // principal). Fica FORA do bloco do CRM porque a data extraída também
      // define o vencimento do boleto logo abaixo — antes, com o CRM desligado,
      // o boleto perdia a data que o cliente pediu.
      let extraido = { quantidade: null, endereco: null, dataDesejada: null, valorTotal: null };
      if (leadPronto) {
        extraido = await extrairDadosParaCrm(
          geminiApiKey, historicoAtualizado, modelosGemini, { numero, agenteSlug }
        );
      }

      // 10d. Pedido direto no CRM — em paralelo ao webhook do ConverteChat acima
      // (que continua etiquetando/movendo o ticket lá). Dedup próprio, então um
      // dos dois pode estar desligado sem afetar o outro.
      if (leadPronto) {
        try {
          const convSnapCrm = await convRef.get();
          const crmWebhookEnviado = convSnapCrm.exists ? !!convSnapCrm.data().crmWebhookEnviado : false;

          if (!crmWebhookEnviado) {
            const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
            const crmCfg = settingsData.crm || {};
            const crmAtivo = crmCfg.ativo !== false;
            const crmApiKey = settingsData.crmApiKey;
            const crmApiUrl = (typeof crmCfg.apiUrl === "string" && crmCfg.apiUrl.trim()) || CRM_URL_PADRAO;

            if (crmAtivo && crmApiKey) {
              const primeiraMensagem = historicoAtualizado.find((m) => typeof m.ts === "number");
              const canalNome = (canal && settingsData.canais && settingsData.canais[canal] && settingsData.canais[canal].nome)
                ? settingsData.canais[canal].nome
                : canal;

              // Valor do pedido, por prioridade:
              // 1) valorBoleto — do marcador, é o que foi de fato cobrado no boleto Asaas;
              // 2) tabela de preços do agente pela quantidade — fonte registrada, não
              //    depende da IA falar o preço na conversa (resolve pix/cartão);
              // 3) valor que a IA mencionou na conversa, se houver.
              const valorTabela = (extraido.quantidade && Array.isArray(agent.tabelaPrecos))
                ? (agent.tabelaPrecos.find((f) => Number(f.quantidade) === Number(extraido.quantidade)) || {}).valor
                : null;
              const valorPedido = valorBoleto || valorTabela || extraido.valorTotal || null;

              // Sem acento: o prompt pede "cartao", mas o marcador aceita acento e a IA
              // às vezes escreve "cartão" — normalizar evita cair fora do caso à toa.
              const formaSemAcento = (formaPagamento || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

              // Vencimento do pedido, por prioridade:
              // 1) pagamento ADIADO — vale a data que o cliente pediu. Nenhum boleto
              //    foi emitido agora, então não há data do Asaas competindo: esta é a
              //    data real do combinado e é ela que a agenda de cobrança persegue.
              // 2) BOLETO emitido agora — a data que o Asaas carimbou no boleto (mesma
              //    config, mesmo helper). Ganha da data pedida porque é a que está
              //    impressa no boleto que o cliente recebeu; mostrar outra ao vendedor
              //    faria ele cobrar pelo dia errado.
              // 3) a data que o cliente pediu, quando pediu;
              // 4) pix e cartão são pagamento na hora — vencem hoje.
              const asaasCfgVenc = settingsData.asaas || {};
              const dataPedidaValida = extraido.dataDesejada && extraido.dataDesejada >= hojeISOBrasilia()
                ? extraido.dataDesejada
                : null;
              // Espelha EXATAMENTE a regra da emissão logo abaixo: data pedida
              // manda, senão o prazo padrão. Se divergir, o vendedor cobra por
              // uma data diferente da impressa no boleto do cliente.
              const boletoVenceEm =
                (!pagamentoAdiado && formaSemAcento === "boleto" &&
                  settingsData.asaasApiKey && asaasCfgVenc.ativo !== false)
                  ? (dataPedidaValida || vencimentoISO(asaasCfgVenc.vencimentoDias))
                  : null;
              const dataVencimento = (pagamentoAdiado && extraido.dataDesejada) ||
                boletoVenceEm || extraido.dataDesejada ||
                ((!pagamentoAdiado && (formaSemAcento === "pix" || formaSemAcento === "cartao"))
                  ? hojeISOBrasilia() : null);

              // Completa o endereço pelo CEP (fonte dos Correios). Só preenche o
              // que a conversa NÃO trouxe: o que o cliente disse explicitamente
              // continua valendo (ele pode corrigir um CEP errado falando a rua).
              // Na prática é o que traz o estado, que quase ninguém escreve.
              let enderecoFinal = extraido.endereco;
              if (enderecoFinal && enderecoFinal.cep) {
                const doCep = await consultarCep(enderecoFinal.cep);
                if (doCep) {
                  enderecoFinal = {
                    ...enderecoFinal,
                    rua: (enderecoFinal.rua || "").trim() || doCep.rua,
                    bairro: (enderecoFinal.bairro || "").trim() || doCep.bairro,
                    cidade: (enderecoFinal.cidade || "").trim() || doCep.cidade,
                    estado: (enderecoFinal.estado || "").trim() || doCep.estado,
                  };
                  logger.info("endereco completado pelo CEP", { numero, cep: doCep.cep, uf: doCep.estado });
                }
              }

              const payloadCrm = {
                nome: nomeBoleto || nomeCliente || undefined,
                telefone: numero,
                produto_id: CRM_PRODUTO_ID_LATTIFAH,
                ...(extraido.quantidade ? { quantidade: extraido.quantidade } : {}),
                ...(enderecoFinal ? { endereco: enderecoFinal } : {}),
                ...(valorPedido ? { valor_total: valorPedido } : {}),
                ...(formaPagamento ? { forma_pagamento: formaPagamento } : {}),
                ...(dataVencimento ? { data_vencimento: dataVencimento } : {}),
                // Marca o pedido que ainda espera emissão do boleto, para a
                // varredura de cobrança saber quem chamar perto do vencimento.
                ...(pagamentoAdiado && formaSemAcento === "boleto" ? { boleto_pendente: true } : {}),
                ...(canalNome ? { canal_whatsapp: canalNome } : {}),
                ...(primeiraMensagem ? { data_lead: new Date(primeiraMensagem.ts).toISOString() } : {}),
              };

              logger.info("Disparando pedido direto pro CRM", { numero, url: crmApiUrl });
              const responseCrm = await fetch(crmApiUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${crmApiKey}`,
                },
                body: JSON.stringify(payloadCrm),
              });
              const corpoRespostaCrm = await responseCrm.text();
              logger.info("Resposta do CRM (pedido direto)", {
                status: responseCrm.status,
                corpo: corpoRespostaCrm.slice(0, 500),
              });

              await convRef.set({ crmWebhookEnviado: true }, { merge: true });
            } else {
              logger.info("disparo direto pro CRM pulado: inativo ou sem chave", {
                ativo: crmAtivo, hasKey: !!crmApiKey,
              });
            }
          } else {
            logger.info("Disparo direto pro CRM pulado por dedup: pedido ja criado nesta conversa", { numero });
          }
        } catch (err) {
          logger.error("Erro ao disparar pedido direto pro CRM", err);
        }
      }

      // Split em mensagens
      const isSplitMode =
        agent.responseMode === "split" &&
        agent.maxMessages &&
        agent.maxMessages > 1;

      if (isSplitMode) {
        let parts = respostaLimpa
          .split(/^---$/m)
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

        const max = agent.maxMessages;

        if (parts.length > max) {
          const allowed = parts.slice(0, max - 1);
          const excess = parts.slice(max - 1).join("\n\n");
          allowed.push(excess);
          parts = allowed;
        }

        mensagens = parts;
      } else {
        mensagens = [respostaLimpa.trim()];
      }

      // Blindagem extra: pós-split
      mensagens = mensagens
        .map((msg) => msg.replace(/\[LEAD_PRONTO[^\]]*\]/gi, "").trim())
        .filter((msg) => msg.length > 0);

      // 10c. Boleto automático via Asaas quando o cliente fechou no boleto.
      //
      // Antes existia UM boleto por conversa, para sempre: se o cliente perdia o
      // boleto, mudava a quantidade ou o boleto vencia, a IA prometia um novo e o
      // código pulava calado — o cliente ficava esperando (caso real 22/07).
      // Agora consultamos o boleto anterior no Asaas e decidimos:
      //   pago            -> não manda nada (a venda já está paga);
      //   vencido         -> gera um novo;
      //   valor mudou     -> gera um novo;
      //   continua válido -> REENVIA o mesmo link/linha (sem cobrança duplicada).
      // BOLETO_INTERVALO_MS protege dos disparos repetidos do marcador.
      if (leadPronto && formaPagamento === "boleto") {
        const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
        const asaasApiKey = settingsData.asaasApiKey;
        const asaasCfg = settingsData.asaas || {};
        const asaasAtivo = asaasCfg.ativo !== false;

        const convBoletoSnap = await convRef.get();
        const dadosConv = convBoletoSnap.exists ? convBoletoSnap.data() : {};
        const boletoIdAnterior = dadosConv.boletoAsaasGerado === true ? dadosConv.boletoAsaasId : null;
        const ultimaAcaoTs = dadosConv.boletoAsaasUltimoEnvioTs || dadosConv.boletoAsaasTs || 0;
        const aindaNaJanela = (Date.now() - ultimaAcaoTs) < BOLETO_INTERVALO_MS;

        if (pagamentoAdiado) {
          // Cliente combinou pagar numa data futura: emitir agora entregaria um
          // boleto que vence ANTES da data dele. A emissão fica para o follow-up
          // perto do vencimento; o prompt instrui a IA a não prometer envio agora.
          logger.info("boleto Asaas adiado: cliente vai pagar em data futura", {
            numero, agenteSlug, valorBoleto,
          });
        } else if (!asaasApiKey || !asaasAtivo) {
          logger.info("boleto Asaas pulado: sem chave ou desativado", {
            numero, temChave: !!asaasApiKey, ativo: asaasAtivo,
          });
        } else if (aindaNaJanela) {
          logger.info("boleto Asaas pulado: acao recente nesta conversa (anti-repeticao)", {
            numero, haMs: Date.now() - ultimaAcaoTs,
          });
        } else {
          // Decide entre reenviar o que existe e emitir um novo.
          let acao = "gerar";
          let existente = null;
          if (boletoIdAnterior) {
            try {
              existente = await consultarBoletoAsaas({
                apiKey: asaasApiKey,
                apiUrl: asaasCfg.apiUrl,
                paymentId: boletoIdAnterior,
                contexto: { numero, agenteSlug },
              });
              const valorMudou = !!valorBoleto && Math.abs(existente.valor - valorBoleto) > 0.005;
              if (existente.pago) acao = "nada";
              else if (existente.vencido || valorMudou) acao = "gerar";
              else acao = "reenviar";
              logger.info("boleto Asaas — decisao sobre boleto anterior", {
                numero, paymentId: boletoIdAnterior, status: existente.status,
                dueDate: existente.dueDate, valorAnterior: existente.valor,
                valorAgora: valorBoleto, acao,
              });
            } catch (err) {
              // Sem saber o estado do boleto anterior, NÃO emitimos outro às cegas:
              // o risco é cobrar o cliente duas vezes. Chama o humano.
              await marcarFalhaIA(convRef,
                `nao foi possivel consultar o boleto anterior no Asaas: ${String(err).slice(0, 200)}`,
                { numero, agenteSlug, canal, nomeCliente }, settingsData);
              acao = "nada";
            }
          }

          const msgsBoleto = [];
          let novosDados = null;

          if (acao === "reenviar") {
            if (existente.bankSlipUrl) {
              msgsBoleto.push(
                `Segue o seu boleto novamente, é só acessar pelo link e pagar no app do seu banco ou imprimir:\n${existente.bankSlipUrl}`
              );
            }
            if (existente.linhaDigitavel) {
              msgsBoleto.push("E se preferir copiar e colar, essa é a linha digitável:");
              msgsBoleto.push(existente.linhaDigitavel);
            }
            if (!msgsBoleto.length) {
              await marcarFalhaIA(convRef,
                `boleto anterior sem link para reenviar (paymentId=${boletoIdAnterior})`,
                { numero, agenteSlug, canal, nomeCliente }, settingsData);
            } else {
              novosDados = {};
              logger.info("boleto Asaas reenviado ao cliente", {
                numero, agenteSlug, paymentId: boletoIdAnterior,
              });
            }
          } else if (acao === "gerar") {
            if (!valorBoleto || valorBoleto < ASAAS_VALOR_MIN || valorBoleto > ASAAS_VALOR_MAX) {
              await marcarFalhaIA(convRef,
                `boleto sem valor válido no marcador (valor=${valorBoleto})`,
                { numero, agenteSlug, canal, nomeCliente }, settingsData);
            } else {
              try {
                // Cliente que quer o boleto AGORA mas pagar numa data combinada
                // (caso real: "preciso do boleto em mãos, pago até terça"): o
                // vencimento é o dia dele, não o prazo padrão. Só aceitamos data
                // de hoje em diante — passado o Asaas recusaria.
                const vencePedido = extraido.dataDesejada && extraido.dataDesejada >= hojeISOBrasilia()
                  ? extraido.dataDesejada
                  : null;

                const boleto = await gerarBoletoAsaas({
                  apiKey: asaasApiKey,
                  apiUrl: asaasCfg.apiUrl,
                  valor: valorBoleto,
                  vencimentoDias: asaasCfg.vencimentoDias,
                  dueDateISO: vencePedido,
                  nome: nomeBoleto,
                  numero, agenteSlug,
                });
                if (vencePedido) {
                  logger.info("boleto Asaas — vencimento na data pedida pelo cliente", {
                    numero, agenteSlug, vencimento: vencePedido,
                  });
                }

                // A linha digitável vai SOZINHA numa mensagem só dela, para o
                // cliente copiar/colar limpo (mesma lógica da chave PIX).
                if (boleto.bankSlipUrl) {
                  msgsBoleto.push(
                    `Aqui está o seu boleto, é só acessar pelo link e pagar no app do seu banco ou imprimir:\n${boleto.bankSlipUrl}`
                  );
                }
                if (boleto.linhaDigitavel) {
                  msgsBoleto.push("E se preferir copiar e colar, essa é a linha digitável:");
                  msgsBoleto.push(boleto.linhaDigitavel);
                }

                novosDados = {
                  boletoAsaasGerado: true,
                  boletoAsaasId: boleto.paymentId,
                  boletoAsaasValor: valorBoleto,
                };
                logger.info("boleto Asaas gerado", {
                  numero, agenteSlug, paymentId: boleto.paymentId, valor: valorBoleto,
                  substituiu: boletoIdAnterior || null,
                });

                // Só agora cancelamos o anterior: se a emissão acima tivesse
                // falhado, cancelar antes deixaria o cliente sem boleto nenhum.
                if (boletoIdAnterior) {
                  await cancelarBoletoAsaas({
                    apiKey: asaasApiKey,
                    apiUrl: asaasCfg.apiUrl,
                    paymentId: boletoIdAnterior,
                    contexto: { numero, agenteSlug },
                  });
                }
              } catch (err) {
                await marcarFalhaIA(convRef,
                  `falha ao gerar boleto Asaas: ${String(err).slice(0, 300)}`,
                  { numero, agenteSlug, canal, nomeCliente }, settingsData);
              }
            }
          } else {
            logger.info("boleto Asaas pulado: nada a fazer", {
              numero, paymentId: boletoIdAnterior, status: existente ? existente.status : null,
            });
          }

          // Envia ao cliente E grava no histórico: sem isso o boleto não aparece
          // na bancada e a IA não sabe que já mandou.
          if (novosDados && msgsBoleto.length) {
            const tsBoleto = Date.now();
            msgsBoleto.forEach((m, i) => {
              mensagens.push(m);
              historicoAtualizado.push({ role: "model", text: m, ts: tsBoleto + i });
            });
            await convRef.set({
              messages: historicoAtualizado,
              boletoAsaasTs: tsBoleto,
              boletoAsaasUltimoEnvioTs: tsBoleto,
              ...novosDados,
            }, { merge: true });
          }
        }
      }

      logger.info("webhookRespondeChat — resposta gerada", {
        numero,
        textoRecebido: texto,
        agenteNome: agent.name,
        agenteSlug,
        systemPrompt,
        respostaCrua,
        mensagens,
      });
    }

    // Webhook "IA acionada" — Dispara apenas uma vez por conversa
    if (!iaAcionadaEnviado) {
      try {
        const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
        const wh = resolverWebhook(settingsData, canal, "iaAcionada", null);
        const webhookUrl = wh.url;
        const webhookAtivo = wh.ativo;

        if (webhookAtivo && webhookUrl) {
          logger.info("Disparando webhook de IA acionada", { numero, url: webhookUrl, canal: wh.origem });
          const responseHook = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              client_phone: numero,
              // Nome REAL do cliente (não um rótulo fixo): senão o fluxo do
              // ConverteChat regrava o contato para "Lead IA". Sem nome, omite.
              ...(nomeCliente ? { client_name: nomeCliente } : {}),
            }).toString(),
          });
          const corpoResposta = await responseHook.text();
          logger.info("Resposta do webhook de IA acionada", {
            status: responseHook.status,
            corpo: corpoResposta,
          });

          if (responseHook.status >= 200 && responseHook.status < 300) {
            await convRef.set({ iaAcionadaEnviado: true }, { merge: true });
            iaAcionadaEnviado = true;
            logger.info("Webhook IA acionada registrado como enviado para esta conversa", { numero });
          }
        } else {
          logger.info("Disparo IA acionada pulado: webhook inativo ou sem URL", {
            ativo: webhookAtivo,
            hasUrl: !!webhookUrl,
          });
        }
      } catch (err) {
        logger.error("Erro ao disparar webhook de IA acionada", err);
      }
    }

    // 19. Token POR CANAL do provedor de origem: cada conexão tem seu token, e a
    // resposta precisa sair pelo mesmo chip que recebeu. O token do canal manda;
    // sem canal ou sem token próprio, cai no token padrão do provedor.
    const settingsDataSend = settingsSnap.exists ? settingsSnap.data() : {};
    const tokenCanal = resolverTokenCanal(provider, settingsDataSend, canal);

    if (!tokenCanal) {
      logger.warn("webhookRespondeChat — sem token do provedor", {
        canal, provider: provider.nome,
      });
      return response.status(200).json({
        error: "semToken",
        mensagens,
      });
    }

    // 20. Enviar cada mensagem ao WhatsApp pelo provedor de origem
    // tokenProprioDoCanal diz se o chip usou token PRÓPRIO ou herdou o padrão —
    // herdar o padrão significa responder por outra conexão, que é justamente a
    // pegadinha que faz a mensagem "sumir" sem erro.
    logger.info("webhookRespondeChat — enviando", {
      numero, canal,
      provider: provider.nome,
      tokenProprioDoCanal: !!provider.tokenDoCanal(
        canal && settingsDataSend.canais && settingsDataSend.canais[canal],
      ),
      qtdMensagens: mensagens.length,
    });
    let enviadas = 0;

    for (let i = 0; i < mensagens.length; i++) {
      // Pausa entre mensagens (não antes da primeira). Mensagem com link (boleto/
      // cartão) demora mais pra assentar no WhatsApp por causa da pré-visualização;
      // sem uma pausa maior, a mensagem de texto seguinte a ultrapassa e a ordem
      // embaralha (Padrão F). Damos mais tempo depois de uma mensagem com URL.
      if (i > 0) {
        const anteriorTemLink = /https?:\/\//i.test(mensagens[i - 1]);
        await new Promise((r) => setTimeout(r, anteriorTemLink ? 6000 : 3000));
      }

      try {
        const sendResponse = await fetch(
          provider.sendUrl,
          {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + tokenCanal,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              number: numero,
              body: mensagens[i],
            }),
          }
        );

        const sendResponseText = await sendResponse.text();

        if (sendResponse.status >= 400) {
          logger.warn("webhookRespondeChat — falha no envio", {
            indice: i,
            status: sendResponse.status,
            body: sendResponseText,
          });
        } else {
          logger.info("webhookRespondeChat — mensagem enviada", {
            indice: i,
            status: sendResponse.status,
            body: sendResponseText,
          });
          enviadas++;
        }
      } catch (sendErr) {
        logger.warn("webhookRespondeChat — excecao no envio", {
          indice: i,
          error: String(sendErr),
        });
      }
    }

    // 21. Responder 200
    return response.status(200).json({
      ok: true,
      ...(respostaTipo === "pedidoTexto"
        ? { tipo: "pedidoTexto" }
        : { enviadas, total: mensagens.length }),
      numero,
    });
  } catch (err) {
    logger.error("webhookRespondeChat — excecao", {
      error: String(err),
      stack: err.stack,
    });
    return response.status(200).json({
      error: "excecao",
      detalhe: String(err),
    });
  }
}

// ----------------------------------------
// webhookRespondeChat — entrada do Responde Chat
// ----------------------------------------
// ?provider= permite ao replay do buffer (consumirBuffer) mandar a resposta
// SAIR pela API de outro provedor (ex.: convertechat) mesmo entrando por aqui,
// já que o payload bufferizado fica guardado no formato interno.
exports.webhookRespondeChat = onRequest((request, response) =>
  processarWebhookCanal(
    PROVIDERS[request.query.provider] || PROVIDERS.respondechat,
    request,
    response,
  ),
);

// ----------------------------------------
// webhookConverteChat — entrada do ConverteChat
// ----------------------------------------
// O ConverteChat manda o payload em outro formato ({data: {contact, message}}).
// Em vez de duplicar as ~700 linhas do miolo, traduzimos o payload para o
// formato que processarWebhookCanal já entende (o do Responde Chat) e chamamos
// o mesmo miolo. Só o "cano" muda; o cérebro da Patrícia é o mesmo.
//
// ATENÇÃO: o formato abaixo veio da integração antiga (commit 49f70a7) e ainda
// NÃO foi confirmado contra o ConverteChat de hoje. Por isso logamos o payload
// cru em DIAG_CONVERTECHAT_PAYLOAD: ao plugar o primeiro número, é só olhar esse
// log para ver o que realmente chega e ajustar o mapeamento em minutos.
exports.webhookConverteChat = onRequest(async (request, response) => {
  try {
    // Payload cru — a fonte da verdade para ajustar o mapeamento. rawBody pega
    // o corpo mesmo quando o content-type não é JSON (o parser deixaria body vazio).
    logger.info("DIAG_CONVERTECHAT_PAYLOAD", {
      body: JSON.stringify(request.body || {}).slice(0, 4000),
      rawBody: request.rawBody ? request.rawBody.toString("utf8").slice(0, 4000) : null,
      contentType: request.headers["content-type"] || null,
      method: request.method,
      query: request.query,
    });

    const data = (request.body && request.body.data) || {};
    const msg = data.message || {};
    const numero = data.contact?.number || data.contact?.phone || "";
    const texto = msg.body || "";
    const fromMe = msg.fromMe === true;
    const mediaUrl = msg.mediaUrl || msg.media?.url || null;
    const mediaType = msg.mediaType || msg.type || "chat";

    if (!numero) {
      logger.warn("webhookConverteChat — numero nao encontrado no payload");
      return response.status(200).json({ ignored: true, reason: "numero_nao_encontrado" });
    }

    // Traduz para o formato do Responde Chat que o miolo já sabe ler.
    // `raw.key` carrega o número e o fromMe; `message` carrega texto e mídia.
    const requestTraduzido = {
      method: request.method,
      query: request.query,
      body: {
        event: "messages.upsert",
        contact: { number: numero, name: data.contact?.name || "" },
        message: {
          body: texto,
          type: mediaType,
          mediaUrl,
          raw: {
            key: {
              remoteJid: `${numero}@s.whatsapp.net`,
              fromMe,
            },
            IsFromMe: fromMe,
          },
        },
      },
    };

    return processarWebhookCanal(PROVIDERS.convertechat, requestTraduzido, response);
  } catch (err) {
    logger.error("webhookConverteChat — excecao no adaptador", {
      error: String(err),
      stack: err.stack,
    });
    return response.status(200).json({ error: "excecao", detalhe: String(err) });
  }
});

// ----------------------------------------
// Follow-up de cobrança — o CRM manda, a Patrícia fala
// ----------------------------------------
// A agenda de cobrança mora no CRM (é lá que está data_vencimento e o estado do
// pedido); quem sabe conversar é o Mentor. Então o CRM varre e chama aqui.
//
// TIPOS:
//   "antes_vencimento" — boleto ainda NÃO emitido, vencimento chegando: pergunta
//     ao cliente se pode gerar. Quando ele confirma, a conversa segue o fluxo
//     normal e o [LEAD_PRONTO ... pagar=agora] emite o boleto — sem código novo.
//   "vencimento_hoje"  — qualquer forma de pagamento: lembra do pagamento.

/**
 * Envia mensagens ao cliente pela API do provedor do chip. Mesma cadência do
 * miolo do webhook (pausa maior depois de mensagem com link, falha individual
 * não derruba as demais).
 */
async function enviarPeloProvider({ provider, token, numero, mensagens, contexto = {} }) {
  let enviadas = 0;
  for (let i = 0; i < mensagens.length; i++) {
    if (i > 0) {
      const anteriorTemLink = /https?:\/\//i.test(mensagens[i - 1]);
      await new Promise((r) => setTimeout(r, anteriorTemLink ? 6000 : 3000));
    }
    try {
      const res = await fetch(provider.sendUrl, {
        method: "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ number: numero, body: mensagens[i] }),
      });
      const corpo = await res.text();
      if (res.status >= 400) {
        logger.warn("followUpCobranca — falha no envio", {
          ...contexto, indice: i, status: res.status, corpo: corpo.slice(0, 200),
        });
      } else {
        enviadas++;
      }
    } catch (e) {
      logger.warn("followUpCobranca — excecao no envio", {
        ...contexto, indice: i, error: String(e).slice(0, 200),
      });
    }
  }
  return enviadas;
}

/** Formata "2026-08-05" como "05/08" para a IA falar naturalmente. */
function diaMesBR(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// Uma cobrança não pode ser puxada duas vezes no mesmo dia, mesmo que o CRM
// repita a chamada (retry, rodada manual, flag que não gravou).
const FOLLOWUP_INTERVALO_MS = 12 * 60 * 60 * 1000;

exports.dispararFollowUpCobranca = onRequest(async (request, response) => {
  try {
    if (request.method !== "POST") {
      return response.status(200).json({ ignored: true, reason: "metodo_nao_permitido" });
    }

    const settingsSnap = await admin.firestore().doc("settings/app").get();
    const settingsData = settingsSnap.exists ? settingsSnap.data() : {};

    // Autenticação: o mesmo segredo que o Mentor usa para falar com o CRM serve
    // para o CRM falar com o Mentor — os dois lados já o conhecem, então não há
    // credencial nova para cadastrar em lugar nenhum.
    const esperado = settingsData.crmApiKey;
    const authHeader = request.headers.authorization || "";
    if (!esperado || authHeader !== `Bearer ${esperado}`) {
      logger.warn("followUpCobranca — nao autorizado", { temSegredo: !!esperado });
      return response.status(401).json({ error: "nao_autorizado" });
    }

    const corpo = request.body || {};
    const numero = String(corpo.numero || corpo.telefone || "").replace(/\D/g, "");
    const tipo = String(corpo.tipo || "").trim();
    const dataVencimento = typeof corpo.data_vencimento === "string" ? corpo.data_vencimento : null;
    const valor = Number(corpo.valor);
    const formaPagamento = String(corpo.forma_pagamento || "").trim();
    const pedido = corpo.numero_pedido || null;
    // Simulação: percorre tudo (acha a conversa, escreve a mensagem) e devolve o
    // que SERIA enviado, sem mandar nada ao cliente nem gravar no histórico.
    // É o que permite validar a agenda contra pedidos reais sem incomodar ninguém.
    const simular = corpo.dry_run === true || corpo.dry_run === "true";

    if (!numero) {
      return response.status(200).json({ error: "numero_ausente" });
    }
    if (tipo !== "antes_vencimento" && tipo !== "vencimento_hoje") {
      return response.status(200).json({ error: "tipo_invalido", tipo });
    }

    // Localiza a conversa pelo número. O CRM não guarda o agente, então achamos
    // a conversa mais recente desse cliente (na prática, uma só).
    //
    // ATENÇÃO AO DDI: o CRM guarda o telefone SEM o "55" e o Mentor COM
    // (conferido: CRM 19993780831 = Mentor 5519993780831). Buscar só a forma
    // recebida faria todo follow-up morrer em "conversa_nao_encontrada", em
    // silêncio. Por isso tentamos as duas grafias.
    // Tentamos TODAS as grafias, sem adivinhar qual "55" é país: o DDD 55
    // (Santa Maria/RS) faz o número da Janete virar 55+55+99628597, e supor que
    // o "55" inicial era o país removia o DDD dela — a conversa nunca era achada.
    const db = admin.firestore();
    const variantes = [numero, `55${numero}`];
    if (numero.startsWith("55")) variantes.push(numero.slice(2));

    let convDoc = null;
    if (corpo.agente) {
      for (const n of variantes) {
        const direto = await db.collection("conversations").doc(`${n}_${corpo.agente}`).get();
        if (direto.exists) { convDoc = direto; break; }
      }
    }
    if (!convDoc) {
      const achados = [];
      for (const n of variantes) {
        const busca = await db.collection("conversations").where("numero", "==", n).get();
        achados.push(...busca.docs);
      }
      achados.sort((a, b) => (b.data().ultimaMensagemTs || 0) - (a.data().ultimaMensagemTs || 0));
      convDoc = achados[0] || null;
    }

    if (!convDoc) {
      logger.warn("followUpCobranca — conversa nao encontrada", { numero, pedido });
      return response.status(200).json({ error: "conversa_nao_encontrada", numero });
    }

    const conv = convDoc.data();
    const convRef = convDoc.ref;

    // Vendedor assumiu (IA desligada) ou conversa reiniciada: não falamos por
    // cima de um humano que está conduzindo.
    if (conv.ativo !== true) {
      logger.info("followUpCobranca — pulado: IA desligada nesta conversa", { numero, pedido });
      return response.status(200).json({ ignored: true, reason: "ia_desligada", numero });
    }

    const ultimoFollowUp = typeof conv.followUpCobrancaTs === "number" ? conv.followUpCobrancaTs : 0;
    if (Date.now() - ultimoFollowUp < FOLLOWUP_INTERVALO_MS) {
      logger.info("followUpCobranca — pulado: follow-up recente nesta conversa", {
        numero, pedido, haMs: Date.now() - ultimoFollowUp,
      });
      return response.status(200).json({ ignored: true, reason: "follow_up_recente", numero });
    }

    const canal = conv.canal || null;
    const chipCfg = canal && settingsData.canais ? settingsData.canais[canal] : null;
    if (chipCfg && chipCfg.ativo === false) {
      logger.info("followUpCobranca — pulado: chip desativado", { numero, canal });
      return response.status(200).json({ ignored: true, reason: "chip_desativado", canal });
    }
    const provider = PROVIDERS[(chipCfg && chipCfg.ferramenta) || "respondechat"] || PROVIDERS.respondechat;
    const token = resolverTokenCanal(provider, settingsData, canal);
    if (!token) {
      logger.warn("followUpCobranca — sem token para o chip", { numero, canal });
      return response.status(200).json({ error: "sem_token", canal });
    }

    // Mensagem escrita pela própria Patrícia, com o histórico como contexto —
    // retomar uma conversa de dias atrás com texto genérico soaria robótico.
    const historico = Array.isArray(conv.messages) ? conv.messages : [];
    const transcricao = historico.slice(-20)
      .map((m) => `${m.role === "user" ? "Cliente" : "Você"}: ${m.text}`).join("\n");
    const quando = diaMesBR(dataVencimento);
    const valorTxt = Number.isFinite(valor) && valor > 0
      ? `R$ ${valor.toFixed(2).replace(".", ",")}` : null;

    const objetivo = tipo === "antes_vencimento"
      ? `Retome a conversa lembrando com naturalidade do combinado e PERGUNTE se pode gerar o boleto agora${quando ? ` para vencer no dia ${quando}` : ""}. Não escreva boleto, link nem código de barras — só pergunte se pode gerar.`
      : `A cobrança do cliente vence HOJE${valorTxt ? ` (${valorTxt})` : ""}. Escreva um lembrete cordial e leve do pagamento, se colocando à disposição para ajudar. Não cobre de forma dura nem ameace.`;

    const instrucao = `Você é a vendedora desta conversa de WhatsApp. Escreva a PRÓXIMA mensagem para o cliente.\n\n` +
      `OBJETIVO: ${objetivo}\n\n` +
      `REGRAS: seja breve (no máximo 2 frases curtas), calorosa e natural, no mesmo tom que você já usou na conversa. Trate o cliente pelo nome se ele aparecer no histórico. Não repita saudação de primeira conversa (vocês já se falaram). Responda APENAS com o texto da mensagem, sem aspas e sem comentários.\n\n` +
      `CONVERSA ATÉ AQUI:\n${transcricao}`;

    const geminiApiKey = settingsData.geminiApiKey;
    const modelos = resolverModelosGemini(settingsData);
    let texto = null;
    if (geminiApiKey) {
      try {
        const data = await chamarGemini(geminiApiKey, {
          contents: [{ parts: [{ text: instrucao }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } },
        }, modelos, { numero, etapa: "followUpCobranca" });
        texto = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim() || null;
      } catch (e) {
        logger.warn("followUpCobranca — Gemini falhou, usando texto de reserva", {
          numero, error: String(e).slice(0, 200),
        });
      }
    }
    // Reserva: melhor uma mensagem simples do que o cliente não ser avisado.
    if (!texto) {
      texto = tipo === "antes_vencimento"
        ? `Oi! Passando pra lembrar do seu pedido${quando ? ` com pagamento combinado pro dia ${quando}` : ""}. Posso gerar o seu boleto agora?`
        : `Oi! Passando pra lembrar que o seu pagamento${valorTxt ? ` de ${valorTxt}` : ""} vence hoje. Qualquer dúvida, é só me chamar!`;
    }

    // Envia pelo número GRAVADO NA CONVERSA, não pelo que veio do CRM: é ele que
    // está na grafia que o provedor aceita (país+DDD+número). Mandar a versão do
    // CRM, sem o 55, faria o envio falhar no provedor.
    const numeroEnvio = conv.numero || numero;

    if (simular) {
      logger.info("followUpCobranca — SIMULACAO (nada enviado)", {
        numero: numeroEnvio, tipo, pedido, canal, texto,
      });
      return response.status(200).json({
        simulacao: true, enviaria: true, numero: numeroEnvio, canal, tipo, texto,
      });
    }

    const enviadas = await enviarPeloProvider({
      provider, token, numero: numeroEnvio, mensagens: [texto],
      contexto: { numero: numeroEnvio, tipo, pedido },
    });

    if (enviadas > 0) {
      // Grava no histórico: sem isso a mensagem some da bancada e a IA não sabe
      // que ela mesma acabou de cobrar (responderia como se nada tivesse havido).
      historico.push({ role: "model", text: texto, ts: Date.now() });
      await convRef.set({
        messages: historico,
        followUpCobrancaTs: Date.now(),
        followUpCobrancaTipo: tipo,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    logger.info("followUpCobranca — concluido", { numero, tipo, pedido, canal, enviadas, texto });
    return response.status(200).json({ ok: enviadas > 0, numero, tipo, enviadas });
  } catch (err) {
    logger.error("followUpCobranca — excecao", { error: String(err), stack: err.stack });
    return response.status(200).json({ error: "excecao", detalhe: String(err) });
  }
});

// ----------------------------------------
// ativarAgente — ativa a IA do agente para um cliente específico
// ----------------------------------------
exports.ativarAgente = onRequest(async (request, response) => {
  try {
    // 1. Aceitar apenas POST
    if (request.method !== 'POST') {
      logger.info("ativarAgente — metodo nao permitido", { method: request.method });
      return response.status(200).json({ ignored: true, reason: "metodo_nao_permitido" });
    }

    // 2. Obter slug do agente
    const agenteSlug = request.query.agente || null;
    if (!agenteSlug) {
      logger.warn("ativarAgente — sem slug na URL");
      return response.status(200).json({ error: "semSlug" });
    }

    // 3. Obter e normalizar número: corpo OU query (?numero=). A query existe
    // porque o construtor de fluxo do ConverteChat rejeita headers/corpo JSON
    // no nó de Integração; com &numero={numero} na URL não precisa de nenhum.
    const numeroRaw = request.body?.numero || request.query.numero;
    if (!numeroRaw) {
      logger.warn("ativarAgente — sem numero no corpo nem na query", { body: JSON.stringify(request.body) });
      return response.status(200).json({ error: "semNumero" });
    }

    const numeroNormalizado = String(numeroRaw).replace(/\D/g, '');
    if (!numeroNormalizado) {
      logger.warn("ativarAgente — numero normalizado vazio", { body: JSON.stringify(request.body) });
      return response.status(200).json({ error: "semNumero" });
    }

    // 4. Salvar status no Firestore
    const convDocId = numeroNormalizado + "_" + agenteSlug;
    const convRef = admin.firestore().collection("conversations").doc(convDocId);

    // Verificar se a conversa já existe e se tem mensagens
    const convSnap = await convRef.get();
    const jaTemMensagens = convSnap.exists && Array.isArray(convSnap.data()?.messages) && convSnap.data().messages.length > 0;

    // Verificar se já possui o campo criadoEm
    const jaTemCriadoEm = convSnap.exists && convSnap.data()?.criadoEm !== undefined;

    const payload = {
      ativo: true,
      numero: numeroNormalizado,
      agenteSlug,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (!jaTemMensagens) {
      payload.status = "pendente";
    }

    // Gravar criadoEm apenas se não existir ainda (imutável)
    if (!jaTemCriadoEm) {
      payload.criadoEm = Date.now();
    }

    await convRef.set(payload, { merge: true });

    logger.info("ativarAgente — sucesso", { numero: numeroNormalizado, agenteSlug });

    // 5. Herdar o que o cliente escreveu enquanto o funil rodava. Este é o
    // último nó do fluxo, então uma eventual espera pelo replay não atrasa
    // nada para o cliente.
    await consumirBuffer(numeroNormalizado, agenteSlug, convRef);

    return response.status(200).json({
      ok: true,
      ativado: numeroNormalizado,
      agente: agenteSlug
    });

  } catch (err) {
    logger.error("ativarAgente — excecao", {
      error: String(err),
      stack: err.stack,
    });
    return response.status(200).json({
      error: "excecao",
      detalhe: String(err),
    });
  }
});

// ----------------------------------------
// Equipe — criar/remover vendedor (acesso restrito a chips na bancada)
// ----------------------------------------
// O dono cria a conta do vendedor SEM sair da própria sessão (só o Admin SDK
// consegue criar um usuário do Auth sem logar como ele). A conta já nasce como
// role "seller", que na bancada só enxerga as conversas dos chips liberados e
// nunca vê Configurações (tokens). Chamadas onCall: exigem o dono autenticado.

/** Garante que quem chamou está logado e é o proprietário. Retorna o uid. */
async function exigirDono(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Faça login para continuar.");
  }
  const snap = await admin.firestore().collection("users").doc(uid).get();
  if (!snap.exists || snap.data().role !== "owner") {
    throw new HttpsError("permission-denied", "Apenas o proprietário pode gerenciar a equipe.");
  }
  return uid;
}

exports.criarVendedor = onCall(async (request) => {
  const donoUid = await exigirDono(request);

  const email = String(request.data.email || "").trim().toLowerCase();
  const senha = String(request.data.senha || "");
  const nome = String(request.data.nome || "").trim();
  const canaisPermitidos = Array.isArray(request.data.canaisPermitidos)
    ? request.data.canaisPermitidos.filter((c) => typeof c === "string")
    : [];

  if (!email || !senha || !nome) {
    throw new HttpsError("invalid-argument", "Informe nome, email e senha.");
  }
  if (senha.length < 6) {
    throw new HttpsError("invalid-argument", "A senha precisa ter ao menos 6 caracteres.");
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({ email, password: senha, displayName: nome });
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Este email já está cadastrado.");
    }
    if (err.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Email inválido.");
    }
    logger.error("criarVendedor — falha ao criar conta no Auth", { error: String(err) });
    throw new HttpsError("internal", "Não foi possível criar a conta.");
  }

  await admin.firestore().collection("users").doc(userRecord.uid).set({
    email,
    name: nome,
    role: "seller",
    canaisPermitidos,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info("criarVendedor — vendedor criado", { uid: userRecord.uid, email, por: donoUid });
  return { ok: true, uid: userRecord.uid };
});

exports.removerVendedor = onCall(async (request) => {
  const donoUid = await exigirDono(request);

  const uid = String(request.data.uid || "");
  if (!uid) {
    throw new HttpsError("invalid-argument", "uid ausente.");
  }
  if (uid === donoUid) {
    throw new HttpsError("failed-precondition", "Você não pode remover a si mesmo.");
  }

  // Nunca apaga outro proprietário por engano.
  const alvo = await admin.firestore().collection("users").doc(uid).get();
  if (alvo.exists && alvo.data().role === "owner") {
    throw new HttpsError("failed-precondition", "Não é possível remover um proprietário.");
  }

  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    // Se a conta do Auth já não existir, segue e limpa o documento mesmo assim.
    logger.warn("removerVendedor — deleteUser falhou, limpando doc", { uid, error: String(err) });
  }
  await admin.firestore().collection("users").doc(uid).delete();

  logger.info("removerVendedor — vendedor removido", { uid, por: donoUid });
  return { ok: true };
});

// removerConta — apaga QUALQUER conta (menos a própria), inclusive donos/teste.
// Usada na limpeza da aba Equipe ("Outras contas"). Mais abrangente que
// removerVendedor (que protege donos de propósito no fluxo de vendedores).
exports.removerConta = onCall(async (request) => {
  const donoUid = await exigirDono(request);

  const uid = String(request.data.uid || "");
  if (!uid) {
    throw new HttpsError("invalid-argument", "uid ausente.");
  }
  if (uid === donoUid) {
    throw new HttpsError("failed-precondition", "Você não pode remover a si mesmo.");
  }

  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    // Doc órfão (sem conta no Auth) ou já removido: limpa o documento mesmo assim.
    logger.warn("removerConta — deleteUser falhou, limpando doc", { uid, error: String(err) });
  }
  await admin.firestore().collection("users").doc(uid).delete();

  logger.info("removerConta — conta removida", { uid, por: donoUid });
  return { ok: true };
});

// definirSenhaVendedor — o dono define uma nova senha para um vendedor.
// Robusto contra a bagunça de contas: se o doc do vendedor ficou órfão (a conta
// do Auth foi apagada, ou está sob outro uid), a função reconecta/recria a conta
// pelo email e migra o documento para o uid certo, para o login voltar a funcionar.
exports.definirSenhaVendedor = onCall(async (request) => {
  await exigirDono(request);

  const uid = String(request.data.uid || "");
  const novaSenha = String(request.data.senha || "");
  if (!uid) {
    throw new HttpsError("invalid-argument", "uid ausente.");
  }
  if (novaSenha.length < 6) {
    throw new HttpsError("invalid-argument", "A senha precisa ter ao menos 6 caracteres.");
  }

  const usersCol = admin.firestore().collection("users");
  const docRef = usersCol.doc(uid);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new HttpsError("not-found", "Vendedor não encontrado.");
  }
  const dados = docSnap.data();
  const email = String(dados.email || "").trim().toLowerCase();
  if (!email) {
    throw new HttpsError("failed-precondition", "Vendedor sem email cadastrado.");
  }

  // 1. Já existe conta de Auth para ESTE uid: só troca a senha.
  let authDoUid = null;
  try {
    authDoUid = await admin.auth().getUser(uid);
  } catch (_) { /* sem conta para este uid */ }
  if (authDoUid) {
    await admin.auth().updateUser(uid, { password: novaSenha });
    logger.info("definirSenhaVendedor — senha trocada", { uid, email });
    return { ok: true, uid };
  }

  // 2. Doc órfão, mas existe uma conta de Auth com este email (sob outro uid):
  //    sincroniza a senha e migra o documento do vendedor para o uid do Auth.
  let authPorEmail = null;
  try {
    authPorEmail = await admin.auth().getUserByEmail(email);
  } catch (_) { /* nenhuma conta com este email */ }
  if (authPorEmail) {
    await admin.auth().updateUser(authPorEmail.uid, { password: novaSenha });
    if (authPorEmail.uid !== uid) {
      await usersCol.doc(authPorEmail.uid).set({
        ...dados,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await docRef.delete();
    }
    logger.info("definirSenhaVendedor — reconectado ao Auth existente", { deUid: uid, paraUid: authPorEmail.uid, email });
    return { ok: true, uid: authPorEmail.uid };
  }

  // 3. Não existe conta de Auth alguma: cria uma nova com o email e migra o doc.
  const novo = await admin.auth().createUser({ email, password: novaSenha, displayName: dados.name });
  await usersCol.doc(novo.uid).set({
    ...dados,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  if (novo.uid !== uid) {
    await docRef.delete();
  }
  logger.info("definirSenhaVendedor — conta recriada", { deUid: uid, paraUid: novo.uid, email });
  return { ok: true, uid: novo.uid };
});

// rodarFaxinaConversas — exclui os leads mortos SOB DEMANDA (só o dono), SEM
// disparar remarketing. Mesma lógica do job diário: limpa o backlog na hora e
// devolve a contagem, sem esperar as 00:00.
exports.rodarFaxinaConversas = onCall(async (request) => {
  await exigirDono(request);
  const resumo = await processarExclusaoLeadsMortos();
  return { ok: true, ...resumo };
});

// ----------------------------------------
// verificarRemarketingAgendado — Cloud Function agendada para processar o remarketing
// ----------------------------------------
exports.verificarRemarketingAgendado = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "America/Sao_Paulo",
    region: "us-central1",
  },
  async (event) => {
    try {
      const result = await processarRemarketing();
      logger.info("verificarRemarketingAgendado — concluido", result);
    } catch (err) {
      logger.error("verificarRemarketingAgendado — excecao", {
        error: String(err),
        stack: err.stack,
      });
    }

    // A exclusão dos leads mortos NÃO roda mais aqui — foi para um job próprio,
    // diário às 00:00 (excluirLeadsMortosDiario). O remarketing só arquiva; a
    // conversa fica em Arquivados esperando o cliente reagir por 24h.

    // Buffers de leads que nunca terminaram o funil nunca são consumidos.
    try {
      await limparBuffersAntigos();
    } catch (err) {
      logger.error("verificarRemarketingAgendado — falha ao limpar buffers", {
        error: String(err),
      });
    }
  }
);

// ----------------------------------------
// excluirLeadsMortosDiario — todo dia às 00:00 (America/Sao_Paulo) exclui os
// leads que receberam remarketing há mais de 24h e não responderam. Mantém a
// bancada limpa sem depender de exclusão manual.
// ----------------------------------------
exports.excluirLeadsMortosDiario = onSchedule(
  {
    schedule: "0 0 * * *",
    timeZone: "America/Sao_Paulo",
    region: "us-central1",
  },
  async (event) => {
    try {
      const resumo = await processarExclusaoLeadsMortos();
      logger.info("excluirLeadsMortosDiario — concluido", resumo);
    } catch (err) {
      logger.error("excluirLeadsMortosDiario — excecao", {
        error: String(err),
        stack: err.stack,
      });
    }
  }
);

// ----------------------------------------
// vigiaSaudeChips — vigia de entrega por chip
// ----------------------------------------
// Roda de 15 em 15 min. Como o Responde Chat confirma o envio (200) mesmo com o
// chip offline ou com o WhatsApp segurando a saída, a mensagem se perde sem erro
// no log. Este vigia detecta a queda pelo comportamento: se, na janela recente,
// a IA respondeu vários leads de um chip e NENHUM deles escreveu de volta DEPOIS
// da resposta, as respostas provavelmente não estão chegando. O diagnóstico vai
// para settings/chipSaude e a bancada (Conversas) exibe o alerta.
exports.vigiaSaudeChips = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "America/Sao_Paulo",
    region: "us-central1",
  },
  async () => {
    try {
      const resultado = await analisarSaudeChips();
      logger.info("vigiaSaudeChips — concluido", resultado);
    } catch (err) {
      logger.error("vigiaSaudeChips — excecao", {
        error: String(err),
        stack: err.stack,
      });
    }
  }
);

/**
 * Varre as conversas ativas na janela e diagnostica, por chip, se as respostas
 * da IA parecem não estar sendo entregues. Grava settings/chipSaude.
 * @return {Promise<Object>} Resumo por canal.
 */
async function analisarSaudeChips() {
  const db = admin.firestore();
  const agora = Date.now();
  const inicioJanela = agora - VIGIA_JANELA_MIN * 60 * 1000;
  const CANAL_PADRAO = "__padrao__";

  const settingsSnap = await db.doc("settings/app").get();
  const settingsData = settingsSnap.exists ? settingsSnap.data() : {};

  // slug do chip -> nome amigável (ex.: "claro2" -> "Claro 2"). O canal padrão
  // (conversas sem campo canal) entra como "__padrao__". Guardamos também a
  // config completa do chip (ativo, ferramenta) para decidir se vale vigiar e
  // para dizer no alerta a ferramenta certa (Responde Chat x ConverteChat).
  const nomePorSlug = { [CANAL_PADRAO]: "Padrão" };
  const cfgPorSlug = {};
  for (const c of Object.values(settingsData.canais || {})) {
    if (c && c.slug) {
      nomePorSlug[c.slug] = c.nome || c.slug;
      cfgPorSlug[c.slug] = c;
    }
  }

  // Só as conversas mexidas na janela importam — evita varrer a base inteira.
  const conversationsSnap = await db
    .collection("conversations")
    .where("updatedAt", ">=", admin.firestore.Timestamp.fromMillis(inicioJanela))
    .get();

  // Por canal: quantos leads a IA respondeu na janela e, desses, quantos
  // escreveram de volta DEPOIS da última resposta da IA (prova de entrega).
  const stats = {};
  for (const doc of conversationsSnap.docs) {
    const data = doc.data();
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    if (msgs.length === 0) continue;

    // O remarketing vai para leads inativos que, por definição, tendem a não
    // responder — contá-lo como "envio da IA" inflaria o "sem resposta" e faria
    // o chip parecer fora do ar sem estar. A nota de remarketing é ignorada: só
    // resposta de conversa real conta como prova (ou não) de entrega.
    let ultimoModelTs = 0;
    for (const m of msgs) {
      if (m && m.role === "model" && !ehNotaRemarketing(m) &&
          typeof m.ts === "number" &&
          m.ts >= inicioJanela && m.ts > ultimoModelTs) {
        ultimoModelTs = m.ts;
      }
    }
    if (!ultimoModelTs) continue; // IA não respondeu na janela: não avalia

    const slug = data.canal || CANAL_PADRAO;
    if (!stats[slug]) stats[slug] = { enviados: 0, comResposta: 0 };
    stats[slug].enviados++;

    const respondeuDepois = msgs.some(
      (m) => m && m.role === "user" && typeof m.ts === "number" && m.ts > ultimoModelTs,
    );
    if (respondeuDepois) stats[slug].comResposta++;
  }

  // Preserva o "desde" enquanto o chip continuar suspeito (banner com hora estável).
  const prevSnap = await db.doc("settings/chipSaude").get();
  const prev = (prevSnap.exists && prevSnap.data().canais) || {};

  const canais = {};
  for (const [slug, s] of Object.entries(stats)) {
    const cfg = cfgPorSlug[slug];
    // Chip desligado na mão (Configurações) não é vigiado: não enviamos por ele,
    // então "não está entregando" não faz sentido. Fica de fora do doc de vez.
    if (cfg && cfg.ativo === false) continue;
    const suspeito = s.enviados >= VIGIA_MIN_ENVIOS && s.comResposta === 0;
    const antes = prev[slug] || {};
    canais[slug] = {
      nome: nomePorSlug[slug] || slug,
      ferramenta: cfg && cfg.ferramenta === "convertechat"
        ? "convertechat"
        : "respondechat",
      status: suspeito ? "suspeito" : "ok",
      enviados: s.enviados,
      comResposta: s.comResposta,
      desde: suspeito
        ? (antes.status === "suspeito" && antes.desde ? antes.desde : agora)
        : null,
    };
  }

  // set (sem merge): chips sem atividade na janela somem do doc — o banner limpa
  // sozinho, já que sem envios recentes não dá para julgar a entrega.
  await db.doc("settings/chipSaude").set({
    atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    janelaMin: VIGIA_JANELA_MIN,
    minEnvios: VIGIA_MIN_ENVIOS,
    canais,
  });

  const suspeitos = Object.entries(canais)
    .filter(([, v]) => v.status === "suspeito")
    .map(([slug]) => slug);
  return {
    conversasNaJanela: conversationsSnap.size,
    canaisAvaliados: Object.keys(stats).length,
    suspeitos,
  };
}

/**
 * Processa o remarketing varrendo as conversas no Firestore.
 * @return {Promise<Object>} Resumo do processamento.
 */
async function processarRemarketing() {
  logger.info("processarRemarketing — iniciando varredura");

  const settingsSnap = await admin.firestore().doc("settings/app").get();
  const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
  const webhookConfig = settingsData.webhooks?.remarketing || {};
  const modoTeste = webhookConfig.modoTeste === true;
  const numeroTeste = webhookConfig.numeroTeste || "";

  // O webhook agora é resolvido POR CONVERSA (cada chip tem o seu), dentro do
  // loop, olhando data.canal. Por isso não abortamos mais só porque o global
  // está vazio: um chip pode ter o dele. Só abortamos se não há NENHUM webhook
  // de remarketing configurado — nem o global (canal padrão), nem em canal algum.
  const globalRemarketingAtivo = !!webhookConfig.url && webhookConfig.ativo !== false;
  const algumCanalRemarketing = Object.values(settingsData.canais || {}).some(
    (c) => c && c.webhooks && c.webhooks.remarketing &&
      c.webhooks.remarketing.url && c.webhooks.remarketing.ativo !== false,
  );
  if (!globalRemarketingAtivo && !algumCanalRemarketing) {
    logger.info("processarRemarketing — nenhum webhook de remarketing configurado (global ou por canal)");
    return {
      status: "webhook_inativo_ou_sem_url",
      ativo: false,
      hasUrl: false,
    };
  }

  if (modoTeste && !numeroTeste) {
    logger.warn("processarRemarketing — modo teste ativo, mas numeroTeste vazio. Abortando.");
    return {
      status: "modo_teste_sem_numero",
      modoTeste,
      numeroTeste,
    };
  }

  const conversationsSnap = await admin
    .firestore()
    .collection("conversations")
    .get();

  logger.info("processarRemarketing — total de conversas", {
    total: conversationsSnap.size,
  });

  const thresholdMs = REMARKETING_THRESHOLD_HORAS * 60 * 60 * 1000;
  const agora = Date.now();
  let analisadas = 0;
  let processadas = 0;
  let falhas = 0;

  for (const doc of conversationsSnap.docs) {
    const data = doc.data();
    analisadas++;

    if (data.leadPronto === true || data.remarketingEnviado === true || data.remarketingAtivo === false) {
      continue;
    }

    let ancora = null;

    if (Array.isArray(data.messages) && data.messages.length > 0) {
      for (let i = data.messages.length - 1; i >= 0; i--) {
        if (data.messages[i].role === "user" &&
            typeof data.messages[i].ts === "number") {
          ancora = data.messages[i].ts;
          break;
        }
      }
    }

    if (ancora === null && typeof data.criadoEm === "number") {
      ancora = data.criadoEm;
    }

    if (ancora === null) {
      continue;
    }

    if ((agora - ancora) < thresholdMs) {
      continue;
    }

    let numero = data.numero || "";
    if (!numero) {
      const partes = doc.id.split("_");
      numero = partes[0].replace(/\D/g, "");
    }

    if (!numero) {
      logger.warn("processarRemarketing — numero nao identificado", {
        docId: doc.id,
      });
      continue;
    }

    if (modoTeste && numero !== numeroTeste) {
      continue;
    }

    // Cada conversa dispara pelo webhook do SEU chip (data.canal), com o global
    // como padrão. Assim o remarketing move/mexe o lead na caixa certa.
    const wh = resolverWebhook(settingsData, data.canal || null, "remarketing", "");
    if (!wh.ativo || !wh.url) {
      logger.info("processarRemarketing — sem webhook de remarketing para este canal, pulando", {
        numero,
        canal: data.canal || "padrao",
      });
      continue;
    }

    try {
      logger.info("processarRemarketing — disparando webhook", {
        numero,
        docId: doc.id,
        canal: wh.origem,
      });

      const responseHook = await fetch(wh.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_phone: numero,
          ...(data.nomeCliente ? { client_name: data.nomeCliente } : {}),
        }).toString(),
      });

      const corpoResposta = await responseHook.text();

      if (responseHook.status >= 200 && responseHook.status < 300) {
        logger.info("processarRemarketing — sucesso no webhook", {
          numero,
          status: responseHook.status,
          corpo: corpoResposta,
        });

        // Registra no histórico que enviamos remarketing, para a IA ter
        // contexto quando o cliente responder (ex.: "Sim") e não responder no
        // escuro. É uma nota interna do sistema (não é enviada ao cliente).
        const msgsRemarket = Array.isArray(data.messages) ? [...data.messages] : [];
        msgsRemarket.push({
          role: "model",
          text: NOTA_REMARKETING,
          ts: Date.now(),
        });

        // ARQUIVA na hora: o remarketing tira o lead da aba Ativas e o joga em
        // Arquivados, deixando a bancada limpa (só leads novos/ativos e prontos).
        // A partir daí, dois caminhos:
        //   • cliente RESPONDE → o webhook desarquiva e o lead volta pra Ativas
        //     (ciclo reiniciado, remarketingEnviado zerado);
        //   • cliente NÃO responde em 24h → excluído no job diário 00:00
        //     (processarExclusaoLeadsMortos).
        await doc.ref.set({
          messages: msgsRemarket,
          remarketingEnviado: true,
          remarketingTs: Date.now(),
          arquivada: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        processadas++;
      } else {
        logger.warn("processarRemarketing — falha no webhook", {
          numero,
          status: responseHook.status,
          corpo: corpoResposta,
        });
        falhas++;
      }
    } catch (err) {
      logger.error("processarRemarketing — erro webhook", {
        numero,
        error: String(err),
      });
      falhas++;
    }
  }

  logger.info("processarRemarketing — concluido", {
    analisadas,
    processadas,
    falhas,
  });

  return {
    status: "concluido",
    analisadas,
    processadas,
    falhas,
  };
}

/**
 * Exclusão dos leads mortos: quem recebeu remarketing e não voltou.
 *
 * O ciclo da bancada é: lead novo fica em Ativas → remarketing dispara e ARQUIVA
 * → daí em 24h ou o cliente responde (webhook desarquiva e volta pra Ativas) ou
 * é considerado morto. Esta função roda todo dia às 00:00 e EXCLUI de vez os
 * mortos, mantendo a bancada limpa sem exigir exclusão manual.
 *
 * Exclui a conversa quando TODAS forem verdade:
 *   • recebeu remarketing (remarketingEnviado === true);
 *   • já passou EXCLUSAO_LEAD_MORTO_HORAS desde o disparo (remarketingTs);
 *   • o cliente NÃO respondeu depois do remarketing (nenhuma msg 'user' com
 *     ts > remarketingTs). Isso INDEPENDE de a IA ter respondido ou não.
 *
 * Nunca toca em: venda fechada (leadPronto) nem em quem o vendedor tirou do
 * automático (remarketingAtivo === false). Quem nunca recebeu remarketing também
 * não é excluído aqui — o remarketing é o único gatilho de morte.
 *
 * @return {Promise<Object>} Resumo (excluidas, mantidas, total).
 */
async function processarExclusaoLeadsMortos() {
  const janelaMs = EXCLUSAO_LEAD_MORTO_HORAS * 60 * 60 * 1000;
  const agora = Date.now();

  const snap = await admin.firestore().collection("conversations").get();

  let excluidas = 0;
  let mantidas = 0;
  let batch = admin.firestore().batch();
  let ops = 0;
  const commitSeCheio = async (force) => {
    if (ops >= 450 || (force && ops > 0)) {
      await batch.commit();
      batch = admin.firestore().batch();
      ops = 0;
    }
  };

  for (const doc of snap.docs) {
    const data = doc.data();

    // Protegidos: venda fechada e opt-out explícito do vendedor.
    if (data.leadPronto === true || data.remarketingAtivo === false) {
      mantidas++;
      continue;
    }
    // Só morre quem recebeu remarketing. Sem remarketing, não é gatilho de morte.
    if (data.remarketingEnviado !== true) {
      mantidas++;
      continue;
    }
    // Sem timestamp de remarketing confiável não dá para provar que os 24h
    // passaram — não arrisca exclusão irreversível: mantém.
    const remarketingTs = typeof data.remarketingTs === "number" ? data.remarketingTs : 0;
    if (!remarketingTs) {
      mantidas++;
      continue;
    }
    // Ainda dentro da janela de 24h: dá tempo do cliente reagir.
    if ((agora - remarketingTs) < janelaMs) {
      mantidas++;
      continue;
    }
    // Rede de segurança: se o cliente respondeu depois do remarketing, não é
    // morto (normalmente o webhook já teria desarquivado e zerado o flag; isto
    // cobre o caso de a IA estar desligada na hora da resposta).
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    const respondeuDepois = remarketingTs > 0 && msgs.some(
      (m) => m && m.role === "user" && typeof m.ts === "number" && m.ts > remarketingTs,
    );
    if (respondeuDepois) {
      mantidas++;
      continue;
    }

    // Morto: recebeu remarketing, passou 24h e não respondeu. Exclui (com IA
    // tendo respondido ou não).
    batch.delete(doc.ref);
    ops++;
    await commitSeCheio(false);
    excluidas++;
  }

  await commitSeCheio(true);

  const resumo = { total: snap.size, excluidas, mantidas };
  logger.info("processarExclusaoLeadsMortos — concluido", resumo);
  return resumo;
}
