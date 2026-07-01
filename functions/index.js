/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
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

Regras rigorosas para a emissão do marcador:
1. O marcador [LEAD_PRONTO] deve ser escrito exatamente dessa forma (letras maiúsculas e entre colchetes) em uma LINHA TOTALMENTE ISOLADA no final absoluto de toda a sua resposta.
2. O marcador deve ficar sempre DEPOIS da última linha de conteúdo e DEPOIS de qualquer separador de mensagens "---" (caso esteja no formato split). O marcador NÃO é uma mensagem para o cliente e NÃO deve ser tratado como uma das partes do split. Não insira outro separador "---" após o marcador.
3. Este marcador é de uso estritamente interno do sistema e invisível para o cliente. NUNCA mencione, explique ou faça referência ao marcador "[LEAD_PRONTO]" na conversa com o cliente.
4. Você deve CONTINUAR conversando e atendendo o cliente normalmente, respondendo suas dúvidas e conduzindo o fechamento como se você fosse o vendedor. NÃO pare de responder e NÃO encerre o fluxo.

Exemplo de formato de resposta quando a condition de lead pronto ocorre:
Mensagem explicativa 1 ao cliente.
---
Mensagem explicativa 2 com a pergunta de avanço comercial.
[LEAD_PRONTO]`
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
// webhookRespondeChat — recebe webhook do Responde Chat,
// gera resposta da Patrícia via Gemini e envia de volta.
// ----------------------------------------
exports.webhookRespondeChat = onRequest(async (request, response) => {
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

    // 4. Ignorar mensagens próprias (anti-loop)
    if (key.fromMe === true || raw.IsFromMe === true) {
      logger.info("webhookRespondeChat — mensagem propria ignorada");
      return response.status(200).json({ ignored: true, reason: "mensagem_propria" });
    }

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

    // Configurar referências da conversa e reservar timestamp para debounce no início
    const convDocId = numero + "_" + agenteSlug;
    const convRef = admin.firestore().collection("conversations").doc(convDocId);
    const meuTs = Date.now();

    // Gravação leve preliminar para reservar o lugar na disputa de debounce
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
        const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
        
        const transResponse = await fetch(`${geminiUrl}?key=${geminiApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
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
          })
        });

        if (!transResponse.ok) {
          const errBody = await transResponse.text();
          throw new Error(`Erro na API Gemini de Transcricao: ${transResponse.status} - ${errBody}`);
        }

        const transData = await transResponse.json();
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
        const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

        const visionResponse = await fetch(`${geminiUrl}?key=${geminiApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
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
          })
        });

        if (!visionResponse.ok) {
          const errBody = await visionResponse.text();
          throw new Error(`Erro na API Gemini de Visão: ${visionResponse.status} - ${errBody}`);
        }

        const visionData = await visionResponse.json();
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
    let ativo = convSnap.exists && convSnap.data().ativo === true;
    const estavaArquivada = convSnap.exists && convSnap.data().arquivada === true;

    if (estavaArquivada) {
      ativo = true; // Força ativo=true na memória para seguir ao Caminho B e responder de imediato
    }

    if (!ativo) {
      // Gravar a mensagem do cliente no histórico (para visibilidade na bancada)
      historico.push({ role: "user", text: texto || "[áudio recebido]", ts: Date.now() });
      await convRef.set(
        {
          messages: historico,
          numero,
          agenteSlug,
          status: "ativa",
          remarketingEnviado: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
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
      payloadCaminhoB.ativo = true;
      payloadCaminhoB.leadProntoWebhookEnviado = false; // Reset do dedup no desarquivamento/reativação
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

      // Chamar Gemini via fetch
      const geminiUrl =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

      const geminiResponse = await fetch(`${geminiUrl}?key=${geminiApiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
          },
        }),
      });

      if (!geminiResponse.ok) {
        const errBody = await geminiResponse.text();
        logger.error("webhookRespondeChat — erro na API Gemini", {
          status: geminiResponse.status,
          body: errBody,
        });
        return response
          .status(200)
          .json({ error: "geminiApiError", detalhe: errBody });
      }

      // Extrair texto da resposta
      const geminiData = await geminiResponse.json();
      const respostaCrua =
        geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // 10b. Detecção e remoção preliminar do marcador de lead pronto
      let leadPronto = false;
      let respostaLimpa = respostaCrua;
      const regexDetect = /^[ \t]*\[LEAD_PRONTO\][ \t]*$/m;
      if (regexDetect.test(respostaLimpa)) {
        leadPronto = true;
        logger.info("lead pronto detectado", { numero, agenteSlug });

        // Remover a linha contendo [LEAD_PRONTO]
        respostaLimpa = respostaLimpa.replace(/^[ \t]*\[LEAD_PRONTO\][ \t]*\r?\n?/gm, "");
        respostaLimpa = respostaLimpa.replace(/\r?\n?[ \t]*\[LEAD_PRONTO\][ \t]*$/gm, "");
      }

      respostaLimpa = respostaLimpa.trim();

      // Remover o "---" órfão no final
      if (respostaLimpa.endsWith("---")) {
        respostaLimpa = respostaLimpa.slice(0, -3).trim();
      }

      // Gravar histórico no Firestore (resposta da IA limpa)
      const agora = Date.now();
      historicoAtualizado.push({ role: "model", text: respostaLimpa, ts: agora });

      const updateData = {
        messages: historicoAtualizado,
        numero,
        agenteSlug,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (leadPronto) {
        updateData.leadPronto = true;
      }

      await convRef.set(updateData, { merge: true });

      if (leadPronto) {
        try {
          // Releitura fresca do documento da conversa imediatamente antes de disparar (dedup contra condição de corrida)
          const convSnapFresco = await convRef.get();
          const leadProntoWebhookEnviado = convSnapFresco.exists ? !!convSnapFresco.data().leadProntoWebhookEnviado : false;

          if (!leadProntoWebhookEnviado) {
            const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
            const webhookConfig = settingsData.webhooks?.leadPronto || {};
            const webhookUrl = webhookConfig.url || RESPONDECHAT_WEBHOOK_LEAD;
            const webhookAtivo = webhookConfig.ativo !== false;

            if (webhookAtivo && webhookUrl) {
              logger.info("Disparando webhook de lead quente", { numero, url: webhookUrl });
              const responseHook = await fetch(webhookUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  client_phone: numero,
                  client_name: "Lead Quente",
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
        .map((msg) => msg.replace(/\[LEAD_PRONTO\]/g, "").trim())
        .filter((msg) => msg.length > 0);

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
        const webhookConfig = settingsData.webhooks?.iaAcionada || {};
        const webhookUrl = webhookConfig.url;
        const webhookAtivo = webhookConfig.ativo !== false;

        if (webhookAtivo && webhookUrl) {
          logger.info("Disparando webhook de IA acionada", { numero, url: webhookUrl });
          const responseHook = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              client_phone: numero,
              client_name: "Lead IA",
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

    // 19. Ler token do Responde Chat (reaproveitando settingsSnap já lido)
    const respondechatToken = settingsSnap.exists
      ? settingsSnap.data().respondechatToken
      : null;

    if (!respondechatToken) {
      logger.warn("webhookRespondeChat — sem token respondechat");
      return response.status(200).json({
        error: "semToken",
        mensagens,
      });
    }

    // 20. Enviar cada mensagem ao WhatsApp via Responde Chat
    let enviadas = 0;

    for (let i = 0; i < mensagens.length; i++) {
      // Delay de 1.2s entre mensagens (não antes da primeira)
      if (i > 0) {
        await new Promise((r) => setTimeout(r, 3000));
      }

      try {
        const sendResponse = await fetch(
          "https://backend.respondechat.ai/api/messages/send",
          {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + respondechatToken,
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

    // 3. Obter e normalizar número do corpo
    const numeroRaw = request.body?.numero;
    if (!numeroRaw) {
      logger.warn("ativarAgente — sem numero no corpo", { body: JSON.stringify(request.body) });
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
  }
);

/**
 * Processa o remarketing varrendo as conversas no Firestore.
 * @return {Promise<Object>} Resumo do processamento.
 */
async function processarRemarketing() {
  logger.info("processarRemarketing — iniciando varredura");

  const settingsSnap = await admin.firestore().doc("settings/app").get();
  const settingsData = settingsSnap.exists ? settingsSnap.data() : {};
  const webhookConfig = settingsData.webhooks?.remarketing || {};
  const webhookUrl = webhookConfig.url || "";
  const webhookAtivo = webhookConfig.ativo !== false;
  const modoTeste = webhookConfig.modoTeste === true;
  const numeroTeste = webhookConfig.numeroTeste || "";

  if (!webhookAtivo || !webhookUrl) {
    logger.info("processarRemarketing — webhook inativo ou sem URL", {
      ativo: webhookAtivo,
      hasUrl: !!webhookUrl,
    });
    return {
      status: "webhook_inativo_ou_sem_url",
      ativo: webhookAtivo,
      hasUrl: !!webhookUrl,
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

    try {
      logger.info("processarRemarketing — disparando webhook", {
        numero,
        docId: doc.id,
      });

      const responseHook = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_phone: numero,
          client_name: "Lead Remarketing",
        }).toString(),
      });

      const corpoResposta = await responseHook.text();

      if (responseHook.status >= 200 && responseHook.status < 300) {
        logger.info("processarRemarketing — sucesso no webhook", {
          numero,
          status: responseHook.status,
          corpo: corpoResposta,
        });

        await doc.ref.set({
          remarketingEnviado: true,
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
