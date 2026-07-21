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
| `base-patricia-2026-07-10-1028.txt` | 13.008 chars. Aperta o formato (máx. 2 frases e 200 chars por mensagem, uma dúvida por vez, última mensagem só com a pergunta) e adiciona a trava factual da garantia. Ver abaixo. |
| `base-patricia-2026-07-21-1507.txt` | 13.419 chars. Estado de produção imediatamente antes da mudança do titular do CNPJ. |
| `base-patricia-2026-07-21-1512.txt` | 14.166 chars. Adiciona resposta fixa para o cliente que estranha o nome do titular no pagamento (`Mateus Henrique de Oliveira`) + proibição de inventar cargo. Ver abaixo. |

## Por que a trava factual existe

Ao encurtar as respostas por prompt, o `gemini-3.5-flash` passou a comprimir a
garantia e a **inventar promessa comercial**: "devolvemos se você não gostar",
"em até 7 dias". Isso não existe — reembolso é só para problema de entrega,
troca é só para problema no produto. Medido em replay contra a conversa do
Estefano (554198968413): sem a trava, 2 de 8 amostras inventaram; com a trava,
0 de 8. **Nunca aperte o tamanho sem reforçar os fatos junto.**

Nesse mesmo replay, o tamanho da resposta caiu de ~953 para ~453 caracteres, e
a maior mensagem de 574 para 189. O modelo respeita o limite de 200 chars em
~75% das mensagens — melhora muito, mas não é régua.

Descoberta relacionada: a verbosidade veio do **modelo**, não do prompt. Com a
base antiga, o 3.5-flash já escrevia ~921 chars onde o 2.5-flash escrevia ~725.

## Por que a regra do titular do CNPJ existe

O CNPJ `57.177.822/0001-60` é registrado no nome do titular, Mateus Henrique de
Oliveira — a Ekoa Natural é a marca. Quem paga por PIX ou boleto vê esse nome no
recebedor, e o cliente desconfiado estranha. Sem instrução, a Patrícia
**inventou um cargo** ("nosso diretor financeiro") para explicar, o que piora a
situação: quem consulta o CNPJ não encontra diretor nenhum, encontra a pessoa
física. A resposta fixa dá a explicação verdadeira, que é a mesma coisa que o
cliente vê ao conferir. Vendas já foram perdidas por essa desconfiança.

Quando o registro virar Ekoa Natural, esta regra sai da base — é dado da
empresa, não do sistema, por isso mora no Firestore e não no código.
