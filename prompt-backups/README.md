# Histórico da base do prompt

A base do prompt da Patrícia mora no Firestore (`agents/{id}.base`), não no
código — dá para editá-la pela tela do agente e ela vale na mensagem seguinte,
sem deploy. A conveniência tem um preço: sem estes arquivos, o prompt não tem
histórico, não tem diff e não tem como voltar atrás.

Cada arquivo aqui é uma cópia da base em um momento no tempo. O carimbo no nome
é a hora do snapshot, não a hora em que aquele texto entrou em produção.

## Gerar um snapshot

```bash
bash scripts/snapshot-prompt.sh
```

Rode **antes** de mexer na base e **depois** de aplicar a mudança. Assim o `git
diff` entre dois snapshots mostra exatamente o que mudou no comportamento da IA.

## Restaurar uma versão

Cole o conteúdo do arquivo no campo de prompt da tela do agente. Vale na próxima
mensagem de cliente.

## Linha do tempo

| Arquivo | O que é |
|---|---|
| `base-patricia-2026-07-10-0024.txt` | Base antiga, 24.491 chars. Crescida por remendos sucessivos: o gate de pagamento aparecia 6× e o parágrafo do `[LEAD_PRONTO]` 4×. |
| `base-patricia-2026-07-10-0919.txt` | Reescrita completa, 11.889 chars (~50% menos tokens). Sem perda de regra ou fato — só desduplicação. Muda comportamento em três pontos: respostas em 2 mensagens por padrão, frases do PIX/cartão sem "abaixo" (o WhatsApp reordena mensagens de dígitos soltos), e respostas fixas de site/CNPJ com pergunta de avanço adaptada ao dado que falta. |
