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
// Quanto tempo a conversa fica em Ativas DEPOIS do remarketing, esperando o
// cliente reagir. Passado esse prazo sem resposta, ela sai da bancada:
// arquivada se o cliente já tinha conversado, excluída se nunca escreveu nada.
const POS_REMARKETING_ARQUIVAR_HORAS = 24;
// Faxina por TEMPO PARADO (independente de remarketing): passada essa idade sem
// nenhuma atividade, a conversa sai da bancada — arquivada se a IA respondeu,
// excluída se a IA nunca respondeu.
const FAXINA_DIAS_PARADO = 2;

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
 * Cria cliente + cobrança boleto no Asaas e devolve link e linha digitável.
 * Lança erro em qualquer falha — o chamador decide o fallback (marcar falhaIA).
 */
async function gerarBoletoAsaas({ apiKey, apiUrl, valor, vencimentoDias, numero, agenteSlug, nome }) {
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
      dueDate: vencimentoISO(vencimentoDias),
      externalReference: `${numero}_${agenteSlug}`,
      description: "Perfume Atracao Arabe / Lattifah",
    }),
  });
  const payData = await payRes.json().catch(() => ({}));
  if (!payRes.ok || !payData.id) {
    throw new Error(`Asaas /payments ${payRes.status}: ${JSON.stringify(payData).slice(0, 300)}`);
  }

  // 3. Linha digitável (GET sem body — corpo vazio evita 403). Best-effort:
  //    se falhar, ainda mandamos o link do boleto, que sempre abre.
  let linhaDigitavel = null;
  try {
    const idRes = await fetch(`${base}/payments/${payData.id}/identificationField`, {
      method: "GET",
      headers: { "access_token": apiKey },
    });
    if (idRes.ok) {
      const idData = await idRes.json().catch(() => ({}));
      linhaDigitavel = idData.identificationField || null;
    }
  } catch (e) {
    logger.warn("Asaas — linha digitável indisponível, seguindo só com o link", {
      numero, agenteSlug, error: String(e).slice(0, 200),
    });
  }

  return {
    paymentId: payData.id,
    bankSlipUrl: payData.bankSlipUrl || payData.invoiceUrl || null,
    linhaDigitavel,
  };
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
// (cópia fiel de src/services/aiService.ts, sem tipos TS)
// ----------------------------------------
function buildAgentSystemPrompt(config, cases) {
  const sections = [config.base.trim()];

  if (config.tone && config.tone.trim()) {
    sections.push(
      `\nTOM DE VOZ: responda sempre com o seguinte tom: ${config.tone.trim()}`
    );
  }

  if (config.handoffRule && config.handoffRule.trim()) {
    sections.push(
      `\nCONDIÇÃO DE LEAD PRONTO (OBRIGATÓRIO):
Quando a seguinte situação ocorrer — ${config.handoffRule.trim()} — você DEVE obrigatoriamente adicionar o marcador [LEAD_PRONTO] ao final absoluto da sua resposta.

O marcador carrega a forma de pagamento e, quando a forma for boleto, o valor total e o nome do cliente:
[LEAD_PRONTO forma=<pix|boleto|cartao> valor=<valor total em reais> nome=<nome completo do cliente>]
- "forma" é a forma que o cliente escolheu, sem acento: pix, boleto ou cartao.
- "valor" é o valor TOTAL da compra conforme a tabela de preços, com ponto decimal (ex.: 149.90). OBRIGATÓRIO quando forma=boleto; nas demais formas pode ser omitido.
- "nome" é o nome completo que o cliente informou, para emitir o boleto no nome dele. OBRIGATÓRIO quando forma=boleto e deve ser SEMPRE o ÚLTIMO atributo do marcador (pode conter espaços). Nas demais formas, omita.
- Exemplo boleto: [LEAD_PRONTO forma=boleto valor=249.90 nome=João da Silva]
- Exemplo pix: [LEAD_PRONTO forma=pix]

Regras rigorosas para a emissão do marcador:
1. O marcador deve ser escrito exatamente nesse formato (LEAD_PRONTO em maiúsculas, entre colchetes) em uma LINHA TOTALMENTE ISOLADA no final absoluto de toda a sua resposta.
2. O marcador deve ficar sempre DEPOIS da última linha de conteúdo e DEPOIS de qualquer separador de mensagens "---" (caso esteja no formato split). O marcador NÃO é uma mensagem para o cliente e NÃO deve ser tratado como uma das partes do split. Não insira outro separador "---" após o marcador.
3. Este marcador é de uso estritamente interno do sistema e invisível para o cliente. NUNCA mencione, explique ou faça referência ao marcador na conversa, e NUNCA escreva o valor ou a forma como se fossem texto para o cliente.
4. Você deve CONTINUAR conversando e atendendo o cliente normalmente, respondendo suas dúvidas e conduzindo o fechamento como se você fosse o vendedor. NÃO pare de responder e NÃO encerre o fluxo.
5. Quando forma=boleto, NÃO escreva você mesma nenhum link, código de barras ou linha digitável — o sistema anexa o boleto automaticamente logo após a sua mensagem de transição. Apenas conduza normalmente ("já te envio por aqui").

Exemplo de formato de resposta quando a condição de lead pronto ocorre (boleto):
Perfeito! Vou gerar o seu boleto aqui com o vencimento certinho.
---
Só um minutinho que já te envio por aqui mesmo.
[LEAD_PRONTO forma=boleto valor=149.90]`
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

    const textoParaHistorico = (!texto)
      ? "[áudio recebido]"
      : texto;

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
      let respostaLimpa = respostaCrua;
      // Aceita [LEAD_PRONTO] ou [LEAD_PRONTO forma=boleto valor=149.90 nome=João Silva]
      // (forma/valor em qualquer ordem; nome, se houver, é sempre o último — pode ter espaços).
      const regexDetect = /^[ \t]*\[LEAD_PRONTO([^\]]*)\][ \t]*$/mi;
      const matchLead = respostaLimpa.match(regexDetect);
      if (matchLead) {
        leadPronto = true;
        const attrs = matchLead[1] || "";
        const fm = attrs.match(/forma\s*=\s*([a-zà-ú]+)/i);
        const vm = attrs.match(/valor\s*=\s*([\d.,]+)/i);
        const nm = attrs.match(/nome\s*=\s*(.+?)\s*$/i);
        formaPagamento = fm ? fm[1].toLowerCase() : null;
        valorBoleto = vm ? parseValorBRL(vm[1]) : null;
        // remove sobra caso o modelo ponha forma/valor DEPOIS do nome; limita tamanho
        nomeBoleto = nm ? nm[1].replace(/\s+(?:forma|valor)\s*=.*$/i, "").trim().slice(0, 80) : null;
        logger.info("lead pronto detectado", { numero, agenteSlug, formaPagamento, valorBoleto, nomeBoleto });

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
      // Um boleto por conversa (dedup), valor validado, tudo configurável em settings/app.
      if (leadPronto && formaPagamento === "boleto") {
        const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
        const asaasApiKey = settingsData.asaasApiKey;
        const asaasCfg = settingsData.asaas || {};
        const asaasAtivo = asaasCfg.ativo !== false;

        const convBoletoSnap = await convRef.get();
        const jaGerou = convBoletoSnap.exists && convBoletoSnap.data().boletoAsaasGerado === true;

        if (!asaasApiKey || !asaasAtivo) {
          logger.info("boleto Asaas pulado: sem chave ou desativado", {
            numero, temChave: !!asaasApiKey, ativo: asaasAtivo,
          });
        } else if (jaGerou) {
          logger.info("boleto Asaas pulado: já gerado nesta conversa (dedup)", { numero });
        } else if (!valorBoleto || valorBoleto < ASAAS_VALOR_MIN || valorBoleto > ASAAS_VALOR_MAX) {
          await marcarFalhaIA(convRef,
            `boleto sem valor válido no marcador (valor=${valorBoleto})`,
            { numero, agenteSlug, canal, nomeCliente }, settingsData);
        } else {
          try {
            const boleto = await gerarBoletoAsaas({
              apiKey: asaasApiKey,
              apiUrl: asaasCfg.apiUrl,
              valor: valorBoleto,
              vencimentoDias: asaasCfg.vencimentoDias,
              nome: nomeBoleto,
              numero, agenteSlug,
            });

            // Monta as mensagens do boleto. A linha digitável vai SOZINHA numa
            // mensagem só dela, para o cliente copiar/colar limpo (mesma lógica da chave PIX).
            const msgsBoleto = [];
            if (boleto.bankSlipUrl) {
              msgsBoleto.push(
                `Aqui está o seu boleto, é só acessar pelo link e pagar no app do seu banco ou imprimir:\n${boleto.bankSlipUrl}`
              );
            }
            if (boleto.linhaDigitavel) {
              msgsBoleto.push("E se preferir copiar e colar, essa é a linha digitável:");
              msgsBoleto.push(boleto.linhaDigitavel);
            }

            // Envia ao cliente E grava no histórico: sem isso o boleto não aparece
            // na bancada e a IA não sabe que já mandou (só o dedup impede reenvio).
            const tsBoleto = Date.now();
            msgsBoleto.forEach((m, i) => {
              mensagens.push(m);
              historicoAtualizado.push({ role: "model", text: m, ts: tsBoleto + i });
            });

            await convRef.set({
              messages: historicoAtualizado,
              boletoAsaasGerado: true,
              boletoAsaasId: boleto.paymentId,
              boletoAsaasValor: valorBoleto,
              boletoAsaasTs: tsBoleto,
            }, { merge: true });

            logger.info("boleto Asaas gerado", {
              numero, agenteSlug, paymentId: boleto.paymentId, valor: valorBoleto,
            });
          } catch (err) {
            await marcarFalhaIA(convRef,
              `falha ao gerar boleto Asaas: ${String(err).slice(0, 300)}`,
              { numero, agenteSlug, canal, nomeCliente }, settingsData);
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

// rodarFaxinaConversas — dispara a faxina do ciclo de vida SOB DEMANDA (só o
// dono). Roda apenas a limpeza (arquiva/exclui), SEM disparar remarketing.
// Serve para limpar o backlog na hora e ver a contagem, sem esperar o agendado.
exports.rodarFaxinaConversas = onCall(async (request) => {
  await exigirDono(request);
  const resumo = await processarFaxinaCicloVida();
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

    // Faxina do ciclo de vida: arquiva engajados sem resposta e exclui leads
    // mortos, passado o prazo pós-remarketing. Roda logo depois do remarketing.
    try {
      const faxina = await processarFaxinaCicloVida();
      logger.info("verificarRemarketingAgendado — faxina concluida", faxina);
    } catch (err) {
      logger.error("verificarRemarketingAgendado — falha na faxina pos-remarketing", {
        error: String(err),
      });
    }

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

        // NÃO arquiva mais na hora: a conversa fica em Ativas para o vendedor ver
        // o lead reagir ao remarketing. Esta mensagem reinicia o relógio de
        // inatividade; quem tira da bancada depois é a faxina por tempo parado
        // (processarFaxinaCicloVida), se o lead continuar sem responder.
        await doc.ref.set({
          messages: msgsRemarket,
          remarketingEnviado: true,
          remarketingTs: Date.now(),
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
 * Faxina do ciclo de vida da conversa na bancada, por TEMPO PARADO.
 *
 * Roda de hora em hora (junto do remarketing). Para cada conversa parada há mais
 * de FAXINA_DIAS_PARADO dias (sem nenhuma mensagem nova) que NÃO é lead pronto e
 * NÃO teve o remarketing desligado na mão (remarketingAtivo=false é opt-out
 * explícito do vendedor — não mexe):
 *   • se a IA (Patrícia) chegou a RESPONDER alguma vez → ARQUIVA (teve conversa
 *     real, tem valor);
 *   • se a IA NUNCA respondeu — mesmo que o cliente tenha mandado algo (ex.: só o
 *     "Olá tenho interesse" do anúncio) → EXCLUI de vez (lead que não chegou a
 *     lugar nenhum, sem o que treinar).
 *
 * Independe do remarketing: como o remarketing pode estar desligado num canal,
 * o gatilho é o tempo sem atividade. Isso também limpa o BACKLOG antigo.
 * "Atividade" = ts da última mensagem (ou criadoEm se não houver). Uma mensagem
 * de remarketing reinicia o relógio, dando ao lead uma nova janela para reagir.
 *
 * @return {Promise<Object>} Resumo (arquivadas, excluidas, mantidas).
 */
async function processarFaxinaCicloVida() {
  const paradoMs = FAXINA_DIAS_PARADO * 24 * 60 * 60 * 1000;
  const agora = Date.now();

  const snap = await admin.firestore().collection("conversations").get();

  let arquivadas = 0;
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

    // Nunca mexe em venda fechada nem em quem o vendedor tirou do automático.
    if (data.leadPronto === true || data.remarketingAtivo === false) continue;

    const msgs = Array.isArray(data.messages) ? data.messages : [];

    // Última atividade: ts da mensagem mais recente, ou criadoEm.
    let ultimaAtividade = 0;
    for (const m of msgs) {
      if (m && typeof m.ts === "number" && m.ts > ultimaAtividade) ultimaAtividade = m.ts;
    }
    if (!ultimaAtividade && typeof data.criadoEm === "number") ultimaAtividade = data.criadoEm;

    // Ainda com atividade recente? Deixa quieto.
    if (ultimaAtividade && (agora - ultimaAtividade) < paradoMs) {
      mantidas++;
      continue;
    }
    // Sem data alguma de referência: não arrisca, mantém.
    if (!ultimaAtividade) {
      mantidas++;
      continue;
    }

    // Parado o suficiente. A IA (Patrícia) chegou a RESPONDER alguma vez?
    // "Resposta da IA" = mensagem 'model' com texto de verdade — não a nota de
    // remarketing nem avisos internos do sistema (esses começam com "[").
    const iaRespondeu = msgs.some(
      (m) => m && m.role === "model" && typeof m.text === "string" &&
        m.text.trim() !== "" && !m.text.trim().startsWith("["),
    );
    if (iaRespondeu) {
      // Houve conversa real com a IA → tem valor: arquiva (não exclui).
      if (data.arquivada !== true) {
        batch.update(doc.ref, { arquivada: true });
        ops++;
        await commitSeCheio(false);
      }
      arquivadas++;
    } else {
      // A IA nunca respondeu (mesmo que o cliente tenha mandado algo): lead que
      // não chegou a lugar nenhum. Sem valor → exclui.
      batch.delete(doc.ref);
      ops++;
      await commitSeCheio(false);
      excluidas++;
    }
  }

  await commitSeCheio(true);

  const resumo = { total: snap.size, arquivadas, excluidas, mantidas };
  logger.info("processarFaxinaCicloVida — concluido", resumo);
  return resumo;
}
